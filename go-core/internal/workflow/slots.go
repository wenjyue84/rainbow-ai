package workflow

// Slot value normalization shared by every wait_reply node ("My phone number
// is 60127088789" → "60127088789"). Extracted from workflow.go 2026-07-21.

import (
	"regexp"
	"strings"
)

var (
	slotPhoneRe = regexp.MustCompile(`\+?\d[\d \-]{5,}\d`)
	slotIntRe   = regexp.MustCompile(`\d+`)
)

// normalizeSlot cleans slot values guests wrap in sentences before storing
// ("My phone number is 60127088789" → "60127088789"; "1 adult only." → "1").
// Unrecognized values are stored as-is.
func normalizeSlot(storeAs, reply string) string {
	switch {
	case strings.Contains(storeAs, "phone"):
		best := ""
		for _, m := range slotPhoneRe.FindAllString(reply, -1) {
			clean := strings.NewReplacer(" ", "", "-", "").Replace(m)
			if len(clean) > len(best) {
				best = clean
			}
		}
		if len(strings.TrimPrefix(best, "+")) >= 7 {
			return best
		}
	case strings.Contains(storeAs, "count"):
		if m := slotIntRe.FindString(reply); m != "" {
			return m
		}
		words := map[string]string{
			"one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
			"six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
			"satu": "1", "dua": "2", "tiga": "3", "empat": "4", "lima": "5",
		}
		low := strings.ToLower(reply)
		for w, n := range words {
			if strings.Contains(low, w) {
				return n
			}
		}
	case strings.Contains(strings.ToLower(storeAs), "date"):
		// Expand relative words ("today", "tmr", "esok", "the day after
		// tomorrow", 今天/明天/后天) and loose formats into a concrete
		// "2 Jan 2006 to 3 Jan 2006" range, so the workflow's date-format
		// regex, pastDateCheck, and the confirmation message all see real
		// calendar dates instead of re-prompting the guest.
		if in, out, ok := ParseDateRange(reply); ok {
			return in.Format("2 Jan 2006") + " to " + out.Format("2 Jan 2006")
		}
	}
	return reply
}

func normalizePhone(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || strings.Contains(p, "@") {
		return p
	}
	return p // engine's sender adds the @s.whatsapp.net suffix
}
