// booking_notify.go — POST /api/rainbow/notify-booking
//
// Called by PMS2 go-pms after a guest completes a public website booking.
// Sends a WhatsApp message to configured staff with the booking details.
//
// Auth: NOT wrapped in h.auth (no X-Admin-Key check) because PMS2's
// rainbowNotify sends no auth header. Instead, an optional X-Notify-Secret
// shared-secret header is checked against the NOTIFY_SHARED_SECRET env var.
// If the env var is unset, the request is allowed through (backward-compatible
// with an un-updated PMS2). If set, a mismatch returns 401.
package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// notifySecretWarnOnce ensures the "no NOTIFY_SHARED_SECRET" warning is logged
// at most once per process lifetime to avoid log spam.
var notifySecretWarnOnce sync.Once

// bookingPayload is the JSON body PMS2 sends to /api/rainbow/notify-booking.
// numberOfGuests may arrive as a JSON number or string; totalAmount as string
// or number. Both are decoded as json.RawMessage and formatted via fmt.Sprint.
type bookingPayload struct {
	GuestName          string          `json:"guestName"`
	PhoneNumber        string          `json:"phoneNumber"`
	ConfirmationNumber string          `json:"confirmationNumber"`
	CheckInDate        string          `json:"checkInDate"`
	CheckOutDate       string          `json:"checkOutDate"`
	NumberOfGuests     json.RawMessage `json:"numberOfGuests"`
	TotalAmount        json.RawMessage `json:"totalAmount"`
	CheckInLink        string          `json:"checkInLink"`
}

// notifySettingsFile is the subset of settings.json read for recipient
// resolution. Only the staff sub-object is needed.
type notifySettingsFile struct {
	Staff struct {
		BookingNotifyTargets []string `json:"booking_notify_targets"`
		JayPhone             string   `json:"jay_phone"`
		AlstonPhone          string   `json:"alston_phone"`
	} `json:"staff"`
}

// loadNotifySettings reads settings.json from the data dir and returns the
// staff block. Returns a zero value on any error so the caller falls back
// gracefully.
func (h *Handler) loadNotifySettings() notifySettingsFile {
	var s notifySettingsFile
	if h.dataDir == "" {
		return s
	}
	b, err := os.ReadFile(filepath.Join(h.dataDir, "settings.json"))
	if err != nil {
		return s
	}
	_ = json.Unmarshal(b, &s)
	return s
}

// rawToString coerces a json.RawMessage (number or quoted string) to a plain
// string, stripping surrounding quotes if present. Returns "" for nil/empty.
func rawToString(r json.RawMessage) string {
	if len(r) == 0 {
		return ""
	}
	// Unquoted number: "42" or "42.5"
	if r[0] != '"' {
		return string(r)
	}
	// Quoted string: "\"text\""
	var s string
	if err := json.Unmarshal(r, &s); err != nil {
		return string(r)
	}
	return s
}

// buildBookingMessage assembles the WhatsApp text for a new booking.
// Format mirrors the retired Node booking-notify.ts verbatim, with one
// extra line (reservations URL) added before the bot footer.
func buildBookingMessage(p bookingPayload) string {
	lines := []string{
		"📋 *New Booking Received!*",
		"",
		fmt.Sprintf("👤 *Name:* %s", p.GuestName),
		fmt.Sprintf("📱 *Phone:* %s", nonEmpty(p.PhoneNumber, "Not provided")),
	}
	if p.ConfirmationNumber != "" {
		lines = append(lines, fmt.Sprintf("🔖 *Confirmation:* %s", p.ConfirmationNumber))
	}
	lines = append(lines, fmt.Sprintf("📅 *Check-in:* %s", p.CheckInDate))
	if p.CheckOutDate != "" {
		lines = append(lines, fmt.Sprintf("📅 *Check-out:* %s", p.CheckOutDate))
	}
	if g := rawToString(p.NumberOfGuests); g != "" {
		lines = append(lines, fmt.Sprintf("👥 *Guests:* %s", g))
	}
	if a := rawToString(p.TotalAmount); a != "" {
		lines = append(lines, fmt.Sprintf("💰 *Total:* RM%s", a))
	}
	if p.CheckInLink != "" {
		lines = append(lines, fmt.Sprintf("🔗 *Check-in link:* %s", p.CheckInLink))
	}
	lines = append(lines,
		"",
		"🔗 https://pms.pelangicapsulehostel.com/reservations",
		"🤖 _Notification by Rainbow AI_",
	)
	return strings.Join(lines, "\n")
}

// nonEmpty returns s if non-empty, otherwise fallback.
func nonEmpty(s, fallback string) string {
	if s != "" {
		return s
	}
	return fallback
}

// notifyBooking handles POST /api/rainbow/notify-booking.
//
// Auth: guarded by X-Notify-Secret / NOTIFY_SHARED_SECRET (not h.auth).
// PMS2 fires and forgets; this endpoint always returns 200 even when some
// sends fail — per-target errors are included in the response body.
func (h *Handler) notifyBooking(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}

	// ── Shared-secret guard ──────────────────────────────────────────────────
	secret := os.Getenv("NOTIFY_SHARED_SECRET")
	if secret == "" {
		http.Error(w, "server misconfiguration: NOTIFY_SHARED_SECRET not set", http.StatusInternalServerError)
		return
	}
	if r.Header.Get("X-Notify-Secret") != secret {
		writeJSON(w, 401, map[string]any{"error": "unauthorized"})
		return
	}

	// ── Parse body ───────────────────────────────────────────────────────────
	var p bookingPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON: " + err.Error()})
		return
	}
	if p.GuestName == "" || p.CheckInDate == "" {
		writeJSON(w, 400, map[string]any{"error": "guestName and checkInDate are required"})
		return
	}

	// ── Resolve recipients ───────────────────────────────────────────────────
	// Order: (1) staff.booking_notify_targets from settings.json
	//        (2) staff.jay_phone + staff.alston_phone from settings.json
	//        (3) nothing — respond with sent:false
	cfg := h.loadNotifySettings()
	targets := cfg.Staff.BookingNotifyTargets
	if len(targets) == 0 {
		var fallbacks []string
		if cfg.Staff.JayPhone != "" {
			fallbacks = append(fallbacks, cfg.Staff.JayPhone)
		}
		if cfg.Staff.AlstonPhone != "" {
			fallbacks = append(fallbacks, cfg.Staff.AlstonPhone)
		}
		targets = fallbacks
	}
	if len(targets) == 0 {
		writeJSON(w, 200, map[string]any{"sent": false, "reason": "no targets"})
		return
	}

	// ── Sender check ─────────────────────────────────────────────────────────
	if h.sender == nil {
		writeJSON(w, 501, map[string]any{"error": "sending unavailable: no bridge configured"})
		return
	}

	// ── Build message ────────────────────────────────────────────────────────
	msg := buildBookingMessage(p)

	// ── Send to each target ──────────────────────────────────────────────────
	var failed []string
	delivered := 0
	for _, target := range targets {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		_, err := h.sender.SendText(ctx, target, msg, "")
		cancel()
		if err != nil {
			log.Printf("[booking-notify] send to %s failed: %v", target, err)
			failed = append(failed, target)
		} else {
			delivered++
		}
	}

	log.Printf("[booking-notify] guest=%q conf=%q delivered=%d failed=%d",
		p.GuestName, p.ConfirmationNumber, delivered, len(failed))

	writeJSON(w, 200, map[string]any{
		"sent":      true,
		"delivered": delivered,
		"failed":    failed,
	})
}
