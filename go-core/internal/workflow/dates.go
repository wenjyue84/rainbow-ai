package workflow

// Date parsing for guest-typed booking dates: absolute tokens ("15 Feb",
// "25/12/2026"), relative words ("today", "tmr", "esok", 今天/明天/后天),
// and loose layouts. Extracted from workflow.go 2026-07-21 (cohesion split).

import (
	"regexp"
	"strings"
	"time"
)

// dateTokenRe finds date-like tokens inside free text: "8 Jul", "15 Feb 2026",
// "15/2/2026", "15/2", "2026-07-08".
var dateTokenRe = regexp.MustCompile(`(?i)\b(\d{1,2}\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s?\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?\d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b`)

// monthWordRe truncates long month words ("february" → "feb") so the loose
// layouts can parse them.
var monthWordRe = regexp.MustCompile(`(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]+`)

// relativeDateRe matches relative day phrases guests use instead of calendar
// dates ("today", "tmr", "the day after tomorrow", Malay "esok"/"lusa",
// Chinese 今天/明天/后天). Longest phrases come first so "day after tomorrow"
// wins over the trailing "tomorrow".
var relativeDateRe = regexp.MustCompile(`(?i)the day after tomorrow|day after tomorrow|day after tmr|esok lusa|hari ini|harini|today|tonight|tonite|tomorrow|tomorow|tmrw|tmr|esok|lusa|今天|今日|明天|明日|后天|後天`)

// relativeOffsetDays maps a relative day word to a day offset from today.
func relativeOffsetDays(word string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(word)) {
	case "today", "tonight", "tonite", "hari ini", "harini", "今天", "今日":
		return 0, true
	case "tomorrow", "tomorow", "tmr", "tmrw", "esok", "明天", "明日":
		return 1, true
	case "the day after tomorrow", "day after tomorrow", "day after tmr", "esok lusa", "lusa", "后天", "後天":
		return 2, true
	}
	return 0, false
}

// relativeDatesIn resolves relative day words in a guest reply to concrete
// local-midnight dates, in order of appearance (up to two). Callers use this
// only when no absolute calendar date is present, so "tonight 25/12" still
// keys off 25/12 rather than tonight.
func relativeDatesIn(s string) []time.Time {
	now := time.Now()
	base := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	var out []time.Time
	for _, loc := range relativeDateRe.FindAllStringIndex(s, -1) {
		if off, ok := relativeOffsetDays(s[loc[0]:loc[1]]); ok {
			out = append(out, base.AddDate(0, 0, off))
			if len(out) == 2 {
				break
			}
		}
	}
	return out
}

// ParseDateRange extracts the first two date-like tokens from free text
// ("Check-in: 25 Jul, Check-out: 26 Jul") as local-midnight times. When only
// one date parses, checkOut defaults to checkIn+1 night. ok=false when no
// date-like token parses at all.
func ParseDateRange(s string) (checkIn, checkOut time.Time, ok bool) {
	var dates []time.Time
	for _, tok := range dateTokenRe.FindAllString(s, -1) {
		tok = monthWordRe.ReplaceAllStringFunc(tok, func(m string) string { return m[:3] })
		if t, okTok := parseLooseDate(tok); okTok {
			dates = append(dates, t)
			if len(dates) == 2 {
				break
			}
		}
	}
	if len(dates) == 0 {
		// No absolute calendar date → fall back to relative words
		// ("today", "tmr", "esok", "the day after tomorrow", 今天/明天/后天).
		dates = relativeDatesIn(s)
	}
	if len(dates) == 0 {
		return time.Time{}, time.Time{}, false
	}
	checkIn = dates[0]
	if len(dates) > 1 && dates[1].After(dates[0]) {
		checkOut = dates[1]
	} else {
		checkOut = checkIn.AddDate(0, 0, 1)
	}
	return checkIn, checkOut, true
}

// firstDateIn extracts the first date-like token from free text ("Check-in:
// 8 Jul, Check-out: 9 Jul" → 8 Jul of the current year) and parses it.
func firstDateIn(s string) (time.Time, bool) {
	tok := dateTokenRe.FindString(s)
	if tok == "" {
		if ds := relativeDatesIn(s); len(ds) > 0 {
			return ds[0], true
		}
		return time.Time{}, false
	}
	tok = monthWordRe.ReplaceAllStringFunc(tok, func(m string) string { return m[:3] })
	return parseLooseDate(tok)
}

// looseMonthRe title-cases a 3-letter month so Go's "Jan" layout matches.
var looseMonthRe = regexp.MustCompile(`\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b`)

// parseLooseDate parses common "15 Feb" / "15/2/2026" forms; ok=false if unknown.
func parseLooseDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(strings.ToLower(s))
	// Go layouts use the reference month "Jan" — title-case the month token.
	s = looseMonthRe.ReplaceAllStringFunc(s, func(m string) string {
		return strings.ToUpper(m[:1]) + m[1:]
	})
	layouts := []string{"2 Jan", "2 Jan 2006", "2Jan", "02/01/2006", "2/1/2006", "2/1", "02-01-2006", "2006-01-02", "Jan 2"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			hadYear := t.Year() != 0
			year := t.Year()
			if !hadYear {
				year = time.Now().Year()
			}
			// Normalize to local midnight — time.Parse yields UTC, and mixing
			// UTC dates with local "today" shifts the calendar day near
			// midnight MYT.
			t = time.Date(year, t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
			// No explicit year and the date passed more than a week ago →
			// the guest means the next occurrence ("15 Feb" said in July).
			// A date within the last few days stays past (likely a typo,
			// let the workflow re-prompt).
			if !hadYear && t.Before(time.Now().AddDate(0, 0, -7)) {
				t = t.AddDate(1, 0, 0)
			}
			return t, true
		}
	}
	return time.Time{}, false
}
