// Intent-manager endpoints for the Understanding tab (t2 stats card, t3 tier
// toggles, t4 LLM settings/system prompt). All are file-backed against the
// profile data dir — the same files the config loader reads, so changes take
// effect on the next core restart.
package admin

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// readDataJSON reads + unmarshals a data-dir JSON file. Absent or invalid files
// leave v untouched and return false (stats tolerate missing files as zeros).
func (h *Handler) readDataJSON(name string, v any) bool {
	if h.dataDir == "" {
		return false
	}
	b, err := os.ReadFile(filepath.Join(h.dataDir, name))
	if err != nil {
		return false
	}
	return json.Unmarshal(b, v) == nil
}

// writeDataJSON writes a data-dir JSON file with 2-space indent (matching the
// Node config-store output so diffs stay readable).
func (h *Handler) writeDataJSON(name string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(h.dataDir, name), append(b, '\n'), 0o644)
}

// readDataJSONReq / writeDataJSONReq are the profile-aware versions of
// readDataJSON / writeDataJSON: a non-default profile always reads/writes its
// own -<profile> variant, never the global (default-profile) file. An invalid
// or unknown x-profile-id fails the operation rather than touching global data.
func (h *Handler) readDataJSONReq(r *http.Request, name string, v any) bool {
	p, err := h.reqProfile(r)
	if err != nil {
		return false
	}
	if p != "" {
		name = profileVariant(name, p)
	}
	return h.readDataJSON(name, v)
}

func (h *Handler) writeDataJSONReq(r *http.Request, name string, v any) error {
	p, err := h.reqProfile(r)
	if err != nil {
		return err
	}
	if p != "" {
		name = profileVariant(name, p)
	}
	return h.writeDataJSON(name, v)
}

var keywordLangs = map[string]bool{"en": true, "ms": true, "zh": true, "ta": true}

// countKeywordStrings counts keyword strings in a keywords value, descending
// into nested sub-intent objects (booking_sub etc.) like the config flattener.
func countKeywordStrings(raw json.RawMessage) int {
	var arr []string
	if json.Unmarshal(raw, &arr) == nil {
		return len(arr)
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) == nil {
		n := 0
		for _, v := range obj {
			n += countKeywordStrings(v)
		}
		return n
	}
	return 0
}

// imStats serves GET /api/rainbow/intent-manager/stats — the t2 summary card
// (#im-stat-intents / -keywords / -examples).
func (h *Handler) imStats(w http.ResponseWriter, r *http.Request) {
	var kw struct {
		Intents []struct {
			Keywords map[string]json.RawMessage `json:"keywords"`
		} `json:"intents"`
	}
	h.readDataJSONReq(r, "intent-keywords.json", &kw)
	totalKeywords := 0
	for _, it := range kw.Intents {
		for lang, raw := range it.Keywords {
			if keywordLangs[lang] {
				totalKeywords += countKeywordStrings(raw)
			}
		}
	}

	var ex struct {
		Intents []json.RawMessage `json:"intents"`
	}
	h.readDataJSONReq(r, "intent-examples.json", &ex)

	writeJSON(w, 200, map[string]any{
		"totalIntents":  len(kw.Intents),
		"totalKeywords": totalKeywords,
		"totalExamples": len(ex.Intents),
	})
}

// defaultTiers mirrors the config loader's defaults when intent-tiers.json is absent.
func defaultTiers() map[string]any {
	return map[string]any{
		"tier1_emergency": map[string]any{"enabled": true},
		"tier2_fuzzy":     map[string]any{"enabled": true, "threshold": 0.8},
		"tier3_semantic":  map[string]any{"enabled": true, "threshold": 0.67},
		"tier4_llm":       map[string]any{"enabled": true},
	}
}

// imTiers serves GET/PUT /api/rainbow/intent-manager/tiers against
// intent-tiers.json. The SPA reads {tier1_emergency:{enabled},…} and PUTs a
// partial {tiers:{tierX:{enabled}}} fragment which is deep-merged into the file.
func (h *Handler) imTiers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		var doc struct {
			Tiers map[string]any `json:"tiers"`
		}
		if !h.readDataJSONReq(r, "intent-tiers.json", &doc) || doc.Tiers == nil {
			writeJSON(w, 200, defaultTiers())
			return
		}
		writeJSON(w, 200, doc.Tiers)
	case http.MethodPut:
		var body struct {
			Tiers map[string]map[string]any `json:"tiers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Tiers) == 0 {
			writeJSON(w, 400, map[string]any{"error": "tiers object required"})
			return
		}
		doc := map[string]any{}
		h.readDataJSONReq(r, "intent-tiers.json", &doc)
		tiers, _ := doc["tiers"].(map[string]any)
		if tiers == nil {
			tiers = defaultTiers()
		}
		for tierKey, patch := range body.Tiers {
			cur, _ := tiers[tierKey].(map[string]any)
			if cur == nil {
				cur = map[string]any{}
			}
			for k, v := range patch {
				cur[k] = v
			}
			tiers[tierKey] = cur
		}
		doc["tiers"] = tiers
		if err := h.writeDataJSONReq(r, "intent-tiers.json", doc); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "tiers": tiers})
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

// imLLMSettings serves GET/PUT /api/rainbow/intent-manager/llm-settings against
// llm-settings.json (thresholds, selected providers, T4 systemPrompt…). PUT
// merges the body's top-level keys into the file so keys the SPA doesn't send
// (schema_version) survive.
func (h *Handler) imLLMSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.serveJSONFile(w, r, "llm-settings.json")
	case http.MethodPut:
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body) == 0 {
			writeJSON(w, 400, map[string]any{"error": "settings object required"})
			return
		}
		doc := map[string]any{}
		h.readDataJSONReq(r, "llm-settings.json", &doc)
		for k, v := range body {
			doc[k] = v
		}
		if err := h.writeDataJSONReq(r, "llm-settings.json", doc); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

// imAvailableProviders serves GET
// /api/rainbow/intent-manager/llm-settings/available-providers — the provider
// list the t4 tab offers for its model dropdown (from settings.json ai.providers).
func (h *Handler) imAvailableProviders(w http.ResponseWriter, r *http.Request) {
	s := h.loadSettingsFile()
	out := make([]map[string]any, 0, len(s.AI.Providers))
	for _, p := range s.AI.Providers {
		out = append(out, map[string]any{
			"id": p.ID, "name": p.Name, "type": p.Type,
			"enabled": p.Enabled, "priority": p.Priority,
		})
	}
	writeJSON(w, 200, out)
}

// regexPattern is the wire shape for the Priority Keywords UI.
type regexPattern struct {
	Pattern     string `json:"pattern"`
	Description string `json:"description"`
	Language    string `json:"language"`
}

// inferPatternLang guesses EN/MS/ZH/TA from a raw regex string.
func inferPatternLang(p string) string {
	for _, r := range p {
		if r >= 0x4E00 && r <= 0x9FFF {
			return "zh"
		}
		if r >= 0x0B80 && r <= 0x0BFF {
			return "ta"
		}
	}
	if strings.Contains(p, "tolong") || strings.Contains(p, "kecemasan") || strings.Contains(p, "bantuan") {
		return "ms"
	}
	return "en"
}

// emergencyPatternsFromIntents extracts emergency patterns from the requesting
// profile's intents.json variant.
func (h *Handler) emergencyPatternsFromIntents(r *http.Request) []regexPattern {
	var doc struct {
		Categories []struct {
			Intents []struct {
				Category string   `json:"category"`
				Patterns []string `json:"patterns"`
				Flags    string   `json:"flags"`
			} `json:"intents"`
		} `json:"categories"`
	}
	if !h.readDataJSONReq(r, "intents.json", &doc) {
		return nil
	}
	var out []regexPattern
	for _, cat := range doc.Categories {
		for _, intent := range cat.Intents {
			if intent.Category != "emergency" {
				continue
			}
			flags := intent.Flags
			if flags == "" {
				flags = "i"
			}
			for _, p := range intent.Patterns {
				out = append(out, regexPattern{
					Pattern:     "/" + p + "/" + flags,
					Description: "Emergency detection (" + inferPatternLang(p) + ")",
					Language:    inferPatternLang(p),
				})
			}
		}
	}
	return out
}

// imRegex serves GET/PUT /api/rainbow/intent-manager/regex —
// the "Priority Keywords" emergency-pattern editor in the Understanding tab.
// GET: returns patterns from emergency-regex.json (user-layer) or, if absent,
//
//	derives them from the emergency entries in intents.json.
//
// PUT: stores {patterns:[...]} to emergency-regex.json for manual application.
func (h *Handler) imRegex(w http.ResponseWriter, r *http.Request) {
	const fname = "emergency-regex.json"
	switch r.Method {
	case http.MethodGet:
		var stored []regexPattern
		if h.readDataJSONReq(r, fname, &stored) && len(stored) > 0 {
			writeJSON(w, 200, stored)
			return
		}
		// Fall back to deriving from the profile's intents.json.
		derived := h.emergencyPatternsFromIntents(r)
		if derived == nil {
			derived = []regexPattern{}
		}
		writeJSON(w, 200, derived)
	case http.MethodPut:
		var body struct {
			Patterns []regexPattern `json:"patterns"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad json"})
			return
		}
		if err := h.writeDataJSONReq(r, fname, body.Patterns); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

// imSystemPrompt serves POST /api/rainbow/intent-manager/system-prompt
// {prompt} — stores the T4 classification system prompt in llm-settings.json
// (systemPrompt), which the classifier reads at startup.
func (h *Handler) imSystemPrompt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	var body struct {
		Prompt string `json:"prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "prompt required"})
		return
	}
	doc := map[string]any{}
	h.readDataJSONReq(r, "llm-settings.json", &doc)
	doc["systemPrompt"] = body.Prompt
	if err := h.writeDataJSONReq(r, "llm-settings.json", doc); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
