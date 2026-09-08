package admin

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rainbow-core/internal/ai"
	"rainbow-core/internal/config"
)

// IgnoredApplier hot-applies a profile's AI exception list to the running
// engine. Returns false when no engine serves that profile.
type IgnoredApplier func(profileID string, list []config.IgnoredNumber) bool

// SetIgnoredApplier wires the hub's SetIgnoredNumbers so a PUT takes effect
// without a restart.
func (h *Handler) SetIgnoredApplier(f IgnoredApplier) { h.ignoredApplier = f }

// ProviderProber runs a one-token completion against one provider of one
// profile and reports the round-trip time (admin "Test Speed").
type ProviderProber func(ctx context.Context, profileID, providerID string) (time.Duration, *ai.ChatResult, error)

// SetProviderProber wires the per-profile engine probe for /test/llm-latency.
func (h *Handler) SetProviderProber(f ProviderProber) { h.prober = f }

// effectiveProfile maps reqProfile's "" (default profile owns the unsuffixed
// files) back to the concrete default profile id for hub lookups.
func (h *Handler) effectiveProfile(r *http.Request) (string, error) {
	p, err := h.reqProfile(r)
	if err != nil {
		return "", err
	}
	if p == "" {
		p = h.defaultProfile
		if p == "" {
			p = "pelangi"
		}
	}
	return p, nil
}

// ignoredNumbers serves GET|PUT /api/rainbow/settings/ignored-numbers.
//
//	GET → {"ignoredNumbers":[{"phone":"60176701102","label":"Maya"}, …]}
//	PUT {"ignoredNumbers":[…]} → validates, merges ONLY that key into the
//	profile's settings file, hot-applies, returns the normalised list.
//
// Validation: phone digits (after stripping +, spaces, dashes) 8–15 long,
// label ≤ 40 chars, duplicates collapsed. Rejects the whole body on the first
// bad entry so a typo never silently drops a staff number.
func (h *Handler) ignoredNumbers(w http.ResponseWriter, r *http.Request) {
	if h.dataDir == "" {
		writeJSON(w, 404, map[string]any{"error": "no data dir"})
		return
	}
	if _, err := h.reqProfile(r); err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	switch r.Method {
	case http.MethodGet:
		var doc struct {
			IgnoredNumbers []config.IgnoredNumber `json:"ignoredNumbers"`
		}
		h.readDataJSONReq(r, "settings.json", &doc)
		list := config.NormalizeIgnored(doc.IgnoredNumbers)
		writeJSON(w, 200, map[string]any{"ignoredNumbers": list})

	case http.MethodPut:
		var body struct {
			IgnoredNumbers *[]config.IgnoredNumber `json:"ignoredNumbers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.IgnoredNumbers == nil {
			writeJSON(w, 400, map[string]any{"error": "ignoredNumbers array required"})
			return
		}
		clean := make([]config.IgnoredNumber, 0, len(*body.IgnoredNumbers))
		for i, n := range *body.IgnoredNumbers {
			ph := config.NormalizePhone(n.Phone)
			if len(ph) < 8 || len(ph) > 15 {
				writeJSON(w, 400, map[string]any{
					"error": "entry " + itoa(i+1) + ": phone must be 8-15 digits (country code, no +), got " + strings.TrimSpace(n.Phone),
				})
				return
			}
			label := strings.TrimSpace(n.Label)
			if len([]rune(label)) > 40 {
				writeJSON(w, 400, map[string]any{"error": "entry " + itoa(i+1) + ": label must be 40 characters or fewer"})
				return
			}
			clean = append(clean, config.IgnoredNumber{Phone: ph, Label: label})
		}
		clean = config.NormalizeIgnored(clean)

		// Merge only our key so unrelated settings survive untouched.
		doc := map[string]any{}
		h.readDataJSONReq(r, "settings.json", &doc)
		// Previous list (for the added-number diff below).
		var prev struct {
			IgnoredNumbers []config.IgnoredNumber `json:"ignoredNumbers"`
		}
		if b, err := json.Marshal(doc); err == nil {
			_ = json.Unmarshal(b, &prev)
		}
		doc["ignoredNumbers"] = clean
		if err := h.writeDataJSONReq(r, "settings.json", doc); err != nil {
			log.Printf("[admin] ignored-numbers write failed: %v", err)
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}

		applied := false
		pid, _ := h.effectiveProfile(r)
		if h.ignoredApplier != nil {
			applied = h.ignoredApplier(pid, clean)
		}
		// Tell each newly added number the bot will stop replying to them.
		// Queued, not sent inline: the bridge's quiet-hours / cold-send gates
		// decide when it actually goes out (ignored_notify.go).
		notified := h.enqueueIgnoredNotices(pid, config.NormalizeIgnored(prev.IgnoredNumbers), clean)
		log.Printf("[admin] ignored-numbers updated profile=%q count=%d applied=%v notify_queued=%d", r.Header.Get("x-profile-id"), len(clean), applied, len(notified))
		writeJSON(w, 200, map[string]any{"ok": true, "ignoredNumbers": clean, "applied": applied, "notifyQueued": notified})

	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

// llmLatency serves POST /api/rainbow/test/llm-latency {providerId} — a real
// one-token completion against that provider, returning {ok, ms, model}. The
// SPA's AI Models tab used to call this on the Node engine; without it every
// provider badge showed "Error" and a toast storm fired on each Settings load.
func (h *Handler) llmLatency(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if h.prober == nil {
		writeJSON(w, 501, map[string]any{"ok": false, "error": "latency probe not available"})
		return
	}
	var in struct {
		ProviderID string `json:"providerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || strings.TrimSpace(in.ProviderID) == "" {
		writeJSON(w, 400, map[string]any{"ok": false, "error": "providerId required"})
		return
	}
	pid, err := h.effectiveProfile(r)
	if err != nil {
		writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	took, res, perr := h.prober(ctx, pid, strings.TrimSpace(in.ProviderID))
	ms := took.Milliseconds()
	if perr != nil {
		// 200 with ok:false — a failing provider is a result, not a transport error.
		writeJSON(w, 200, map[string]any{"ok": false, "ms": ms, "error": perr.Error()})
		return
	}
	model := ""
	if res != nil {
		model = res.Model
	}
	writeJSON(w, 200, map[string]any{"ok": true, "ms": ms, "model": model})
}

func itoa(i int) string { return strconv.Itoa(i) }
