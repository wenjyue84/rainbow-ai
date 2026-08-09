// Quick-replies draft generation (Responses tab → Generate draft). Uses the
// core's AI provider manager (with fallback) to propose a trilingual static
// reply for a topic the knowledge base doesn't cover yet.
package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"rainbow-core/internal/ai"
)

// AIChatter is the slice of ai.Manager the draft generator needs (interface so
// tests can stub the LLM).
type AIChatter interface {
	Chat(ctx context.Context, messages []ai.ChatMessage, maxTokens int, temperature float64, jsonMode bool) (*ai.ChatResult, error)
}

// SetAI supplies the LLM manager used by /knowledge/generate-draft.
func (h *Handler) SetAI(m AIChatter) { h.ai = m }

var draftPhases = map[string]bool{
	"GENERAL_SUPPORT": true, "PRE_ARRIVAL": true, "ARRIVAL_CHECKIN": true,
	"DURING_STAY": true, "CHECKOUT_DEPARTURE": true, "POST_CHECKOUT": true,
}

// buildDraftPrompt assembles the system prompt for generate-draft from the
// existing knowledge.json intents (so the LLM avoids duplicates) + topic.
func buildDraftPrompt(existing []string, topic string) string {
	var b strings.Builder
	b.WriteString("You are the content assistant for Pelangi Capsule Hostel's WhatsApp bot.\n")
	b.WriteString("Draft ONE new quick-reply (static response) for the knowledge base.\n\n")
	if len(existing) > 0 {
		b.WriteString("Topics already covered (do NOT duplicate): " + strings.Join(existing, ", ") + "\n\n")
	}
	if topic != "" {
		b.WriteString("Requested topic: " + topic + "\n\n")
	} else {
		b.WriteString("Pick ONE common guest question a capsule hostel should answer that is missing above.\n\n")
	}
	b.WriteString("Rules: warm, concise WhatsApp tone; factual only (no invented prices/times — use placeholders like [TIME] if unknown).\n")
	b.WriteString("phase must be one of: GENERAL_SUPPORT, PRE_ARRIVAL, ARRIVAL_CHECKIN, DURING_STAY, CHECKOUT_DEPARTURE, POST_CHECKOUT.\n")
	b.WriteString("intent must be a new snake_case id.\n\n")
	b.WriteString("Respond with ONLY valid JSON (no markdown):\n")
	b.WriteString(`{"intent":"<snake_case>","phase":"<PHASE>","response":{"en":"...","ms":"...","zh":"..."}}`)
	return b.String()
}

var draftJSONRe = regexp.MustCompile(`(?s)\{.*\}`)

// parseDraftJSON extracts the draft object from an LLM response.
func parseDraftJSON(raw string) (intent, phase string, resp map[string]string, ok bool) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	if m := draftJSONRe.FindString(raw); m != "" {
		raw = m
	}
	var p struct {
		Intent   string            `json:"intent"`
		Phase    string            `json:"phase"`
		Response map[string]string `json:"response"`
	}
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return "", "", nil, false
	}
	if p.Intent == "" || p.Response == nil || p.Response["en"] == "" {
		return "", "", nil, false
	}
	if !draftPhases[p.Phase] {
		p.Phase = "GENERAL_SUPPORT"
	}
	return p.Intent, p.Phase, p.Response, true
}

// generateDraft serves POST /api/rainbow/knowledge/generate-draft {topic?} →
// {ok, intent, phase, response:{en,ms,zh}}. 502 when no LLM provider works.
func (h *Handler) generateDraft(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if h.ai == nil {
		writeJSON(w, 502, map[string]any{"ok": false, "error": "no AI provider configured"})
		return
	}
	var in struct {
		Topic string `json:"topic"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)

	var kn struct {
		Static []struct {
			Intent string `json:"intent"`
		} `json:"static"`
	}
	h.readDataJSONReq(r, "knowledge.json", &kn)
	existing := make([]string, 0, len(kn.Static))
	for _, s := range kn.Static {
		if s.Intent != "" {
			existing = append(existing, s.Intent)
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	res, err := h.ai.Chat(ctx, []ai.ChatMessage{
		{Role: "system", Content: buildDraftPrompt(existing, strings.TrimSpace(in.Topic))},
		{Role: "user", Content: "Generate the draft now."},
	}, 900, 0.5, true)
	if err != nil {
		writeJSON(w, 502, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	intent, phase, resp, ok := parseDraftJSON(res.Content)
	if !ok {
		writeJSON(w, 502, map[string]any{"ok": false, "error": "LLM returned unparseable draft"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "intent": intent, "phase": phase, "response": resp})
}
