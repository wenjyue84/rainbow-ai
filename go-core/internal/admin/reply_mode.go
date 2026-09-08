package admin

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"rainbow-core/internal/config"
)

// ReplyModeApplier hot-applies a profile's reply_mode / intro_message to the
// running engine. Returns false when no engine serves that profile.
type ReplyModeApplier func(profileID, mode, intro string) bool

// SetReplyModeApplier wires the hub's SetReplyMode so a PUT takes effect
// without a restart.
func (h *Handler) SetReplyModeApplier(f ReplyModeApplier) { h.replyModeApplier = f }

// replyModes are the accepted settings "reply_mode" values. Since the Master
// layer (2026-09-08) "" is no longer a mode: it means "inherit from Master";
// the explicit spelling of the default pipeline is "normal".
var replyModes = map[string]string{
	"normal":     "AI replies (normal pipeline)",
	"intro-once": "Greet a new contact once, then silent",
	"silent":     "Silent — log inbound only, no AI, no sends (human / Claude replies via the bridge)",
}

// normalizeReplyMode maps the accepted spellings onto a stored value:
// "normal"/"ai" → "normal"; ""/"inherit" → "" (inherit from Master).
func normalizeReplyMode(v string) (mode string, ok bool) {
	mode = strings.ToLower(strings.TrimSpace(v))
	switch mode {
	case "", "inherit":
		return "", true
	case "ai":
		return "normal", true
	}
	_, ok = replyModes[mode]
	return mode, ok
}

// replyMode serves GET|PUT /api/rainbow/settings/reply-mode.
//
//	GET → {"replyMode":"silent","introMessage":"...","effective":{...},"inherited":false,...}
//	PUT {"replyMode":"silent","introMessage":"..."} → merges ONLY those two keys
//	into the profile's settings file, hot-applies, echoes the stored values.
//	PUT {"replyMode":"inherit"} clears the profile's own value so it follows
//	the Master default again.
//
// 2026-09-08: Ramli (senai-app), Rachel (southern) and Jayson (jayson-pa) run
// "silent" so inbound is stored for Live Chat but burns no LLM tokens; only
// Rainbow (pelangi) keeps auto-replying ("normal"). Profiles without an
// explicit value inherit the Master default (intro-once).
func (h *Handler) replyMode(w http.ResponseWriter, r *http.Request) {
	if h.dataDir == "" {
		writeJSON(w, 404, map[string]any{"error": "no data dir"})
		return
	}
	if _, err := h.reqProfile(r); err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	type doc struct {
		ReplyMode    string `json:"reply_mode"`
		IntroMessage string `json:"intro_message"`
		BotName      string `json:"bot_name"`
	}
	pid, _ := h.effectiveProfile(r)
	switch r.Method {
	case http.MethodGet:
		var d doc
		h.readDataJSONReq(r, "settings.json", &d)
		own := strings.TrimSpace(d.ReplyMode)
		effMode, effIntro := own, strings.TrimSpace(d.IntroMessage)
		inherited := false
		master, hasMaster := config.LoadMaster(h.dataDir)
		if own == "" && hasMaster && master.ReplyMode != "" {
			inherited = true
			effMode = master.ReplyMode
			if effIntro == "" {
				effIntro = config.IntroFor(master, d.BotName, config.BusinessName(h.dataDir, pid))
			}
		}
		writeJSON(w, 200, map[string]any{
			"replyMode":    own,
			"introMessage": strings.TrimSpace(d.IntroMessage),
			"inherited":    inherited,
			"effective":    map[string]any{"replyMode": effMode, "introMessage": effIntro},
			"master":       map[string]any{"replyMode": master.ReplyMode, "introMessage": master.IntroMessage, "introMessageUnnamed": master.IntroMessageUnnamed},
			"modes":        replyModes,
			"hotApply":     h.replyModeApplier != nil,
		})

	case http.MethodPut:
		var body struct {
			ReplyMode    *string `json:"replyMode"`
			IntroMessage *string `json:"introMessage"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ReplyMode == nil {
			writeJSON(w, 400, map[string]any{"error": "replyMode required (\"normal\", \"intro-once\", \"silent\" or \"inherit\")"})
			return
		}
		mode, ok := normalizeReplyMode(*body.ReplyMode)
		if !ok {
			writeJSON(w, 400, map[string]any{"error": "replyMode must be \"normal\", \"intro-once\", \"silent\" or \"inherit\"", "modes": replyModes})
			return
		}
		// Merge only our keys so unrelated settings survive untouched.
		m := map[string]any{}
		h.readDataJSONReq(r, "settings.json", &m)
		intro := ""
		if body.IntroMessage != nil {
			intro = strings.TrimSpace(*body.IntroMessage)
		} else if cur, ok := m["intro_message"].(string); ok {
			intro = strings.TrimSpace(cur)
		}
		if len([]rune(intro)) > 1000 {
			writeJSON(w, 400, map[string]any{"error": "introMessage must be 1000 characters or fewer"})
			return
		}
		if mode == "intro-once" && intro == "" {
			writeJSON(w, 400, map[string]any{"error": "intro-once needs a non-empty introMessage"})
			return
		}
		if mode == "" {
			delete(m, "reply_mode")
			delete(m, "intro_message")
		} else {
			m["reply_mode"] = mode
			m["intro_message"] = intro
		}
		if err := h.writeDataJSONReq(r, "settings.json", m); err != nil {
			log.Printf("[admin] reply-mode write failed: %v", err)
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		applyMode, applyIntro := mode, intro
		if mode == "" {
			// Back to inheriting: hot-apply the Master default (if any).
			if master, ok := config.LoadMaster(h.dataDir); ok {
				applyMode = master.ReplyMode
				bn, _ := m["bot_name"].(string)
				applyIntro = config.IntroFor(master, bn, config.BusinessName(h.dataDir, pid))
			}
		}
		applied := false
		if h.replyModeApplier != nil {
			applied = h.replyModeApplier(pid, applyMode, applyIntro)
		}
		log.Printf("[admin] reply-mode updated profile=%q mode=%q applied=%v", pid, applyMode, applied)
		writeJSON(w, 200, map[string]any{"ok": true, "replyMode": mode, "introMessage": intro, "applied": applied, "inherited": mode == ""})

	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

func botNameOr(v string) string {
	if v = strings.TrimSpace(v); v != "" {
		return v
	}
	return "Rainbow"
}
