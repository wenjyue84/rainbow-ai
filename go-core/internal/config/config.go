// Package config loads a Rainbow profile's JSON data files (the same files the
// Node app reads from src/assistant/data/) into Go structs. Mirrors config-store +
// profile-registry + intent-config, scoped to what the message pipeline needs.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Route mirrors a routing.json entry: intent -> {action, workflow_id?}.
type Route struct {
	Action     string `json:"action"`
	WorkflowID string `json:"workflow_id,omitempty"`
}

// IntentPattern is a compiled T1 (regex) intent from intents.json.
type IntentPattern struct {
	Category      string
	Patterns      []*regexp.Regexp
	MinConfidence float64
	Enabled       bool
}

// KeywordEntry is one flattened T2 keyword: intent + language + the keyword text.
type KeywordEntry struct {
	Intent  string
	Lang    string // en|ms|zh|ta
	Keyword string
}

// Thresholds mirrors llm-settings.json thresholds.
type Thresholds struct {
	Fuzzy            float64 `json:"fuzzy"`
	Semantic         float64 `json:"semantic"`
	Layer2           float64 `json:"layer2"`
	LLM              float64 `json:"llm"`
	LowConfidence    float64 `json:"lowConfidence"`
	MediumConfidence float64 `json:"mediumConfidence"`
}

// Provider mirrors a settings.json ai.providers[] entry.
type Provider struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	APIKeyEnv string `json:"api_key_env"`
	BaseURL   string `json:"base_url"`
	Model     string `json:"model"`
	Enabled   bool   `json:"enabled"`
	Priority  int    `json:"priority"`
	Available bool   `json:"available"`
	TimeoutMs int    `json:"timeout_ms"`
}

// TierConfig mirrors intent-tiers.json tiers.
type TierConfig struct {
	Tier1Enabled bool
	Tier2Enabled bool
	Tier2Thresh  float64
	Tier3Enabled bool
	Tier3Thresh  float64
	Tier4Enabled bool
}

// Staff mirrors settings.json staff.
type Staff struct {
	Phones      []string `json:"phones"`
	JayPhone    string   `json:"jay_phone"`
	AlstonPhone string   `json:"alston_phone"`
	MayaPhone   string   `json:"maya_phone"`
}

// RoutingMode mirrors settings.json routing_mode.
type RoutingMode struct {
	SplitModel       bool   `json:"splitModel"`
	ClassifyProvider string `json:"classifyProvider"`
	TieredPipeline   bool   `json:"tieredPipeline"`
}

// Profile is the loaded, ready-to-serve config for one business profile.
type Profile struct {
	ID           string
	Patterns     []IntentPattern              // T1 regex
	Keywords     []KeywordEntry               // T2 flattened
	Routing      map[string]Route             // intent -> route
	Static       map[string]map[string]string // intent -> lang -> reply text
	Thresholds   Thresholds
	Providers    []Provider // enabled, priority order
	ProviderByID map[string]Provider
	Selected     []string // selectedProviders ids in priority order
	Tiers        TierConfig
	Staff        Staff
	RoutingMode  RoutingMode
	SystemPrompt string
	// BotName is the display name the LLM uses when introducing itself.
	// Read from settings.json "bot_name"; defaults to "Rainbow" when absent.
	BotName string
	// ClassifyPrompt is the custom T4 intent-classification system prompt from
	// llm-settings.json (systemPrompt). Empty = the classifier's built-in prompt.
	ClassifyPrompt string
	// Allowed is the profile's intent whitelist (intent-whitelists.json). When
	// non-empty, the classifier rejects fast-tier matches for intents not in it —
	// this filters cross-profile contamination (e.g. cafe MENU_* intents that
	// leaked into the hostel keyword/routing files). Empty = allow all.
	Allowed map[string]bool
}

// profileWhitelistKey maps a profile id to its key in intent-whitelists.json.
var profileWhitelistKey = map[string]string{
	"pelangi":     "pms_capsule",
	"pms_capsule": "pms_capsule",
	"southern":    "southern",
	"makan":       "makan",
	"senai-app":   "senai_app",
}

// alwaysAllowed intents bypass the whitelist filter (universal + control intents).
var alwaysAllowed = map[string]bool{
	"greeting": true, "thanks": true, "unknown": true, "general": true,
	"contact_staff": true, "farewell": true, "conversation_reset": true,
}

// IntentAllowed reports whether an intent may be produced by the fast tiers for
// this profile. When no whitelist is loaded, everything is allowed.
func (p *Profile) IntentAllowed(intent string) bool {
	if len(p.Allowed) == 0 {
		return true
	}
	return p.Allowed[intent] || alwaysAllowed[intent]
}

// ─── Raw JSON shapes ────────────────────────────────────────────────────────

type rawIntents struct {
	Categories []struct {
		Intents []struct {
			Category      string   `json:"category"`
			Patterns      []string `json:"patterns"`
			Flags         string   `json:"flags"`
			Enabled       *bool    `json:"enabled"`
			MinConfidence float64  `json:"min_confidence"`
		} `json:"intents"`
	} `json:"categories"`
}

type rawKeywords struct {
	Intents []struct {
		Intent   string                     `json:"intent"`
		Keywords map[string]json.RawMessage `json:"keywords"` // lang -> []keyword, or nested sub-intent objects
	} `json:"intents"`
}

var knownLangs = map[string]bool{"en": true, "ms": true, "zh": true, "ta": true}

// flattenKeywords recursively walks a keywords value, emitting (lang, keyword)
// pairs. Some intents nest sub-intent objects (booking_sub, cancellation…) whose
// leaves are still language→[]string arrays; we attach all of them to the parent
// intent for top-level T2 matching.
func flattenKeywords(raw json.RawMessage, intent, lang string, out *[]KeywordEntry) {
	var arr []string
	if err := json.Unmarshal(raw, &arr); err == nil {
		for _, kw := range arr {
			kw = strings.ToLower(strings.TrimSpace(kw))
			if kw != "" {
				*out = append(*out, KeywordEntry{Intent: intent, Lang: lang, Keyword: kw})
			}
		}
		return
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err == nil {
		for k, v := range obj {
			nl := lang
			if knownLangs[k] {
				nl = k
			}
			flattenKeywords(v, intent, nl, out)
		}
	}
}

type rawKnowledge struct {
	Static []struct {
		Intent   string            `json:"intent"`
		Response map[string]string `json:"response"`
	} `json:"static"`
}

type rawLLMSettings struct {
	Thresholds Thresholds `json:"thresholds"`
	Selected   []struct {
		ID       string `json:"id"`
		Priority int    `json:"priority"`
	} `json:"selectedProviders"`
	DefaultProviderID string `json:"defaultProviderId"`
	SystemPrompt      string `json:"systemPrompt"`
}

type rawSettings struct {
	AI struct {
		Providers []Provider `json:"providers"`
	} `json:"ai"`
	RoutingMode  RoutingMode `json:"routing_mode"`
	Staff        Staff       `json:"staff"`
	SystemPrompt string      `json:"system_prompt"`
	BotName      string      `json:"bot_name"`
}

type rawTiers struct {
	Tiers struct {
		T1 struct {
			Enabled bool `json:"enabled"`
		} `json:"tier1_emergency"`
		T2 struct {
			Enabled   bool    `json:"enabled"`
			Threshold float64 `json:"threshold"`
		} `json:"tier2_fuzzy"`
		T3 struct {
			Enabled   bool    `json:"enabled"`
			Threshold float64 `json:"threshold"`
		} `json:"tier3_semantic"`
		T4 struct {
			Enabled bool `json:"enabled"`
		} `json:"tier4_llm"`
	} `json:"tiers"`
}

// ─── Loader ─────────────────────────────────────────────────────────────────

// readJSON reads + unmarshals a data file; returns os.ErrNotExist if missing.
func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("parse %s: %w", filepath.Base(path), err)
	}
	return nil
}

// pick returns the first existing file among candidates (profile-specific first).
func pick(dataDir string, names ...string) string {
	for _, n := range names {
		p := filepath.Join(dataDir, n)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return filepath.Join(dataDir, names[len(names)-1]) // last as default
}

// Load reads all files needed for the message pipeline for the given profile.
// dataDir is e.g. src/assistant/data (or dist/assistant/data). profile is the
// profile id ("pelangi", "southern", "makan").
func Load(dataDir, profile string) (*Profile, error) {
	p := &Profile{
		ID:           profile,
		Routing:      map[string]Route{},
		Static:       map[string]map[string]string{},
		ProviderByID: map[string]Provider{},
	}

	// T1 patterns — intents.json (shared) or intents-<profile>.json
	var ri rawIntents
	if err := readJSON(pick(dataDir, "intents-"+profile+".json", "intents.json"), &ri); err != nil {
		return nil, fmt.Errorf("load intents: %w", err)
	}
	for _, cat := range ri.Categories {
		for _, it := range cat.Intents {
			if it.Category == "" {
				continue
			}
			enabled := it.Enabled == nil || *it.Enabled
			ip := IntentPattern{Category: it.Category, MinConfidence: it.MinConfidence, Enabled: enabled}
			flagPrefix := ""
			if strings.Contains(it.Flags, "i") {
				flagPrefix = "(?i)"
			}
			for _, pat := range it.Patterns {
				re, err := regexp.Compile(flagPrefix + pat)
				if err != nil {
					// RE2 can't compile some JS regexes; skip rather than abort.
					continue
				}
				ip.Patterns = append(ip.Patterns, re)
			}
			if len(ip.Patterns) > 0 {
				p.Patterns = append(p.Patterns, ip)
			}
		}
	}

	// T2 keywords — intent-keywords-<profile>.json (fallback intent-keywords.json)
	var rk rawKeywords
	if err := readJSON(pick(dataDir, "intent-keywords-"+profile+".json", "intent-keywords.json"), &rk); err != nil {
		return nil, fmt.Errorf("load keywords: %w", err)
	}
	for _, ent := range rk.Intents {
		for lang, raw := range ent.Keywords {
			// Only known language keys are keyword lists (Node parity: the
			// fuzzy matcher reads keywords.en/ms/zh/ta). Nested sub-group keys
			// (booking_sub, regional_variants…) would otherwise be flattened
			// into the PARENT intent — that once turned "cancel" into a
			// booking keyword and hijacked every cancellation message.
			if !knownLangs[lang] {
				continue
			}
			flattenKeywords(raw, ent.Intent, lang, &p.Keywords)
		}
	}

	// Knowledge / static replies — knowledge.json
	var rn rawKnowledge
	if err := readJSON(pick(dataDir, "knowledge-"+profile+".json", "knowledge.json"), &rn); err != nil {
		return nil, fmt.Errorf("load knowledge: %w", err)
	}
	for _, s := range rn.Static {
		if s.Intent == "" {
			continue
		}
		p.Static[s.Intent] = s.Response
	}

	// Routing — routing.json (or routing-<profile>.json)
	if err := readJSON(pick(dataDir, "routing-"+profile+".json", "routing.json"), &p.Routing); err != nil {
		return nil, fmt.Errorf("load routing: %w", err)
	}

	// llm-settings.json — thresholds + selected providers (profile-specific first)
	var rl rawLLMSettings
	if err := readJSON(pick(dataDir, "llm-settings-"+profile+".json", "llm-settings.json"), &rl); err == nil {
		p.Thresholds = rl.Thresholds
		p.ClassifyPrompt = strings.TrimSpace(rl.SystemPrompt)
		sort.Slice(rl.Selected, func(i, j int) bool { return rl.Selected[i].Priority < rl.Selected[j].Priority })
		for _, s := range rl.Selected {
			p.Selected = append(p.Selected, s.ID)
		}
	}
	if p.Thresholds.Fuzzy == 0 {
		p.Thresholds = Thresholds{Fuzzy: 0.85, Semantic: 0.6, Layer2: 0.75, LLM: 0.55, LowConfidence: 0.5, MediumConfidence: 0.7}
	}

	// settings.json — providers, routing_mode, staff
	var rs rawSettings
	if err := readJSON(pick(dataDir, "settings-"+profile+".json", "settings.json"), &rs); err == nil {
		for _, pr := range rs.AI.Providers {
			p.ProviderByID[pr.ID] = pr
			if pr.Enabled {
				p.Providers = append(p.Providers, pr)
			}
		}
		sort.Slice(p.Providers, func(i, j int) bool { return p.Providers[i].Priority < p.Providers[j].Priority })
		p.RoutingMode = rs.RoutingMode
		p.Staff = rs.Staff
		p.SystemPrompt = rs.SystemPrompt
		if rs.BotName != "" {
			p.BotName = rs.BotName
		}
	}
	if p.BotName == "" {
		p.BotName = "Rainbow"
	}

	// intent-whitelists.json — per-profile allowed intents (contamination filter)
	if key, ok := profileWhitelistKey[profile]; ok {
		var wl map[string]json.RawMessage
		if err := readJSON(pick(dataDir, "intent-whitelists.json"), &wl); err == nil {
			if raw, ok := wl[key]; ok {
				var list []string
				if json.Unmarshal(raw, &list) == nil && len(list) > 0 {
					p.Allowed = map[string]bool{}
					for _, intent := range list {
						p.Allowed[intent] = true
					}
				}
			}
		}
	}

	// intent-tiers.json — tier toggles (defaults if absent)
	p.Tiers = TierConfig{Tier1Enabled: true, Tier2Enabled: true, Tier2Thresh: 0.80, Tier3Enabled: true, Tier3Thresh: 0.67, Tier4Enabled: true}
	var rt rawTiers
	if err := readJSON(pick(dataDir, "intent-tiers.json"), &rt); err == nil {
		p.Tiers = TierConfig{
			Tier1Enabled: rt.Tiers.T1.Enabled,
			Tier2Enabled: rt.Tiers.T2.Enabled,
			Tier2Thresh:  orDefault(rt.Tiers.T2.Threshold, 0.80),
			Tier3Enabled: rt.Tiers.T3.Enabled,
			Tier3Thresh:  orDefault(rt.Tiers.T3.Threshold, 0.67),
			Tier4Enabled: rt.Tiers.T4.Enabled,
		}
	}

	return p, nil
}

func orDefault(v, d float64) float64 {
	if v == 0 {
		return d
	}
	return v
}

// RouteFor returns the route for an intent, defaulting to llm_reply.
func (p *Profile) RouteFor(intent string) Route {
	if r, ok := p.Routing[intent]; ok {
		return r
	}
	return Route{Action: "llm_reply"}
}

// StaticReply returns the static reply for an intent in the given language,
// falling back to English then any available language.
func (p *Profile) StaticReply(intent, lang string) (string, bool) {
	m, ok := p.Static[intent]
	if !ok {
		return "", false
	}
	if v, ok := m[lang]; ok && v != "" {
		return v, true
	}
	if v, ok := m["en"]; ok && v != "" {
		return v, true
	}
	for _, v := range m {
		if v != "" {
			return v, true
		}
	}
	return "", false
}
