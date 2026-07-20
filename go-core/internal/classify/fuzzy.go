package classify

import (
	"strings"

	"rainbow-core/internal/config"
)

// FuzzyResult mirrors the Node FuzzyMatchResult.
type FuzzyResult struct {
	Intent         string
	Score          float64
	MatchedKeyword string
}

// FuzzyMatcher approximates the Node Fuse.js keyword matcher (fuzzy-matcher.ts).
// Fuse's exact Bitap scores can't be reproduced, but this yields functional
// parity: it picks the same intent for typo/abbreviation/substring inputs by
// combining exact, substring, token-equality and Levenshtein-ratio matching.
type FuzzyMatcher struct {
	entries []config.KeywordEntry
}

func NewFuzzyMatcher(entries []config.KeywordEntry) *FuzzyMatcher {
	return &FuzzyMatcher{entries: entries}
}

func tokenize(s string) []string {
	return strings.FieldsFunc(strings.ToLower(strings.TrimSpace(s)), func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == ',' || r == '.' || r == '!' || r == '?' || r == ';' || r == ':'
	})
}

// levenshtein computes edit distance between two strings (rune-aware).
func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	la, lb := len(ra), len(rb)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	cur := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		cur[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min3(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[lb]
}

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}

// ratio returns Levenshtein similarity in [0,1].
func ratio(a, b string) float64 {
	maxLen := len([]rune(a))
	if l := len([]rune(b)); l > maxLen {
		maxLen = l
	}
	if maxLen == 0 {
		return 1
	}
	return 1 - float64(levenshtein(a, b))/float64(maxLen)
}

// scoreKeyword computes how well a single keyword matches the user text.
func scoreKeyword(textLower string, textTokens []string, keyword string) (float64, bool) {
	kw := strings.ToLower(strings.TrimSpace(keyword))
	if kw == "" {
		return 0, false
	}
	// Exact whole-text match.
	if textLower == kw {
		return 1.0, true
	}
	isPhrase := strings.Contains(kw, " ")
	// Phrase keyword present as substring (Node substring fallback / Fuse phrase hit).
	if isPhrase {
		if strings.Contains(textLower, kw) {
			return 0.96, true
		}
		// token-set overlap for multi-word keyword
		kwToks := strings.Fields(kw)
		hit := 0
		for _, kt := range kwToks {
			for _, tt := range textTokens {
				if tt == kt {
					hit++
					break
				}
			}
		}
		if hit > 0 {
			frac := float64(hit) / float64(len(kwToks))
			if frac >= 0.6 {
				return 0.80 + 0.15*frac, true // 0.80..0.95
			}
		}
		return 0, false
	}
	// Single-token keyword: substring of any token or whole text.
	for _, tok := range textTokens {
		if tok == kw {
			return 0.95, true
		}
	}
	if strings.Contains(textLower, kw) {
		// CJK has no word spaces, so the whole sentence is one "token" and a
		// 2-char keyword (入住, 毛巾…) can only ever match as a substring.
		if len([]rune(kw)) >= 3 || (len([]rune(kw)) >= 2 && containsHan(kw)) {
			return 0.88, true
		}
	}
	// Levenshtein against closest token (handles typos/abbreviations).
	best := 0.0
	for _, tok := range textTokens {
		// Skip wildly different lengths — Fuse distance/minMatchCharLength guard.
		if len([]rune(tok)) < 2 {
			continue
		}
		if r := ratio(tok, kw); r > best {
			best = r
		}
	}
	if best >= 0.72 { // ~ Fuse threshold 0.3 inverted, conservative
		return best, true
	}
	return 0, false
}

// Match returns the best intent for text, optionally filtered by language.
// langFilter "" means no filter; otherwise keep that lang + always English.
func (m *FuzzyMatcher) Match(text, langFilter string) *FuzzyResult {
	textLower := strings.ToLower(strings.TrimSpace(text))
	if textLower == "" {
		return nil
	}
	textTokens := tokenize(textLower)

	var best *FuzzyResult
	for i := range m.entries {
		e := &m.entries[i]
		if langFilter != "" && e.Lang != langFilter && e.Lang != "en" {
			continue
		}
		score, ok := scoreKeyword(textLower, textTokens, e.Keyword)
		if !ok {
			continue
		}
		// On equal score the longer keyword wins: a specific phrase hit
		// ("i want to check out") must beat a generic fragment ("check out").
		if best == nil || score > best.Score ||
			(score == best.Score && len([]rune(e.Keyword)) > len([]rune(best.MatchedKeyword))) {
			best = &FuzzyResult{Intent: e.Intent, Score: score, MatchedKeyword: e.Keyword}
		}
	}
	return best
}
