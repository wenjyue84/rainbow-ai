package classify

import (
	"context"
	"strings"

	"rainbow-core/internal/config"
)

// Source is the tier that produced a classification.
type Source string

const (
	SrcRegex    Source = "regex"
	SrcFuzzy    Source = "fuzzy"
	SrcSemantic Source = "semantic"
	SrcLLM      Source = "llm"
)

// Result mirrors the relevant fields of Node IntentResult.
type Result struct {
	Category       string
	Confidence     float64
	Source         Source
	MatchedKeyword string
	Lang           string
}

// LLMClassifier is injected by the router (the AI provider manager). It returns
// the T4 classification + reply for a message when fast tiers miss.
type LLMClassifier interface {
	Classify(ctx context.Context, text, systemPrompt string, history []string) (Result, error)
}

// Classifier runs the tiered pipeline (T1 regex → T2 fuzzy → T4 LLM).
// T3 semantic is delegated to the ML sidecar (added later); when absent the
// pipeline degrades gracefully to T1/T2/T4, matching the Node tier toggles.
type Classifier struct {
	prof  *config.Profile
	fuzzy *FuzzyMatcher
	llm   LLMClassifier
	embed Semantic // optional T3
}

// Semantic is the optional T3 tier backed by the Node ML sidecar.
type Semantic interface {
	Match(ctx context.Context, text string) (intent string, score float64, example string, err error)
}

func New(prof *config.Profile, llm LLMClassifier) *Classifier {
	// Filter T2 keyword entries through the profile whitelist so cross-profile
	// contamination (e.g. cafe MENU_* intents in the hostel file) can't be matched.
	kws := prof.Keywords
	if len(prof.Allowed) > 0 {
		filtered := make([]config.KeywordEntry, 0, len(kws))
		for _, k := range kws {
			if prof.IntentAllowed(k.Intent) {
				filtered = append(filtered, k)
			}
		}
		kws = filtered
	}
	return &Classifier{prof: prof, fuzzy: NewFuzzyMatcher(kws), llm: llm}
}

// WithSemantic attaches an optional T3 semantic tier.
func (c *Classifier) WithSemantic(s Semantic) *Classifier { c.embed = s; return c }

// Classify runs the tiered pipeline and returns the best intent.
func (c *Classifier) Classify(ctx context.Context, text string, history []string) Result {
	lang := DetectLanguage(text)

	// ── T1: regex patterns ──────────────────────────────────────────────
	// A social-only match (greeting/thanks/farewell) on a message that carries
	// more than the nicety ("Hi, can I check in tonight?") is deferred: the
	// deeper tiers get a chance to find the substantive intent, and the social
	// result is only used when they all miss.
	var deferred *Result
	if c.prof.Tiers.Tier1Enabled {
		if r := c.matchRegex(text); r != nil {
			r.Lang = lang
			if socialIntents[r.Category] && len(strings.Fields(text)) > 3 {
				deferred = r
			} else {
				return *r
			}
		}
	}

	// ── T2: fuzzy keyword ───────────────────────────────────────────────
	if c.prof.Tiers.Tier2Enabled {
		if fr := c.fuzzy.Match(text, lang); fr != nil {
			// Tier2Thresh (from intent-tiers.json, admin-configurable) wins;
			// Thresholds.Fuzzy is the hardcoded default fallback.
			gate := c.prof.Tiers.Tier2Thresh
			if gate == 0 {
				gate = c.prof.Thresholds.Fuzzy
			}
			if fr.Score >= gate {
				r := Result{Category: fr.Intent, Confidence: fr.Score, Source: SrcFuzzy, MatchedKeyword: fr.MatchedKeyword, Lang: lang}
				if socialIntents[r.Category] && len(strings.Fields(text)) > 3 {
					if deferred == nil {
						deferred = &r
					}
				} else {
					return r
				}
			}
		}
	}

	// ── T3: semantic (sidecar, optional) ────────────────────────────────
	if c.prof.Tiers.Tier3Enabled && c.embed != nil {
		if intent, score, ex, err := c.embed.Match(ctx, text); err == nil && intent != "" && c.prof.IntentAllowed(intent) {
			if score >= c.prof.Tiers.Tier3Thresh {
				r := Result{Category: intent, Confidence: score, Source: SrcSemantic, MatchedKeyword: ex, Lang: lang}
				if socialIntents[r.Category] && len(strings.Fields(text)) > 3 {
					if deferred == nil {
						deferred = &r
					}
				} else {
					return r
				}
			}
		}
	}

	// ── T4: LLM ─────────────────────────────────────────────────────────
	if c.prof.Tiers.Tier4Enabled && c.llm != nil {
		if r, err := c.llm.Classify(ctx, text, c.prof.SystemPrompt, history); err == nil && r.Category != "" {
			r.Source = SrcLLM
			// Script detection (Han/Tamil) is deterministic — never let the
			// LLM's language guess override it (it labelled 中文 as "en").
			if r.Lang == "" || lang == "zh" || lang == "ta" {
				r.Lang = lang
			}
			// Don't let a generic LLM "unknown" beat a deferred social match.
			// Likewise, when the LLM ALSO lands on a social nicety, the T1
			// pattern match is the more precise one — the LLM labelled
			// "thank you so much, you've been really helpful" as greeting
			// (2026-07-21 human-support eval, H12).
			if socialIntents[r.Category] && deferred != nil {
				return *deferred
			}
			if r.Category != "unknown" || deferred == nil {
				return r
			}
		}
	}

	if deferred != nil {
		return *deferred
	}
	return Result{Category: "unknown", Confidence: 0, Source: SrcLLM, Lang: lang}
}

// SubstantiveMatch returns a T1+T2 match for a substantive (non-social, non-workflow)
// intent, or nil. Used by the router to detect an off-flow question typed while a
// workflow is awaiting a slot value.
func (c *Classifier) SubstantiveMatch(text string, lang string) *Result {
	// T1 first.
	if r := c.matchRegex(text); r != nil && !socialIntents[r.Category] {
		return r
	}
	// T2 fuzzy — catches "what time is check out?" via checkin_info keywords.
	if c.prof.Tiers.Tier2Enabled {
		if fr := c.fuzzy.Match(text, lang); fr != nil {
			gate := c.prof.Thresholds.Fuzzy
			if gate == 0 {
				gate = c.prof.Tiers.Tier2Thresh
			}
			if fr.Score >= gate && !socialIntents[fr.Intent] {
				return &Result{Category: fr.Intent, Confidence: fr.Score, Source: SrcFuzzy, MatchedKeyword: fr.MatchedKeyword, Lang: lang}
			}
		}
	}
	return nil
}

// MatchT1 runs only the T1 regex tier. Returns nil on miss or when T1 is disabled.
func (c *Classifier) MatchT1(text string) *Result {
	if !c.prof.Tiers.Tier1Enabled {
		return nil
	}
	r := c.matchRegex(text)
	if r != nil && r.Lang == "" {
		r.Lang = DetectLanguage(text)
	}
	return r
}

// MatchT2 runs only the T2 fuzzy tier. Returns nil on miss, below threshold, or when disabled.
func (c *Classifier) MatchT2(text, lang string) *Result {
	if !c.prof.Tiers.Tier2Enabled {
		return nil
	}
	fr := c.fuzzy.Match(text, lang)
	if fr == nil {
		return nil
	}
	gate := c.prof.Thresholds.Fuzzy
	if gate == 0 {
		gate = c.prof.Tiers.Tier2Thresh
	}
	if fr.Score < gate {
		return nil
	}
	return &Result{
		Category:       fr.Intent,
		Confidence:     fr.Score,
		Source:         SrcFuzzy,
		MatchedKeyword: fr.MatchedKeyword,
		Lang:           lang,
	}
}

// HasSemantic reports whether the T3 semantic sidecar is attached.
func (c *Classifier) HasSemantic() bool { return c.embed != nil }

// MatchT3 runs the T3 semantic tier. Returns nil on miss, error, or when absent/disabled.
func (c *Classifier) MatchT3(ctx context.Context, text, lang string) *Result {
	if !c.prof.Tiers.Tier3Enabled || c.embed == nil {
		return nil
	}
	intent, score, ex, err := c.embed.Match(ctx, text)
	if err != nil || intent == "" || !c.prof.IntentAllowed(intent) {
		return nil
	}
	if score < c.prof.Tiers.Tier3Thresh {
		return nil
	}
	return &Result{
		Category:       intent,
		Confidence:     score,
		Source:         SrcSemantic,
		MatchedKeyword: ex,
		Lang:           lang,
	}
}

// MatchT4 runs the T4 LLM tier. Returns (zero Result, error) on failure or when disabled.
func (c *Classifier) MatchT4(ctx context.Context, text, lang string, history []string) (Result, error) {
	if !c.prof.Tiers.Tier4Enabled || c.llm == nil {
		return Result{}, nil
	}
	r, err := c.llm.Classify(ctx, text, c.prof.SystemPrompt, history)
	if err != nil {
		return Result{}, err
	}
	r.Source = SrcLLM
	if r.Lang == "" || lang == "zh" || lang == "ta" {
		r.Lang = lang
	}
	return r, nil
}

// socialIntents are conversational niceties whose patterns often match a mere
// prefix of a longer message ("Hi, got capsule tonight?"). When any substantive
// intent also matches, the substantive one wins; a social match is only
// returned when nothing else matched.
var socialIntents = map[string]bool{"greeting": true, "thanks": true, "farewell": true}

// matchRegex returns the first enabled substantive intent whose pattern
// matches, falling back to the first social match (greeting/thanks/farewell).
func (c *Classifier) matchRegex(text string) *Result {
	t := strings.TrimSpace(text)
	var social *Result
	for i := range c.prof.Patterns {
		ip := &c.prof.Patterns[i]
		if !ip.Enabled || !c.prof.IntentAllowed(ip.Category) {
			continue
		}
		for _, re := range ip.Patterns {
			if re.MatchString(t) {
				conf := ip.MinConfidence
				if conf == 0 {
					conf = 0.95
				}
				r := &Result{Category: ip.Category, Confidence: conf, Source: SrcRegex, MatchedKeyword: re.String()}
				if socialIntents[ip.Category] {
					if social == nil {
						social = r
					}
					break // keep scanning for a substantive intent
				}
				return r
			}
		}
	}
	return social
}
