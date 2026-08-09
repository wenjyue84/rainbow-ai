package router

import (
	"strings"
	"testing"
	"time"

	"rainbow-core/internal/conversation"
	"rainbow-core/internal/digiman"
	"rainbow-core/internal/workflow"
)

func newTestState(phone string) *conversation.State {
	return &conversation.State{Phone: phone, Slots: map[string]any{}}
}

func mytNow() time.Time {
	return time.Date(2026, 7, 19, 14, 0, 0, 0, mytZone)
}

func TestVerifyReceiptHappyPath(t *testing.T) {
	o := receiptOCR{
		IsReceipt: true, Amount: 35.00,
		Recipient: "PELANGI CAPSULE HOSTEL", Date: "2026-07-19", Reference: "TNG123",
	}
	ok, matched, reasons := verifyReceipt(o, []float64{35.00}, mytNow())
	if !ok || matched != 35.00 {
		t.Fatalf("expected verified, got reasons %v", reasons)
	}
}

func TestVerifyReceiptAccountNumberMatches(t *testing.T) {
	o := receiptOCR{
		IsReceipt: true, Amount: 35.00,
		Recipient: "M*Y** L**", RecipientAccount: "5511 2865 2007", Date: "2026-07-19",
	}
	ok, _, reasons := verifyReceipt(o, []float64{35.00}, mytNow())
	if !ok {
		t.Fatalf("account-number match should verify, got %v", reasons)
	}
}

func TestVerifyReceiptCentsNormalizedCandidate(t *testing.T) {
	// Deployed PMS2 stores auto-priced totals in cents ("4500" = RM45.00).
	// The caller passes both forms; a real RM45 receipt must verify.
	o := receiptOCR{IsReceipt: true, Amount: 45, Recipient: "Pelangi Capsule Hostel", Date: "2026-07-19"}
	ok, matched, reasons := verifyReceipt(o, []float64{4500, 45, 35}, mytNow())
	if !ok || matched != 45 {
		t.Fatalf("cents-normalized candidate should verify, got matched=%v reasons=%v", matched, reasons)
	}
}

func TestVerifyReceiptRejectsWrongAmount(t *testing.T) {
	o := receiptOCR{IsReceipt: true, Amount: 10, Recipient: "Pelangi Capsule Hostel", Date: "2026-07-19"}
	ok, _, reasons := verifyReceipt(o, []float64{35}, mytNow())
	if ok {
		t.Fatal("wrong amount must not verify")
	}
	if len(reasons) == 0 || !strings.Contains(strings.Join(reasons, ";"), "amount") {
		t.Fatalf("expected amount reason, got %v", reasons)
	}
}

func TestVerifyReceiptRejectsWrongRecipient(t *testing.T) {
	o := receiptOCR{IsReceipt: true, Amount: 35, Recipient: "Some Other Shop", Date: "2026-07-19"}
	if ok, _, _ := verifyReceipt(o, []float64{35}, mytNow()); ok {
		t.Fatal("wrong recipient must not verify")
	}
}

func TestVerifyReceiptRejectsStaleDate(t *testing.T) {
	o := receiptOCR{IsReceipt: true, Amount: 35, Recipient: "Pelangi Capsule", Date: "2026-07-18"}
	if ok, _, _ := verifyReceipt(o, []float64{35}, mytNow()); ok {
		t.Fatal("yesterday's receipt must not verify")
	}
}

func TestVerifyReceiptRejectsZeroExpected(t *testing.T) {
	o := receiptOCR{IsReceipt: true, Amount: 0, Recipient: "Pelangi Capsule", Date: "2026-07-19"}
	if ok, _, _ := verifyReceipt(o, nil, mytNow()); ok {
		t.Fatal("no reservation amount → must not verify")
	}
}

func TestParseReceiptJSONTolerant(t *testing.T) {
	raw := "```json\n{\"is_receipt\": true, \"amount\": \"RM35.00\", \"recipient\": \"Pelangi Capsule Hostel\", \"date\": \"2026-07-19\", \"reference\": \"2026071912345678\"}\n```"
	o, err := parseReceiptJSON(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !o.IsReceipt || o.Amount != 35 || o.Reference == "" {
		t.Fatalf("bad parse: %+v", o)
	}
}

func TestLoadImageDataURLValidation(t *testing.T) {
	if _, _, err := loadImage(t.Context(), "data:image/gif;base64,AAAA"); err == nil {
		t.Fatal("gif must be rejected")
	}
	if _, _, err := loadImage(t.Context(), "data:image/png;base64,!!!notb64"); err == nil {
		t.Fatal("invalid base64 must be rejected")
	}
	mime, b64, err := loadImage(t.Context(), "data:image/png;base64,iVBORw0KGgo=")
	if err != nil || mime != "image/png" || b64 == "" {
		t.Fatalf("valid png data URL rejected: %v", err)
	}
}

func TestPersistWorkflowCopiesBookingSlots(t *testing.T) {
	e := &Engine{}
	state := newTestState("web:abc")
	wfState := &workflow.State{Data: map[string]string{
		"guest_name": "TEST Loop Guest", "guest_phone": "60127088789",
		"confirmation_number": "PLG-1", "unitNumber": "C5", "booking_dates": "x",
	}}
	e.persistWorkflow(state, wfState, workflow.Outcome{Done: true})
	if state.Slots["guest_name"] != "TEST Loop Guest" || state.Slots["confirmation_number"] != "PLG-1" || state.Slots["unitNumber"] != "C5" {
		t.Fatalf("slots not copied: %v", state.Slots)
	}
	if _, exists := state.Slots["booking_dates"]; exists {
		t.Fatal("non-whitelisted keys must not be copied")
	}
}

func TestMaintenanceMessagesGrounded(t *testing.T) {
	known := maintenanceKnownMsg("en", "C6", []digiman.Problem{{UnitNumber: "C6", Description: "No light, no lock", ReportedAt: "2025-08-17T15:22:41.100Z"}})
	if !strings.Contains(known, "C6") || !strings.Contains(known, "No light, no lock") || !strings.Contains(known, "wa.me/60176701102") {
		t.Fatalf("known-problem msg not grounded: %s", known)
	}
	unknown := maintenanceUnknownMsg("en", "C6")
	if !strings.Contains(unknown, "no open issue") || !strings.Contains(unknown, "wa.me/60176701102") {
		t.Fatalf("unknown msg wrong: %s", unknown)
	}
}

func TestReceiptMsgsNeverClaimConfirmed(t *testing.T) {
	msg := receiptVerifiedMsg("en", 35, "C5")
	low := strings.ToLower(msg)
	if strings.Contains(low, "booking is confirmed") || strings.Contains(low, "reservation is confirmed") {
		t.Fatal("verified msg must not claim admin confirmation")
	}
	for _, want := range []string{"C5", "pelangi capsule", "ilovestaycapsule", "youtube.com"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("verified msg missing %q: %s", want, msg)
		}
	}
}
