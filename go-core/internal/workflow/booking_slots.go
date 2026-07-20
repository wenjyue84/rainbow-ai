package workflow

// Typed slot classifier for the booking flow (FIX 1).
//
// The booking_payment_handler workflow collects four slots — guest_name,
// booking_dates, guest_count, guest_phone. The legacy engine filled them by
// rigid turn order (always asks name first), so a guest who answered out of
// order (a date/phone/number typed at the name step) had it stored as the name
// or rejected in a loop, and the flow never reached the admin-confirm.
//
// This classifier routes each guest reply to the slot it matches by PATTERN,
// not by turn order, and the engine then prompts for whatever is still missing.

import (
	"regexp"
	"strings"
)

// isBookingSlotFlow reports whether a workflow uses the typed booking slots.
// Scoped narrowly so single-slot flows (checkin_full → guest_name only,
// service_request_handler → request_details) keep turn-order behaviour and
// don't regress.
func isBookingSlotFlow(workflowID string) bool {
	return workflowID == "booking_payment_handler"
}

// bookingSlotOrder is the priority order the engine prompts missing slots in.
// Mirrors the original booking graph (name → guests → dates → phone) so the
// happy path is unchanged; out-of-order answers just skip ahead.
var bookingSlotOrder = []string{"guest_name", "guest_count", "booking_dates", "guest_phone"}

// myPhoneRe matches a Malaysian mobile number after spaces/dashes are stripped:
// +60 / 60 / 0 prefix, then 1X and 7-9 more digits (10-11 digits total).
var myPhoneRe = regexp.MustCompile(`^(?:\+?60|0)1\d{7,9}$`)

// bareIntRe matches a reply that is only a small integer (optionally with a
// unit word), used for the guest-count slot.
var bareCountRe = regexp.MustCompile(`^\s*([1-8])\s*(?:pax|ppl|people|persons?|guests?|orang|adults?|人|位|个)?\s*$`)

// classifyBookingSlot routes a guest reply to the booking slot it matches by
// pattern. Returns (slot, normalizedValue, true) on a confident match, or
// ("","",false) when the reply is best treated as the free-text name.
//
// Order of checks (most specific → least):
//  1. MY phone number  → guest_phone
//  2. bare integer 1-8 → guest_count
//  3. a date / range   → booking_dates (resolved to concrete MYT dates)
//  4. otherwise        → name (handled by the caller as free text)
func classifyBookingSlot(reply string) (slot, value string, ok bool) {
	trimmed := strings.TrimSpace(reply)
	if trimmed == "" {
		return "", "", false
	}

	// 1. Malaysian phone number (strip spaces/dashes first).
	compact := strings.NewReplacer(" ", "", "-", "").Replace(trimmed)
	if myPhoneRe.MatchString(compact) {
		return "guest_phone", compact, true
	}

	// 2. Bare small integer 1-8 → guest count. Guard: don't treat a DD/MM or a
	// date token as a count (those are handled next).
	if m := bareCountRe.FindStringSubmatch(trimmed); m != nil {
		return "guest_count", m[1], true
	}

	// 3. Date or date-range (relative or absolute). Reuse ParseDateRange so
	// "today to the day after tomorrow", "25/12", "15 Feb to 17 Feb", "esok",
	// 今天/明天/后天 all resolve to concrete MYT calendar dates.
	if in, out, okD := ParseDateRange(trimmed); okD {
		return "booking_dates", in.Format("2 Jan 2006") + " to " + out.Format("2 Jan 2006"), true
	}

	// 4. Not a phone / count / date → treat as the name (caller applies the
	// name-junk guard so a stray number never lands here as a name).
	return "", "", false
}

// looksLikeBookingNameJunk reports whether a reply is a date/phone/number that
// must never be stored as the guest name. Used by the name-junk capture guard.
func looksLikeBookingNameJunk(reply string) bool {
	_, _, ok := classifyBookingSlot(reply)
	return ok
}

// bookingSlotAck returns a short acknowledgement for an out-of-order slot
// capture ("Got it — check-in 21 Jul 2026.") in the guest's language, so the
// booking flow confirms the answer landed before prompting for the next field.
func bookingSlotAck(slot, value, lang string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	type ack struct{ en, ms, zh string }
	var a ack
	switch slot {
	case "guest_phone":
		a = ack{"Got it — phone " + value + ".", "Baik — telefon " + value + ".", "好的 — 电话 " + value + "。"}
	case "guest_count":
		a = ack{"Got it — " + value + " guest(s).", "Baik — " + value + " tetamu.", "好的 — " + value + " 位客人。"}
	case "booking_dates":
		a = ack{"Got it — " + value + ".", "Baik — " + value + ".", "好的 — " + value + "。"}
	case "guest_name":
		a = ack{"Thanks, " + value + "!", "Terima kasih, " + value + "!", "谢谢，" + value + "！"}
	default:
		return ""
	}
	switch lang {
	case "ms":
		return a.ms
	case "zh":
		return a.zh
	default:
		return a.en
	}
}

// nextEmptyBookingSlot returns the highest-priority booking slot that has not
// yet been captured, or "" when all required slots are filled.
func nextEmptyBookingSlot(data map[string]string) string {
	for _, slot := range bookingSlotOrder {
		if strings.TrimSpace(data[slot]) == "" {
			return slot
		}
	}
	return ""
}

// bookingSlotWaitNode maps a booking slot to the wait_reply node whose prompt
// asks for it, so the engine can re-prompt for a missing slot by name.
var bookingSlotWaitNode = map[string]string{
	"guest_name":    "wait_guest_name",
	"guest_count":   "wait_guest_count",
	"booking_dates": "wait_booking_dates",
	"guest_phone":   "wait_guest_phone",
}
