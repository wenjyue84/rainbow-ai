package router

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rainbow-core/internal/conversation"
)

func TestReceiptLedgerKeyFromReference(t *testing.T) {
	o := receiptOCR{Reference: " 2026 0719-1234abcd "}
	key, ok := receiptLedgerKey(o)
	if !ok || key != "ref:202607191234ABCD" {
		t.Fatalf("bad ref key: %q ok=%v", key, ok)
	}
}

func TestReceiptLedgerKeyFallbackHash(t *testing.T) {
	o := receiptOCR{Amount: 35, Date: "2026-07-19", Payer: "TEST Loop Guest"}
	key, ok := receiptLedgerKey(o)
	if !ok || !strings.HasPrefix(key, "alt:") {
		t.Fatalf("expected alt: fallback key, got %q ok=%v", key, ok)
	}
	// Same fields (case/space-insensitive payer) → same key.
	key2, _ := receiptLedgerKey(receiptOCR{Amount: 35, Date: "2026-07-19", Payer: "  test  loop  guest "})
	if key != key2 {
		t.Fatalf("fallback key not stable: %q vs %q", key, key2)
	}
	// Different amount → different key.
	key3, _ := receiptLedgerKey(receiptOCR{Amount: 45, Date: "2026-07-19", Payer: "TEST Loop Guest"})
	if key == key3 {
		t.Fatal("different amount must give different key")
	}
}

func TestReceiptLedgerKeyUnreadable(t *testing.T) {
	// No reference, incomplete fallback → no identity → caller must not release.
	for _, o := range []receiptOCR{
		{},
		{Reference: "ab"},                    // too short after normalize
		{Amount: 35, Date: "2026-07-19"},     // payer missing
		{Amount: 35, Payer: "X Y"},           // date missing
		{Date: "2026-07-19", Payer: "TT GG"}, // amount missing
	} {
		if key, ok := receiptLedgerKey(o); ok {
			t.Fatalf("expected no identity for %+v, got %q", o, key)
		}
	}
}

func TestReceiptLedgerReplayAcrossReservations(t *testing.T) {
	l := newReceiptLedger("") // in-memory
	key, _ := receiptLedgerKey(receiptOCR{Reference: "TNG9988"})
	if prior := l.Lookup(key); prior != nil {
		t.Fatal("fresh ledger must not know the key")
	}
	if err := l.Record(ledgerEntry{Key: key, Reference: "TNG9988", ReservationID: "res-A", Confirmation: "PLG-1"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	prior := l.Lookup(key)
	if prior == nil || prior.ReservationID != "res-A" {
		t.Fatalf("lookup after record failed: %+v", prior)
	}
	// Same reservation retry → allowed by the caller (prior.ReservationID == resID).
	// Different reservation → replay (caller rejects when IDs differ).
	if prior.ReservationID == "res-B" {
		t.Fatal("sanity: different reservation must not match")
	}
}

func TestReceiptLedgerPersistAndPrune(t *testing.T) {
	path := filepath.Join(t.TempDir(), "receipt-ledger.json")
	// Seed a file with one fresh and one stale entry.
	fresh := ledgerEntry{Key: "ref:FRESH1", ReservationID: "r1", UsedAtMs: time.Now().UnixMilli()}
	stale := ledgerEntry{Key: "ref:STALE1", ReservationID: "r0", UsedAtMs: time.Now().Add(-31 * 24 * time.Hour).UnixMilli()}
	raw, _ := json.Marshal([]ledgerEntry{fresh, stale})
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	l := newReceiptLedger(path)
	if l.Lookup("ref:FRESH1") == nil {
		t.Fatal("fresh entry lost on load")
	}
	if l.Lookup("ref:STALE1") != nil {
		t.Fatal("stale entry (>30d) must be pruned on load")
	}
	// Record persists to disk.
	if err := l.Record(ledgerEntry{Key: "ref:NEW22", ReservationID: "r2"}); err != nil {
		t.Fatalf("record: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ledger file not written: %v", err)
	}
	if !strings.Contains(string(got), "ref:NEW22") || strings.Contains(string(got), "ref:STALE1") {
		t.Fatalf("persisted ledger wrong: %s", got)
	}
}

func TestReceiptLedgerNilSafe(t *testing.T) {
	var l *receiptLedger
	if l.Lookup("ref:X") != nil {
		t.Fatal("nil ledger lookup must return nil")
	}
	if err := l.Record(ledgerEntry{Key: "ref:X"}); err != nil {
		t.Fatalf("nil ledger record must be a no-op: %v", err)
	}
}

// ─── Fix 2: pickUnit maintenance filter ──────────────────────────────────────

func TestPickUnitSkipsProblemUnits(t *testing.T) {
	units := []string{"C5", "C6", "C7"}
	blocked := map[string]bool{"C5": true, "C6": true}
	if got := pickUnit(units, blocked); got != "C7" {
		t.Fatalf("pickUnit = %q, want C7 (C5/C6 have open problems)", got)
	}
}

func TestPickUnitAllBlockedReturnsEmpty(t *testing.T) {
	units := []string{"C5", "C6"}
	blocked := map[string]bool{"C5": true, "C6": true}
	if got := pickUnit(units, blocked); got != "" {
		t.Fatalf("pickUnit = %q, want \"\" when every free unit has a problem", got)
	}
}

func TestPickUnitNoFilter(t *testing.T) {
	if got := pickUnit([]string{"C3", "C4"}, nil); got != "C3" {
		t.Fatalf("pickUnit = %q, want first unit with nil filter", got)
	}
	if got := pickUnit(nil, nil); got != "" {
		t.Fatalf("pickUnit on empty list = %q, want \"\"", got)
	}
}

// ─── Fix 3: bare-confirmation checkout guard ─────────────────────────────────

func TestBareConfirmationDetection(t *testing.T) {
	trues := []string{"Yes, confirm please.", "yes", "ok sure", "Confirm", "yes please", "ya betul", "好的", "确认"}
	for _, s := range trues {
		if !isBareConfirmation(s) {
			t.Errorf("isBareConfirmation(%q) = false, want true", s)
		}
	}
	falses := []string{
		"I want to check out now", "can I check out now", "checkout please",
		"yes I want to check out", "confirm my booking for friday", "",
		"我要退房", "saya nak checkout",
	}
	for _, s := range falses {
		if isBareConfirmation(s) {
			t.Errorf("isBareConfirmation(%q) = true, want false", s)
		}
	}
}

func TestConfirmGuardFreshSessionDowngrades(t *testing.T) {
	fresh := &conversation.State{Phone: "web:x"}
	if !shouldDowngradeBareConfirmation("checkout_now", "Yes, confirm please.", fresh) {
		t.Fatal("fresh session + bare confirmation must downgrade checkout_now")
	}
}

func TestConfirmGuardKeepsRealCheckout(t *testing.T) {
	fresh := &conversation.State{Phone: "web:x"}
	// Real checkout wording is not a bare confirmation → never downgraded.
	if shouldDowngradeBareConfirmation("checkout_now", "I want to check out now", fresh) {
		t.Fatal("real checkout request must not be downgraded")
	}
	// Other intents are never touched.
	if shouldDowngradeBareConfirmation("booking", "Yes, confirm please.", fresh) {
		t.Fatal("guard must only apply to checkout_now")
	}
}

func TestConfirmGuardRespectsCheckoutContext(t *testing.T) {
	// Prior checkout-flavoured intent → the confirmation legitimately advances it.
	st := &conversation.State{Phone: "60123", LastIntent: "checkout_info"}
	if shouldDowngradeBareConfirmation("checkout_now", "yes please", st) {
		t.Fatal("bare confirmation with checkout context must stay checkout_now")
	}
	// Active workflow snapshot → same.
	st2 := &conversation.State{Phone: "60124", WorkflowStateJSON: `{"workflowId":"checkout_full"}`}
	if shouldDowngradeBareConfirmation("checkout_now", "yes", st2) {
		t.Fatal("bare confirmation with active workflow must stay checkout_now")
	}
}
