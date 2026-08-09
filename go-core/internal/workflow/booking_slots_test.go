package workflow

// FIX 1 (typed slot classifier) tests: a guest can answer the booking flow's
// slots in ANY order and the flow captures each into the right slot, prompts
// only for what's missing, never stores a date/phone/number as the name, and
// finally reaches the admin-confirm.

import (
	"context"
	"strings"
	"testing"
)

func TestClassifyBookingSlot(t *testing.T) {
	cases := []struct {
		in   string
		slot string
	}{
		{"0123456789", "guest_phone"},
		{"+60123456789", "guest_phone"},
		{"012-345 6789", "guest_phone"},
		{"60127088789", "guest_phone"},
		{"2", "guest_count"},
		{"5 pax", "guest_count"},
		{"3 people", "guest_count"},
		{"today", "booking_dates"},
		{"tomorrow", "booking_dates"},
		{"25/12", "booking_dates"},
		{"15 Feb to 17 Feb", "booking_dates"},
		{"today to the day after tomorrow", "booking_dates"},
		{"John Tan", ""},      // name → no structured slot
		{"Ali bin Ahmad", ""}, // name → no structured slot
	}
	for _, c := range cases {
		slot, _, ok := classifyBookingSlot(c.in)
		if c.slot == "" {
			if ok {
				t.Errorf("%q: expected name (no slot), got slot=%q", c.in, slot)
			}
			continue
		}
		if !ok || slot != c.slot {
			t.Errorf("%q: expected slot=%q, got slot=%q ok=%v", c.in, c.slot, slot, ok)
		}
	}
}

// bookingRC builds a run context with a PMS that reports availability + creates
// a pending reservation, so the full happy path reaches admin-confirm.
func bookingRC(cap *capture) RunContext {
	r := rc(cap)
	return r
}

func bookingPMS() fakePMS {
	return fakePMS{ok: true, outputs: map[string]string{
		"available_count":     "3",
		"reservation_created": "true",
		"confirmation_number": "PLG-TEST-001",
	}}
}

// TestBookingOutOfOrderPhoneFirst: guest answers phone, then count, then dates,
// then name — each captured into the right slot; ends at admin-confirm.
func TestBookingOutOfOrderFullFlow(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := bookingRC(cap)
	rcx.PMS = bookingPMS()

	st, out, err := reg.Start(context.Background(), "booking_payment_handler", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !out.Paused {
		t.Fatalf("expected pause after start, got %+v", out)
	}
	// Answer in a scrambled order: phone, guests, dates, name.
	for _, reply := range []string{"0123456789", "2", "today to the day after tomorrow", "John Tan"} {
		out, err = reg.Resume(context.Background(), st, reply, rcx)
		if err != nil {
			t.Fatalf("Resume(%q): %v", reply, err)
		}
		if out.Escalated {
			t.Fatalf("booking escalated unexpectedly at %q: %+v", reply, out)
		}
	}
	if st.Data["guest_phone"] != "0123456789" {
		t.Errorf("phone slot wrong: %q", st.Data["guest_phone"])
	}
	if st.Data["guest_count"] != "2" {
		t.Errorf("count slot wrong: %q", st.Data["guest_count"])
	}
	if !strings.Contains(st.Data["booking_dates"], " to ") {
		t.Errorf("dates slot not a range: %q", st.Data["booking_dates"])
	}
	if st.Data["guest_name"] != "John Tan" {
		t.Errorf("name slot wrong: %q", st.Data["guest_name"])
	}
	// Never store a date/phone/number as the name.
	if looksLikeBookingNameJunk(st.Data["guest_name"]) {
		t.Errorf("name slot holds junk: %q", st.Data["guest_name"])
	}
	admin := adminText(cap, "60199")
	if !strings.Contains(admin, "New Booking Request") {
		t.Errorf("admin was not notified of the booking:\n%s", admin)
	}
	guest := allGuestText(cap, "60123")
	if !strings.Contains(guest, "John Tan") {
		t.Errorf("confirm summary should name the guest:\n%s", guest)
	}
}

// TestBookingDateAtNameStep: guest types a date at the name step → captured as
// check-in, and the flow then asks for the name (no re-prompt loop).
func TestBookingDateAtNameStep(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := bookingRC(cap)
	rcx.PMS = bookingPMS()

	st, _, err := reg.Start(context.Background(), "booking_payment_handler", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	out, err := reg.Resume(context.Background(), st, "today", rcx)
	if err != nil {
		t.Fatalf("Resume(today): %v", err)
	}
	if out.Escalated || out.Done {
		t.Fatalf("expected pause asking for name, got %+v", out)
	}
	if strings.TrimSpace(st.Data["booking_dates"]) == "" {
		t.Errorf("date at name step should be captured as check-in, got empty")
	}
	if st.Data["guest_name"] != "" {
		t.Errorf("name must NOT be set to a date, got %q", st.Data["guest_name"])
	}
	if !strings.Contains(strings.ToLower(cap.last()), "name") {
		t.Errorf("after capturing the date, should ask for the name, got %q", cap.last())
	}
}

// TestBookingNormalOrderStillWorks: the classic name-first order still reaches
// admin-confirm (no regression to the happy path).
func TestBookingNormalOrderStillWorks(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := bookingRC(cap)
	rcx.PMS = bookingPMS()

	st, _, err := reg.Start(context.Background(), "booking_payment_handler", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	for _, reply := range []string{"John Tan", "2", "Check-in: 25 Dec, Check-out: 27 Dec", "0123456789"} {
		out, err := reg.Resume(context.Background(), st, reply, rcx)
		if err != nil {
			t.Fatalf("Resume(%q): %v", reply, err)
		}
		if out.Escalated {
			t.Fatalf("normal-order booking escalated at %q: %+v", reply, out)
		}
	}
	if st.Data["guest_name"] != "John Tan" {
		t.Errorf("name slot wrong: %q", st.Data["guest_name"])
	}
	admin := adminText(cap, "60199")
	if !strings.Contains(admin, "New Booking Request") {
		t.Errorf("admin not notified in normal order:\n%s", admin)
	}
}

// TestBookingGuestsFirst: guest answers count first ("2"), then the flow asks
// for the still-missing name.
func TestBookingGuestsFirst(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := bookingRC(cap)
	rcx.PMS = bookingPMS()

	st, _, err := reg.Start(context.Background(), "booking_payment_handler", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	out, err := reg.Resume(context.Background(), st, "2", rcx)
	if err != nil {
		t.Fatalf("Resume(2): %v", err)
	}
	if out.Escalated || out.Done {
		t.Fatalf("expected pause, got %+v", out)
	}
	if st.Data["guest_count"] != "2" {
		t.Errorf("count-first not captured: %q", st.Data["guest_count"])
	}
	// Next missing slot in priority order after count is captured is the name.
	if !strings.Contains(strings.ToLower(cap.last()), "name") {
		t.Errorf("after count, should prompt for name, got %q", cap.last())
	}
}

// 2026-07-21 eval BOOK-1: compound replies + name-intro stripping.
func TestParseCompoundBookingReply(t *testing.T) {
	got := parseCompoundBookingReply("My name is John Tan, 1 pax, arriving around 8pm")
	if got == nil {
		t.Fatal("compound reply not recognized")
	}
	if got["guest_name"] != "John Tan" {
		t.Errorf("guest_name = %q, want John Tan", got["guest_name"])
	}
	if got["guest_count"] != "1" {
		t.Errorf("guest_count = %q, want 1", got["guest_count"])
	}
	if _, ok := got["booking_dates"]; ok {
		t.Errorf("booking_dates should not be captured from %q", got["booking_dates"])
	}

	got = parseCompoundBookingReply("John Tan, 2 pax")
	if got["guest_name"] != "John Tan" || got["guest_count"] != "2" {
		t.Errorf("plain-name compound = %v", got)
	}

	if parseCompoundBookingReply("John Tan") != nil {
		t.Error("single-part reply must return nil (existing path)")
	}
}

func TestStripNameIntro(t *testing.T) {
	cases := map[string]string{
		"My name is John Tan": "John Tan",
		"I am Siti":           "Siti",
		"我是李明":                "李明",
		"John Tan":            "John Tan",
		"nama saya Ali":       "Ali",
	}
	for in, want := range cases {
		if got := stripNameIntro(in); got != want {
			t.Errorf("stripNameIntro(%q) = %q, want %q", in, got, want)
		}
	}
}
