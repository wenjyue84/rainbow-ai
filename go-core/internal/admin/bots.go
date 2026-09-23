package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Bot is one named AI assistant persona: which business it fronts, which
// profile drives it, and which WhatsApp number / bridge it lives on.
//
// The team is the default list below, optionally replaced by
// <dataDir>/bots.json (same shape). Phone and bridge fall back to the
// profile's RAINBOW_WA_NUMBER_<PROFILE> / BRIDGE_URL_<PROFILE> env vars, and
// BOT_PHONE_<ID> / BOT_BRIDGE_<ID> override per bot (so a second number on
// the same profile can be introduced without touching the profile env).
type Bot struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Emoji     string `json:"emoji,omitempty"`
	Role      string `json:"role"`
	Business  string `json:"business"`
	Profile   string `json:"profile"`
	Phone     string `json:"phone"`
	BridgeURL string `json:"bridgeUrl,omitempty"`
	// Filled at request time from the bridge /health.
	State      string `json:"state"`
	InstanceID string `json:"instanceId,omitempty"`
	Configured bool   `json:"configured"`
}

const botsFile = "bots.json"

var defaultBots = []Bot{
	{ID: "rainbow", Name: "Rainbow", Emoji: "🌈", Business: "Pelangi Capsule Hostel", Profile: "pelangi",
		Role: "Guest assistant for Pelangi Capsule Hostel — answers enquiries, room availability, check-in/out, payments and directions."},
	{ID: "rachel", Name: "Rachel", Emoji: "🏡", Business: "Southern Homestay", Profile: "southern-homestay",
		Role: "Guest assistant for Southern Homestay (KSL D'Esplanade) — bookings, house rules, check-in guidance and unit support."},
	{ID: "ramli", Name: "Ramli", Emoji: "🏠", Business: "Senai Room Rental", Profile: "senai-app",
		Role: "Tenant assistant for Senai worker housing — tenant onboarding, rent reminders, payment chasing and maintenance requests."},
	{ID: "jayson", Name: "Jayson", Emoji: "🧑\u200d💼", Business: "Jay's Personal Assistant", Profile: "jayson-pa",
		Role: "Jay's personal assistant on his own number — reminders, notes, lookups and running errands across Jay's businesses."},
}

// profileHasInstance reports whether the registry routes a number to profile.
func (h *Handler) profileHasInstance(profile string) bool {
	for _, ib := range h.instanceSnapshot() {
		if ib.Profile == profile {
			return true
		}
	}
	return false
}

func (h *Handler) loadBots() []Bot {
	bots := append([]Bot(nil), defaultBots...)
	if h.dataDir != "" {
		if b, err := os.ReadFile(filepath.Join(h.dataDir, botsFile)); err == nil {
			var custom []Bot
			if json.Unmarshal(b, &custom) == nil && len(custom) > 0 {
				bots = custom
			}
		}
	}
	for i := range bots {
		bt := &bots[i]
		suffix := strings.ToUpper(strings.ReplaceAll(bt.Profile, "-", "_"))
		idKey := strings.ToUpper(strings.ReplaceAll(bt.ID, "-", "_"))
		if bt.Phone == "" {
			bt.Phone = os.Getenv("RAINBOW_WA_NUMBER_" + suffix)
			if bt.Phone == "" && bt.Profile == h.defaultProfile {
				bt.Phone = os.Getenv("RAINBOW_WA_NUMBER")
			}
		}
		if v := os.Getenv("BOT_PHONE_" + idKey); v != "" {
			bt.Phone = v
		}
		if bt.BridgeURL == "" {
			bt.BridgeURL = h.bridgeForProfile(bt.Profile)
			if os.Getenv("BRIDGE_URL_"+suffix) == "" && bt.Profile != h.defaultProfile && !h.profileHasInstance(bt.Profile) {
				bt.BridgeURL = "" // no bridge of its own: never inherit the default number
			}
		}
		if v := os.Getenv("BOT_BRIDGE_" + idKey); v != "" {
			bt.BridgeURL = v
		}
		bt.BridgeURL = strings.TrimRight(bt.BridgeURL, "/")
		bt.Configured = bt.Phone != "" || bt.BridgeURL != ""
		bt.State = "not_set"
		if bt.BridgeURL != "" {
			bt.State = "unknown"
		}
	}
	return bots
}

// bots ports GET /api/rainbow/bots — the assistant team with live WhatsApp
// state per bot. Not profile-scoped: it is the introduction page for the whole
// team, and scoped users are filtered to the bots of their own tenants.
func (h *Handler) bots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, 200, map[string]any{"bots": h.botsFor(r.Context(), sessionFrom(r))})
}

// botsFor returns the assistant team visible to sess with live bridge state
// (shared by /bots and the Master overview).
func (h *Handler) botsFor(ctx context.Context, sess *Session) []Bot {
	bots := h.loadBots()
	if sess.Scoped() {
		kept := bots[:0]
		for _, b := range bots {
			if sess.Allows(b.Profile) {
				kept = append(kept, b)
			}
		}
		bots = kept
	}

	hctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	var wg sync.WaitGroup
	for i := range bots {
		if bots[i].BridgeURL == "" {
			continue
		}
		wg.Add(1)
		go func(b *Bot) {
			defer wg.Done()
			var user string
			b.State, b.InstanceID, user = bridgeHealthFull(hctx, b.BridgeURL)
			if b.Phone == "" && user != "" {
				b.Phone = user
			}
		}(&bots[i])
	}
	wg.Wait()
	return bots
}

// bridgeHealth returns the bridge's WhatsApp connection state ("open",
// "connecting", "close", ...) and instance id; "offline" if unreachable.
func bridgeHealth(ctx context.Context, bridgeURL string) (state, instanceID string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, bridgeURL+"/health", nil)
	if err != nil {
		return "offline", ""
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "offline", ""
	}
	defer resp.Body.Close()
	var hb struct {
		Whatsapp   string `json:"whatsapp"`
		InstanceID string `json:"instanceId"`
	}
	if json.NewDecoder(resp.Body).Decode(&hb) != nil || hb.Whatsapp == "" {
		return "offline", ""
	}
	return hb.Whatsapp, hb.InstanceID
}
