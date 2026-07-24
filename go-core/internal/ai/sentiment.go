package ai

import "strings"

// negativePatterns is a keyword/emoji list ported from the Node
// sentiment-tracker.ts NEGATIVE_PATTERNS. Pure substring match — no LLM. Used to
// decide whether a guest turn is unhappy/angry so the reply can gently re-note
// that Rainbow is an AI assistant and offer a human handoff.
var negativePatterns = []string{
	// English — expletives & strong language
	"shit", "crap", "damn", "bloody", "bullshit",
	// English — complaints & frustration
	"bad", "terrible", "awful", "worst", "horrible", "useless",
	"stupid", "idiot", "hate", "angry", "frustrated", "frustrating", "annoying",
	"disappointed", "waste", "suck", "pathetic", "ridiculous",
	"unacceptable", "disgust", "furious", "outrage",
	// English — problems & dissatisfaction
	"not working", "doesn't work", "don't work", "not fixed", "still broken",
	// Stronger indicators
	"complaint", "complain", "refund", "lawyer", "speak to manager",
	// Emojis
	"😠", "😡", "🤬", "👎", "💢", "😤", "😒", "🙄",
	// Malay
	"teruk", "buruk", "tak baik", "tidak baik", "rosak", "marah", "kecewa", "aduan",
	// Chinese
	"生气", "失望", "糟糕", "投诉", "退款",
}

// IsNegative reports whether the text contains any negative-sentiment keyword or
// emoji. Case-insensitive substring match (parity with analyzeSentiment).
func IsNegative(text string) bool {
	n := strings.ToLower(strings.TrimSpace(text))
	if n == "" {
		return false
	}
	for _, p := range negativePatterns {
		if strings.Contains(n, p) {
			return true
		}
	}
	return false
}
