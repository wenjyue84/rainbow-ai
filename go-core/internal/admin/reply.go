// Staff reply endpoints: webchat staff reply (persist-only — the guest widget
// has no live delivery channel in go-core yet) and WhatsApp send via the
// Baileys bridge (persist + deliver).
package admin

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"rainbow-core/internal/contract"
	"rainbow-core/internal/events"
	"rainbow-core/internal/store"
)

// maskPhone keeps logs correlatable without writing full numbers to disk
// (60123456789@s.whatsapp.net → 60***6789; short/opaque ids pass through).
func maskPhone(p string) string {
	d := p
	if i := indexByte(d, '@'); i >= 0 {
		d = d[:i]
	}
	if len(d) < 6 {
		return d
	}
	return d[:2] + "***" + d[len(d)-4:]
}

func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

// TextSender delivers WhatsApp text (implemented by bridge.Client).
type TextSender interface {
	SendText(ctx context.Context, phone, text, instanceID string) (*contract.SendResult, error)
}

// SetSender supplies the bridge client for staff WhatsApp sends.
func (h *Handler) SetSender(s TextSender) { h.sender = s }

// hasStaffNameCol reports whether rainbow_messages has a staff_name column
// (lazily initialised once; safe for concurrent callers).
func (h *Handler) hasStaffNameCol() bool {
	h.staffNameColOnce.Do(func() {
		h.staffNameCol = -1
		if cols, err := h.st.TableColumns("rainbow_messages"); err == nil {
			if _, ok := cols["staff_name"]; ok {
				h.staffNameCol = 1
			}
		}
	})
	return h.staffNameCol == 1
}

// insertStaffMessage stores a staff-authored message row and returns its
// timestamp in epoch millis. profile is the business the conversation belongs
// to ("" = default) — without it the row lands in the default profile's view
// and vanishes from the business the staff member was actually replying in.
func (h *Handler) insertStaffMessage(phone, content, source, staffName, profile string) (int64, error) {
	ts := store.NowISO()
	if profile == "" {
		profile = h.defaultProfile
		if profile == "" {
			profile = "pelangi"
		}
	}
	var err error
	if h.hasStaffNameCol() {
		_, err = h.st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, source, staff_name, profile_id)
			VALUES (?, 'staff', ?, ?, ?, ?, ?)`, phone, content, ts, source, staffName, profile)
	} else {
		_, err = h.st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, source, profile_id)
			VALUES (?, 'staff', ?, ?, ?, ?)`, phone, content, ts, source, profile)
	}
	if err != nil {
		return 0, err
	}
	t, _ := time.Parse(store.ISO, ts)
	preview := events.Preview(content, 80)
	events.Publish(events.Event{Type: "new_message", ProfileID: profile, Phone: phone, Role: "staff", Timestamp: t.UnixMilli(), Preview: preview})
	return t.UnixMilli(), nil
}

// webchatReply handles POST /api/rainbow/webchat/conversations/{sid}/reply
// {message, staffName}. The row lands under whichever phone spelling the
// session already uses (web:<sid> Go era, webchat-<sid> Node era).
func (h *Handler) webchatReply(w http.ResponseWriter, r *http.Request, sid string) {
	var in struct {
		Message   string `json:"message"`
		StaffName string `json:"staffName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Message == "" {
		writeJSON(w, 400, map[string]any{"error": "message required"})
		return
	}
	if in.StaffName == "" {
		in.StaffName = "Staff"
	}
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	if !h.ownsConversation(webchatPhones(sid), profileID) {
		writeJSON(w, 404, map[string]any{"error": "session not found"})
		return
	}
	phone := "web:" + sid
	for _, p := range webchatPhones(sid) {
		var n int
		h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone=?`, p).Scan(&n)
		if n > 0 {
			phone = p
			break
		}
	}
	ms, err := h.insertStaffMessage(phone, in.Message, "webchat-admin", in.StaffName, profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "timestamp": ms})
}

// conversationSend handles POST /api/rainbow/conversations/{phone}/send
// {message, instanceId, staffName} — deliver via the bridge, then persist.
func (h *Handler) conversationSend(w http.ResponseWriter, r *http.Request, phone string) {
	var in struct {
		Message    string `json:"message"`
		InstanceID string `json:"instanceId"`
		StaffName  string `json:"staffName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Message == "" {
		writeJSON(w, 400, map[string]any{"error": "message required"})
		return
	}
	if in.StaffName == "" {
		in.StaffName = "Staff"
	}
	// Webchat conversations live in the same unified list; a "send" to a
	// web:<sid> phone is a staff webchat reply (persist, no bridge — the guest
	// widget has no live delivery channel yet).
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	// Ownership gate: staff can only reach conversations that exist in their
	// profile — no cross-profile delivery, persistence, or existence probing.
	if !h.ownsConversation([]string{phone}, profileID) {
		writeJSON(w, 404, map[string]any{"error": "conversation not found"})
		return
	}
	if _, isWebchat := webchatSession(phone); isWebchat {
		ms, err := h.insertStaffMessage(phone, in.Message, "webchat-admin", in.StaffName, profileID)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "timestamp": ms})
		return
	}
	if h.sender == nil {
		writeJSON(w, 501, map[string]any{"error": "sending unavailable: no bridge configured"})
		return
	}
	// The number a staff reply goes out from is decided by the PROFILE, never
	// by what the SPA happened to send: on 2026-09-08 a reply typed under
	// senai-app left from the pelangi number because the SPA sent no
	// instanceId and the bridge client fell back to its default URL.
	instanceID, ok := h.resolveSendInstance(in.InstanceID, profileID)
	if !ok {
		writeJSON(w, 409, map[string]any{"error": "no WhatsApp number is linked to this business profile — pair one on the Dashboard first"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	// One line per staff send: which business, which number, to whom. This is
	// the only place the outbound path is observable end to end.
	res, err := h.sender.SendText(ctx, phone, in.Message, instanceID)
	if err != nil {
		log.Printf("[send] profile=%s instance=%s to=%s requested=%q FAILED: %v", profileID, instanceID, maskPhone(phone), in.InstanceID, err)
		writeJSON(w, 502, map[string]any{"error": "bridge send failed: " + err.Error()})
		return
	}
	sent, reason := true, ""
	if res != nil {
		sent, reason = res.OK && (res.Sent || res.Reason == ""), res.Reason
	}
	log.Printf("[send] profile=%s instance=%s to=%s requested=%q len=%d sent=%v reason=%q", profileID, instanceID, maskPhone(phone), in.InstanceID, len(in.Message), sent, reason)
	ms, err := h.insertStaffMessage(phone, in.Message, "staff-manual", in.StaffName, profileID)
	if err != nil {
		// Delivered but not persisted — report success with a warning so the
		// SPA doesn't retry-send a duplicate.
		writeJSON(w, 200, map[string]any{"ok": true, "warning": "sent but not persisted: " + err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "timestamp": ms})
}
