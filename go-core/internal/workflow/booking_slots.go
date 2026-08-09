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
	"context"
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

// nameIntroRe strips a "my name is …" style prefix so only the actual name is
// stored ("My name is John Tan" → "John Tan"). Without this, the whole sentence
// became the guest_name (2026-07-21 eval, BOOK-1).
var nameIntroRe = regexp.MustCompile(`(?i)^(?:hi|hello|hey)?[\s,!.]*(?:my\s+name\s+is|i\s+am|i'm|im|this\s+is|name\s*[:\-]|nama\s+saya|saya)\s+(.+)$`)
var zhNameIntroRe = regexp.MustCompile(`^(?:我叫|我是)\s*(.+)$`)

// stripNameIntro returns the bare name from an intro-prefixed reply, or the
// trimmed reply unchanged when no intro is present.
func stripNameIntro(s string) string {
	s = strings.TrimSpace(s)
	if m := nameIntroRe.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	if m := zhNameIntroRe.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	return s
}

// plainNameRe matches a short letters-only phrase (with spaces/dots/dashes)
// that can safely be taken as a person's name inside a compound reply.
var plainNameRe = regexp.MustCompile(`^[\p{L}][\p{L} .'-]{1,40}$`)

// inlineCountRe catches a guest count embedded in a longer segment ("for 2
// people", "we are 5 friends") that bareCountRe (whole-string) would miss.
var inlineCountRe = regexp.MustCompile(`(?i)\b([1-8])\s*(?:pax|ppl|people|persons?|guests?|friends?|orang|adults?|人|位|个)\b`)

var compoundSplitRe = regexp.MustCompile(`[,;\n]|\s+and\s+`)

// nonNameWords are tokens that disqualify a compound segment from being taken
// as the guest name (arrival notes, counts, filler).
var nonNameWords = regexp.MustCompile(`(?i)\b(arriv\w*|around|about|tonight|today|tomorrow|night|pax|people|person|guest|check|book|capsule|pod|please|thanks?)\b|\d`)

// parseCompoundBookingReply splits a multi-part reply ("My name is John Tan, 1
// pax, arriving around 8pm") and routes each segment to its slot. Returns nil
// when the reply has no separators or nothing was recognized, so single-part
// replies keep the existing path.
func parseCompoundBookingReply(reply string) map[string]string {
	parts := compoundSplitRe.Split(reply, -1)
	if len(parts) < 2 {
		return nil
	}
	out := map[string]string{}
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if slot, val, ok := classifyBookingSlot(p); ok {
			if out[slot] == "" {
				out[slot] = val
			}
			continue
		}
		if out["guest_count"] == "" {
			if m := inlineCountRe.FindStringSubmatch(p); m != nil {
				out["guest_count"] = m[1]
				continue
			}
		}
		if out["guest_name"] == "" {
			stripped := stripNameIntro(p)
			if stripped != p && stripped != "" && !looksLikeBookingNameJunk(stripped) {
				out["guest_name"] = stripped
				continue
			}
			if plainNameRe.MatchString(p) && !nonNameWords.MatchString(p) && len(strings.Fields(p)) <= 4 {
				out["guest_name"] = p
				continue
			}
		}
		// Unrecognized tail ("arriving around 8pm") — ignore.
	}
	if len(out) == 0 {
		return nil
	}
	return out
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

// resumeBooking drives the booking flow's slot collection by pattern, not turn
// order. It captures the reply into the correct slot (phone/count/date/name),
// then either re-prompts for the next missing slot or, once name+dates+count are
// captured, re-enters the JSON graph at date validation so the existing
// pastDate / availability / PMS / admin-confirm tail runs unchanged.
func (r *Registry) resumeBooking(ctx context.Context, wf *Workflow, st *State, cur *Node, reply, storeAs string, rc RunContext) (Outcome, error) {
	capturedSlot := "" // which slot this reply filled (for the acknowledgement)
	if compound := parseCompoundBookingReply(reply); compound != nil {
		// Multi-part reply ("My name is John Tan, 1 pax, arriving 8pm") — fill
		// every slot it carries; never overwrite a slot already captured.
		for slot, val := range compound {
			if strings.TrimSpace(st.Data[slot]) == "" {
				st.Data[slot] = val
				if capturedSlot == "" || slot == storeAs {
					capturedSlot = slot
				}
			}
		}
	} else if slot, val, ok := classifyBookingSlot(reply); ok {
		// A typed phone/count/date always routes to its own slot, even if the
		// current prompt was asking for something else (out-of-order answer).
		st.Data[slot] = val
		capturedSlot = slot
	} else if storeAs == "guest_name" || (storeAs != "" && nextEmptyBookingSlot(st.Data) == "guest_name") {
		// Free-text reply at the name step (or the name is the next thing we
		// need) → store as the name, minus any "my name is" intro. The
		// classifier already guarantees this isn't a date/phone/number.
		st.Data["guest_name"] = stripNameIntro(reply)
		capturedSlot = "guest_name"
	} else if storeAs != "" {
		// Free-text reply while we were expecting a structured slot (e.g. junk
		// typed at the dates step). Fall back to the node's own slot via the
		// normal normalizer, which will leave dates empty if unparseable and let
		// validation re-prompt.
		st.Data[storeAs] = normalizeSlot(storeAs, reply)
	}

	// Acknowledge an out-of-order capture: if the slot we just filled is NOT the
	// one this prompt asked for, send a brief "Got it — <slot>." so the guest
	// sees their answer landed before we ask for the next missing field.
	if capturedSlot != "" && capturedSlot != storeAs {
		if ack := bookingSlotAck(capturedSlot, st.Data[capturedSlot], rc.Lang); ack != "" {
			_ = rc.Send(ctx, rc.GuestPhone, ack, rc.InstanceID)
		}
	}

	// If name + dates + guests are all captured, hand off to the JSON graph at
	// date validation so past-date / availability / PMS steps still run. The
	// phone is collected inside that tail (wait_guest_phone), and the skip-filled
	// logic passes it through when already captured.
	if strings.TrimSpace(st.Data["guest_name"]) != "" &&
		strings.TrimSpace(st.Data["booking_dates"]) != "" &&
		strings.TrimSpace(st.Data["guest_count"]) != "" {
		return r.run(ctx, wf, st, "validate_dates", rc)
	}

	// Otherwise re-prompt for the next still-missing slot.
	if slot := nextEmptyBookingSlot(st.Data); slot != "" {
		if nodeID := bookingSlotWaitNode[slot]; nodeID != "" {
			return r.run(ctx, wf, st, nodeID, rc)
		}
	}
	// All slots somehow filled but the guard above didn't fire — proceed.
	return r.run(ctx, wf, st, "validate_dates", rc)
}
