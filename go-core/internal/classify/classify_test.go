package classify

import (
	"context"
	"path/filepath"
	"testing"

	"rainbow-core/internal/config"
)

// dataDir points at the live Node config so the Go classifier is tested against
// the exact same data the production app uses.
func dataDir() string {
	return filepath.Join("..", "..", "..", "src", "assistant", "data")
}

func loadPelangi(t *testing.T) *config.Profile {
	t.Helper()
	p, err := config.Load(dataDir(), "pelangi")
	if err != nil {
		t.Fatalf("load pelangi: %v", err)
	}
	if len(p.Patterns) == 0 {
		t.Fatal("no T1 patterns loaded")
	}
	if len(p.Keywords) == 0 {
		t.Fatal("no T2 keywords loaded")
	}
	if len(p.Routing) == 0 {
		t.Fatal("no routing loaded")
	}
	return p
}

func TestLoadProfile(t *testing.T) {
	p := loadPelangi(t)
	t.Logf("patterns=%d keywords=%d routes=%d static=%d providers=%d",
		len(p.Patterns), len(p.Keywords), len(p.Routing), len(p.Static), len(p.Providers))
	if _, ok := p.Static["wifi"]; !ok {
		t.Error("expected a static wifi reply")
	}
}

func TestT1Regex(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		text string
		want string
	}{
		{"hi", "greeting"},
		{"hello", "greeting"},
		{"good morning", "greeting"},
		{"你好", "greeting"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.text, nil)
		if r.Category != tc.want {
			t.Errorf("Classify(%q) = %q (src=%s conf=%.2f), want %q", tc.text, r.Category, r.Source, r.Confidence, tc.want)
		}
		if r.Source != SrcRegex {
			t.Errorf("Classify(%q) source = %s, want regex", tc.text, r.Source)
		}
	}
}

func TestT2Fuzzy(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil) // no LLM → fast tiers only
	// These should resolve via keyword fuzzy matching (not regex, not unknown).
	cases := []string{"what is the wifi password", "how much per night", "do you have rooms available"}
	for _, text := range cases {
		r := c.Classify(context.Background(), text, nil)
		if r.Category == "unknown" {
			t.Errorf("Classify(%q) = unknown; expected a fast-tier intent", text)
		}
		t.Logf("%q -> %s (src=%s conf=%.2f kw=%q)", text, r.Category, r.Source, r.Confidence, r.MatchedKeyword)
	}
}

func TestDetectLanguage(t *testing.T) {
	cases := map[string]string{
		"hello there":        "en",
		"你好":                 "zh",
		"berapa harga bilik": "ms",
		"வணக்கம்":            "ta",
	}
	for text, want := range cases {
		if got := DetectLanguage(text); got != want {
			t.Errorf("DetectLanguage(%q) = %q, want %q", text, got, want)
		}
	}
}

// fakeSemantic always returns a fixed intent (stands in for the ML sidecar).
type fakeSemantic struct {
	intent string
	score  float64
}

func (f fakeSemantic) Match(_ context.Context, _ string) (string, float64, string, error) {
	return f.intent, f.score, "stub-example", nil
}

func TestT3SemanticFiresWhenFastTiersMiss(t *testing.T) {
	p := loadPelangi(t)
	// luggage_storage is whitelisted for the hostel profile.
	c := New(p, nil).WithSemantic(fakeSemantic{intent: "luggage_storage", score: 0.9})
	r := c.Classify(context.Background(), "zzxq wqpl nonsensical phrase", nil)
	if r.Source != SrcSemantic || r.Category != "luggage_storage" {
		t.Errorf("expected semantic luggage_storage, got %s/%s", r.Source, r.Category)
	}
}

func TestT3RespectsWhitelist(t *testing.T) {
	p := loadPelangi(t)
	// MENU_SPECIALS is a contaminant — not in the hostel whitelist; T3 must reject it.
	c := New(p, nil).WithSemantic(fakeSemantic{intent: "MENU_SPECIALS", score: 0.99})
	r := c.Classify(context.Background(), "zzxq wqpl nonsensical phrase", nil)
	if r.Category == "MENU_SPECIALS" {
		t.Error("T3 returned a non-whitelisted (contaminant) intent")
	}
}

func TestUnknownFallback(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	r := c.Classify(context.Background(), "asdf qwerty zxcv nonsense", nil)
	if r.Category != "unknown" {
		t.Logf("note: gibberish classified as %s (src=%s conf=%.2f)", r.Category, r.Source, r.Confidence)
	}
}

// TestPaymentVsArrivalRouting guards the conservative fix for the "到了可以付现金吗"
// misroute: a future-tense "when I arrive can I pay cash?" contains the bare
// arrival token 到了 but is really a payment question. Because payment_info is
// evaluated before check_in_arrival in intents.json, adding cash keywords to
// payment_info makes payment-dominant messages classify as payment_info WITHOUT
// touching the arrival trigger — so pure arrival messages still enter check-in.
func TestPaymentVsArrivalRouting(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil)
	cases := []struct {
		text string
		want string
	}{
		// The bug: future "can I pay cash on arrival?" → payment, not check-in.
		{"到了可以付现金吗", "payment_info"},
		{"can I pay cash when I arrive", "payment_info"},
		{"boleh bayar tunai bila sampai", "payment_info"},
		// Regression guard: pure arrival announcements MUST still route to
		// the check-in workflow (no payment keyword present).
		{"我到了", "check_in_arrival"},
		{"我要入住", "check_in_arrival"},
		{"i have arrived", "check_in_arrival"},
		{"i'm here", "check_in_arrival"},
		{"saya dah sampai", "check_in_arrival"},
	}
	for _, tc := range cases {
		r := c.Classify(context.Background(), tc.text, nil)
		if r.Category != tc.want {
			t.Errorf("Classify(%q) = %q (src=%s conf=%.2f kw=%q), want %q",
				tc.text, r.Category, r.Source, r.Confidence, r.MatchedKeyword, tc.want)
		}
	}
}
