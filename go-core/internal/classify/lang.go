package classify

import (
	"strings"
	"unicode"
)

// DetectLanguage is a lightweight language detector (en|ms|zh|ta) approximating
// the Node formatter.detectLanguage heuristics: script detection first, then a
// Malay function-word check, defaulting to English.
func DetectLanguage(text string) string {
	if text == "" {
		return "en"
	}
	var han, tamil, latin int
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Han, r):
			han++
		case unicode.Is(unicode.Tamil, r):
			tamil++
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z':
			latin++
		}
	}
	if han > 0 {
		return "zh"
	}
	if tamil > 0 {
		return "ta"
	}
	// Malay function-word heuristic.
	lower := strings.ToLower(text)
	for _, w := range malayMarkers {
		if containsWord(lower, w) {
			return "ms"
		}
	}
	return "en"
}

var malayMarkers = []string{
	"saya", "awak", "boleh", "nak", "tak", "tidak", "berapa", "bilik", "malam",
	"harga", "ada", "macam", "mana", "bayar", "selamat", "terima kasih", "khabar",
	"betul", "sini", "sana", "dengan", "untuk", "yang",
}

func containsWord(text, word string) bool {
	idx := 0
	for {
		i := strings.Index(text[idx:], word)
		if i < 0 {
			return false
		}
		start := idx + i
		end := start + len(word)
		leftOK := start == 0 || !isWordChar(rune(text[start-1]))
		rightOK := end >= len(text) || !isWordChar(rune(text[end]))
		if leftOK && rightOK {
			return true
		}
		idx = start + 1
		if idx >= len(text) {
			return false
		}
	}
}

func isWordChar(r rune) bool {
	return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

// containsHan reports whether s contains any Han (Chinese) character.
func containsHan(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}
