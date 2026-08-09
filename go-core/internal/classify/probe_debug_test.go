package classify

import (
	"context"
	"testing"
)

// Regression for the 2026-07-21 standard-scenarios eval misroutes. Each of
// these guest messages was previously classified into the wrong intent (wrong
// column shown in the comment). Fast tiers only (no LLM).
func TestMisrouteRegression20260721(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		msg  string
		want string
	}{
		// was MAINTENANCE_ISSUE (fuzzy "fix") → service_request_handler
		{"The aircon in my capsule is not cold at all, very hot inside. Please fix it.", "climate_control_complaint"},
		// was billing_inquiry (regex "charge")
		{"Can I check out at 2pm instead? Will there be any extra charge?", "late_checkout_request"},
		// was pricing (regex "how much")
		{"How much is it if I check out late?", "late_checkout_request"},
		// was payment_info (regex "pay")
		{"I am a foreigner, do I need to pay tourism tax?", "tourism_tax"},
		// was booking (group_booking noun list lacked "friends")
		{"We are 5 friends, can we book together for this Saturday?", "group_booking"},
		// was WIFI_PASSWORD (fuzzy "what is wifi" on "what should I do")
		{"I found a wallet near the lockers that is not mine. What should I do?", "found_item_report"},
		// was extra_amenity_request (regex "charger")
		{"I checked out this morning and I think I left my phone charger in my capsule.", "forgot_item_post_checkout"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.msg, nil)
		if r.Category != tc.want {
			t.Errorf("%q → %s (src=%s kw=%q), want %s", tc.msg, r.Category, r.Source, r.MatchedKeyword, tc.want)
		}
	}
}

// Guards: the widened override patterns must NOT hijack neighbouring intents.
func TestOverridesDoNotHijack(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		msg  string
		want string
	}{
		{"What time is check out?", "checkout_info"},
		{"How much per night?", "pricing"},
		{"What payment methods do you accept?", "payment_info"},
		{"I want to book a capsule", "booking"},
		{"I forgot my wifi password", "wifi"},
		{"Can I get an extra towel please?", "extra_amenity_request"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.msg, nil)
		if r.Category != tc.want {
			t.Errorf("%q → %s (src=%s kw=%q), want %s", tc.msg, r.Category, r.Source, r.MatchedKeyword, tc.want)
		}
	}
}

// Follow-up regression: 3 pre-existing misroutes surfaced by the 50-suite on
// 2026-07-21 (deposit → booking, after-booking question → booking, change
// check-in date → checkin_info).
func TestMisroutes50Suite20260721(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		msg  string
		want string
	}{
		{"Do I need to pay a deposit to book?", "pricing"},
		{"What will I receive after booking?", "booking_info_query"},
		{"I want to change my check-in date", "booking_modification"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.msg, nil)
		if r.Category != tc.want {
			t.Errorf("%q → %s (src=%s kw=%q), want %s", tc.msg, r.Category, r.Source, r.MatchedKeyword, tc.want)
		}
	}
}

// OUT-3 (round-2 evaluator): extend-a-night must not hit late_checkout_request.
func TestExtendStayNotLateCheckout(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		msg  string
		want string
	}{
		{"I want to stay one more night, can I extend?", "extend_stay"},
		{"Can I extend my stay?", "extend_stay"},
		{"Can I check out at 2pm instead? Will there be any extra charge?", "late_checkout_request"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.msg, nil)
		if r.Category != tc.want {
			t.Errorf("%q → %s (src=%s kw=%q), want %s", tc.msg, r.Category, r.Source, r.MatchedKeyword, tc.want)
		}
	}
}

// Human-support loop R1 (2026-07-21): stranded / refund / social misroutes.
func TestHumanSupportMisroutesR1(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		msg  string
		want string
	}{
		{"I'm exhausted, my flight got cancelled and I need a bed right now. Please help.", "urgent_stay_request"}, // was availability in R1; R3 gave it an empathetic static reply
		{"I paid twice for my booking, the money went out two times. I want my money back.", "billing_dispute"},
		{"can you upgrade me to a private hotel room for free?", "upgrade_request"},
		{"I made a booking somewhere last week but I'm not sure if it was your hostel, how do I check?", "booking_lookup_query"},
		{"I want to cancel my booking", "cancel_booking"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.msg, nil)
		if r.Category != tc.want {
			t.Errorf("%q → %s (src=%s kw=%q), want %s", tc.msg, r.Category, r.Source, r.MatchedKeyword, tc.want)
		}
	}
}

// Human-support loop R3 (2026-07-21): multi-part questions + urgency intents.
func TestHumanSupportMisroutesR3(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		msg  string
		want string
	}{
		{"What time is check in, how much for 2 nights, and do you have parking?", "multi_question"},
		{"今晚有房吗？多少钱一晚？", "availability"}, // zh availability override wins — LLM route fabricated RM80 (see TestZhAvailabilityBeatsMultiQuestion)
		{"can I get an extra blanket? also where can I take a shower?", "extra_amenity_request"}, // R4: amenity override beats multi_question (LLM invented shower locations)
		{"I'm exhausted, my flight got cancelled and I need a bed right now. Please help.", "urgent_stay_request"},
		{"This is ridiculous. I've been standing outside for 30 minutes and NOBODY is at the counter!!", "locked_out_help"},
		{"my bus only arrives at 2am, can I still check in that late?", "late_arrival_checkin"},
		// guards: single questions keep their intents
		{"How much per night?", "pricing"},
		{"What time is check out?", "checkout_info"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.msg, nil)
		if r.Category != tc.want {
			t.Errorf("%q → %s (src=%s kw=%q), want %s", tc.msg, r.Category, r.Source, r.MatchedKeyword, tc.want)
		}
	}
}

// R3b: zh availability double-question must hit availability (live data), not
// multi_question→LLM (which fabricated "RM 80" on 2026-07-21).
func TestZhAvailabilityBeatsMultiQuestion(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	r := c.Classify(context.Background(), "今晚有房吗？多少钱一晚？", nil)
	if r.Category != "availability" {
		t.Errorf("zh availability → %s (kw=%q), want availability", r.Category, r.MatchedKeyword)
	}
}
