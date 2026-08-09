package workflow

// Guards for the 2026-07-19 arrival/assisted-check-in rework of checkin_full
// and the booking_payment_handler → PENDING PMS2 reservation step. These run
// against the real workflows.json with a fake PMS.

import (
	"context"
	"strings"
	"testing"
)

func allGuestText(cap *capture, guestPhone string) string {
	cap.mu.Lock()
	defer cap.mu.Unlock()
	var b strings.Builder
	for _, m := range cap.msgs {
		if m.phone == guestPhone {
			b.WriteString(m.text + "\n")
		}
	}
	return b.String()
}

func adminText(cap *capture, adminPhone string) string {
	cap.mu.Lock()
	defer cap.mu.Unlock()
	var b strings.Builder
	for _, m := range cap.msgs {
		if m.phone == adminPhone {
			b.WriteString(m.text + "\n")
		}
	}
	return b.String()
}

func TestArrivalFlowWithAssignedCapsule(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := rc(cap)
	rcx.PMS = fakePMS{ok: true, outputs: map[string]string{
		"reservationFound":   "true",
		"unitNumber":         "C7",
		"confirmationNumber": "PLG-20260719-001",
		"pmsCheckInDate":     "2026-07-19",
		"pmsCheckOutDate":    "2026-07-20",
	}}

	st, out, err := reg.Start(context.Background(), "checkin_full", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !out.Paused {
		t.Fatalf("expected pause at wait_name, got %+v", out)
	}
	out, err = reg.Resume(context.Background(), st, "Alice Tan", rcx)
	if err != nil {
		t.Fatalf("Resume(name): %v", err)
	}
	if out.Escalated {
		t.Fatalf("arrival flow must not escalate on PMS success, got %+v", out)
	}
	guest := allGuestText(cap, "60123")
	for _, want := range []string{"C7", "PLG-20260719-001", "Maya", "wa.me/60176701102", "duitnow-qr.png", "Touch 'n Go"} {
		if !strings.Contains(guest, want) {
			t.Errorf("guest reply missing %q:\n%s", want, guest)
		}
	}
	if !strings.Contains(adminText(cap, "60199"), "Guest Arrived") {
		t.Error("staff was not notified of the arrival")
	}
}

func TestArrivalFlowNoReservationStillGivesMaya(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := rc(cap)
	rcx.PMS = fakePMS{ok: true, outputs: map[string]string{"reservationFound": "false"}}

	st, _, err := reg.Start(context.Background(), "checkin_full", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	out, err := reg.Resume(context.Background(), st, "Unknown Person", rcx)
	if err != nil {
		t.Fatalf("Resume: %v", err)
	}
	if out.Escalated {
		t.Fatalf("not-found must not hard-escalate, got %+v", out)
	}
	guest := allGuestText(cap, "60123")
	if !strings.Contains(guest, "couldn't find a reservation") {
		t.Errorf("expected not-found explanation, got:\n%s", guest)
	}
	for _, want := range []string{"Maya", "duitnow-qr.png"} {
		if !strings.Contains(guest, want) {
			t.Errorf("guest reply missing %q:\n%s", want, guest)
		}
	}
}

func TestBookingFlowCreatesPendingReservation(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := rc(cap)
	rcx.PMS = fakePMS{ok: true, outputs: map[string]string{
		"available_count":     "3",
		"reservation_created": "true",
		"confirmation_number": "PLG-20260719-042",
	}}

	st, _, err := reg.Start(context.Background(), "booking_payment_handler", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	for _, reply := range []string{"TEST Loop Guest", "2", "Check-in: 25 Dec, Check-out: 27 Dec", "60127088789"} {
		out, err := reg.Resume(context.Background(), st, reply, rcx)
		if err != nil {
			t.Fatalf("Resume(%q): %v", reply, err)
		}
		if out.Escalated {
			t.Fatalf("booking flow escalated at %q: %+v", reply, out)
		}
	}
	admin := adminText(cap, "60199")
	if !strings.Contains(admin, "New Booking Request") || !strings.Contains(admin, "PLG-20260719-042") {
		t.Errorf("admin notify missing booking request / PMS ref:\n%s", admin)
	}
	guest := allGuestText(cap, "60123")
	if !strings.Contains(guest, "sent to our admin") {
		t.Errorf("guest must still be told admin will confirm, got:\n%s", guest)
	}
	if strings.Contains(strings.ToLower(guest), "is confirmed") {
		t.Errorf("guest reply must never claim the booking is confirmed:\n%s", guest)
	}
}

func TestParseDateRange(t *testing.T) {
	in, out, ok := ParseDateRange("Check-in: 25 Dec, Check-out: 27 Dec")
	if !ok || in.Day() != 25 || out.Day() != 27 || in.Month() != 12 {
		t.Errorf("range parse failed: %v %v %v", in, out, ok)
	}
	in, out, ok = ParseDateRange("tonight 25/12")
	if !ok || out.Sub(in).Hours() != 24 {
		t.Errorf("single date should default to 1 night: %v %v %v", in, out, ok)
	}
	if _, _, ok := ParseDateRange("no dates here"); ok {
		t.Error("expected ok=false for undateable text")
	}
}
