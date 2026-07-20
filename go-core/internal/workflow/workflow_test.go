package workflow

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func dataDir() string { return filepath.Join("..", "..", "..", "src", "assistant", "data") }

type capture struct {
	mu   sync.Mutex
	msgs []struct{ phone, text string }
}

func (c *capture) send(_ context.Context, phone, text, _ string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.msgs = append(c.msgs, struct{ phone, text string }{phone, text})
	return nil
}
func (c *capture) last() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.msgs) == 0 {
		return ""
	}
	return c.msgs[len(c.msgs)-1].text
}

func loadReg(t *testing.T) *Registry {
	t.Helper()
	r, err := Load(dataDir())
	if err != nil {
		t.Fatalf("load workflows: %v", err)
	}
	if r.Get("booking_payment_handler") == nil {
		t.Fatal("booking_payment_handler not loaded")
	}
	return r
}

func rc(cap *capture) RunContext {
	return RunContext{GuestPhone: "60123", GuestName: "Guest", Lang: "en", AdminPhone: "60199", Send: cap.send}
}

func TestBookingWorkflowSlotFilling(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}

	// Start → asks for name, pauses.
	st, out, err := reg.Start(context.Background(), "booking_payment_handler", rc(cap))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !out.Paused {
		t.Fatalf("expected pause after first wait_reply, got %+v", out)
	}
	if !strings.Contains(strings.ToLower(cap.last()), "name") {
		t.Errorf("first prompt should ask for name, got %q", cap.last())
	}

	// Reply with name → asks guest count, interpolating the name.
	out, err = reg.Resume(context.Background(), st, "John Tan", rc(cap))
	if err != nil {
		t.Fatalf("Resume(name): %v", err)
	}
	if !out.Paused {
		t.Fatalf("expected pause after guest count prompt, got %+v", out)
	}
	if st.Data["guest_name"] != "John Tan" {
		t.Errorf("guest_name not stored: %v", st.Data)
	}
	if !strings.Contains(cap.last(), "John Tan") {
		t.Errorf("guest count prompt should interpolate name, got %q", cap.last())
	}

	// Reply with count → asks for dates.
	out, err = reg.Resume(context.Background(), st, "2", rc(cap))
	if err != nil {
		t.Fatalf("Resume(count): %v", err)
	}
	if st.Data["guest_count"] != "2" {
		t.Errorf("guest_count not stored: %v", st.Data)
	}
	if !out.Paused {
		t.Errorf("expected pause awaiting dates, got %+v", out)
	}
	if !strings.Contains(strings.ToLower(cap.last()), "date") {
		t.Errorf("should ask for dates, got %q", cap.last())
	}
}

func TestWorkflowEscalatesOnPMSStep(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	st, _, _ := reg.Start(context.Background(), "booking_payment_handler", rc(cap))
	reg.Resume(context.Background(), st, "Jane", rc(cap))
	reg.Resume(context.Background(), st, "1", rc(cap))
	// Valid-format future dates pass the regex/past checks and reach the PMS
	// availability condition → should escalate to staff (core doesn't fake PMS).
	out, err := reg.Resume(context.Background(), st, "Check-in: 15 Dec, Check-out: 17 Dec", rc(cap))
	if err != nil {
		t.Fatalf("Resume(dates): %v", err)
	}
	if !out.Escalated && !out.Paused && !out.Done {
		t.Errorf("unexpected outcome %+v", out)
	}
	// If it escalated, staff (admin) should have received a message.
	if out.Escalated {
		var sawAdmin bool
		cap.mu.Lock()
		for _, m := range cap.msgs {
			if m.phone == "60199" {
				sawAdmin = true
			}
		}
		cap.mu.Unlock()
		if !sawAdmin {
			t.Error("escalation did not notify admin")
		}
	}
}

// fakePMS implements the PMS interface for workflow tests.
type fakePMS struct {
	outputs map[string]string
	ok      bool
	err     error
}

func (f fakePMS) Do(_ context.Context, _ string, _ map[string]string) (map[string]string, bool, error) {
	return f.outputs, f.ok, f.err
}

// synthWF is a 3-node graph: pelangi_api(success→msg_ok, error→msg_err).
const synthWF = `{"workflows":[{"id":"wf","profileId":"pelangi","startNodeId":"api",
"nodes":[
 {"id":"api","type":"pelangi_api","config":{"action":"check_availability","params":{"guestName":"{{guest.name}}"}},
   "next":{"success":"msg_ok","error":"msg_err"},"outputs":{"chosen":"unit_number"}},
 {"id":"msg_ok","type":"message","config":{"message":{"en":"Booked unit {{workflow.data.chosen}}"}}},
 {"id":"msg_err","type":"message","config":{"message":{"en":"Sorry, error occurred"}}}
]}]}`

func TestPelangiApiSuccessBranch(t *testing.T) {
	reg, err := LoadBytes([]byte(synthWF))
	if err != nil {
		t.Fatalf("LoadBytes: %v", err)
	}
	cap := &capture{}
	rcx := rc(cap)
	rcx.GuestName = "Alice"
	rcx.PMS = fakePMS{outputs: map[string]string{"unit_number": "C12"}, ok: true}

	_, out, err := reg.Start(context.Background(), "wf", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !out.Done || out.Escalated {
		t.Errorf("expected done (success), got %+v", out)
	}
	if !strings.Contains(cap.last(), "C12") {
		t.Errorf("success message should include the assigned unit, got %q", cap.last())
	}
}

func TestPelangiApiUnimplementedEscalates(t *testing.T) {
	reg, _ := LoadBytes([]byte(synthWF))
	cap := &capture{}
	rcx := rc(cap)
	rcx.PMS = fakePMS{ok: false} // unimplemented action

	_, out, _ := reg.Start(context.Background(), "wf", rcx)
	if !out.Escalated {
		t.Errorf("unimplemented PMS action should escalate, got %+v", out)
	}
}

func TestPelangiApiNoPMSEscalates(t *testing.T) {
	reg, _ := LoadBytes([]byte(synthWF))
	cap := &capture{}
	_, out, _ := reg.Start(context.Background(), "wf", rc(cap)) // no PMS
	if !out.Escalated {
		t.Errorf("missing PMS should escalate, got %+v", out)
	}
}

// TestServiceRequestHandlerReachesConfirmation guards the bare-string `next`
// decode fix + the maintenance happy path: a logged service request must reach
// the confirmation message (not escalate).
func TestServiceRequestHandlerReachesConfirmation(t *testing.T) {
	reg := loadReg(t)
	cap := &capture{}
	rcx := rc(cap)
	rcx.PMS = fakePMS{ok: true, outputs: map[string]string{"id": "P-100", "logged": "true"}}

	// Start → acknowledges, then pauses asking for details.
	st, out, err := reg.Start(context.Background(), "service_request_handler", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !out.Paused {
		t.Fatalf("expected pause at sr_ask_details, got %+v", out)
	}

	// Reply with the issue → logs to PMS, advances to confirmation.
	out, err = reg.Resume(context.Background(), st, "the aircond is not working", rcx)
	if err != nil {
		t.Fatalf("Resume(details): %v", err)
	}
	if out.Escalated {
		t.Errorf("service request should NOT escalate on PMS success, got %+v", out)
	}
	if !strings.Contains(cap.last(), "✅") && !strings.Contains(strings.ToLower(cap.last()), "logged") {
		t.Errorf("expected confirmation message after logging, got %q", cap.last())
	}
}

// TestACFaultEscalateWorkflow guards FIX 5: an AC/maintenance fault must
// escalate to on-site staff, ask ONLY for the capsule number, notify staff
// with that capsule, and offer relocation — not run the generic complaint
// triage menu.
func TestACFaultEscalateWorkflow(t *testing.T) {
	reg := loadReg(t)
	if reg.Get("ac_fault_escalate") == nil {
		t.Fatal("ac_fault_escalate workflow not loaded")
	}
	cap := &capture{}
	rcx := rc(cap)

	st, out, err := reg.Start(context.Background(), "ac_fault_escalate", rcx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !out.Paused {
		t.Fatalf("expected pause asking for capsule number, got %+v", out)
	}
	guest := allGuestText(cap, "60123")
	// First message confirms staff alerted; the prompt asks for the capsule.
	if !strings.Contains(strings.ToLower(guest), "capsule") {
		t.Errorf("should ask for capsule number, got:\n%s", guest)
	}
	// Must NOT present the generic noise/cleanliness/facility triage menu.
	if strings.Contains(strings.ToLower(guest), "noise, cleanliness") {
		t.Errorf("AC flow must not show the generic complaint triage menu:\n%s", guest)
	}

	out, err = reg.Resume(context.Background(), st, "C12", rcx)
	if err != nil {
		t.Fatalf("Resume(capsule): %v", err)
	}
	if out.Escalated {
		t.Fatalf("AC flow should complete via staff-notify, not core escalate: %+v", out)
	}
	admin := adminText(cap, "60199")
	if !strings.Contains(admin, "C12") {
		t.Errorf("staff notify should include the capsule number:\n%s", admin)
	}
	guest = allGuestText(cap, "60123")
	if !strings.Contains(strings.ToLower(guest), "move you to another capsule") &&
		!strings.Contains(strings.ToLower(guest), "another capsule") {
		t.Errorf("should offer relocation:\n%s", guest)
	}
}

// TestAvailabilityCheckWorkflow exercises the new availability_check workflow
// against a fake PMS for both the available and fully-booked branches.
func TestAvailabilityCheckWorkflow(t *testing.T) {
	reg := loadReg(t)

	t.Run("available", func(t *testing.T) {
		cap := &capture{}
		rcx := rc(cap)
		rcx.PMS = fakePMS{ok: true, outputs: map[string]string{"available_count": "3", "unit_number": "C12"}}
		_, out, err := reg.Start(context.Background(), "availability_check", rcx)
		if err != nil {
			t.Fatalf("Start: %v", err)
		}
		if out.Escalated {
			t.Errorf("availability should not escalate on PMS success, got %+v", out)
		}
		if !strings.Contains(cap.last(), "3") {
			t.Errorf("expected availability reply mentioning the count, got %q", cap.last())
		}
	})

	t.Run("fully_booked", func(t *testing.T) {
		cap := &capture{}
		rcx := rc(cap)
		rcx.PMS = fakePMS{ok: true, outputs: map[string]string{"available_count": "0"}}
		_, out, err := reg.Start(context.Background(), "availability_check", rcx)
		if err != nil {
			t.Fatalf("Start: %v", err)
		}
		if out.Escalated {
			t.Errorf("fully-booked branch should not escalate, got %+v", out)
		}
		low := strings.ToLower(cap.last())
		if !strings.Contains(low, "fully booked") && !strings.Contains(low, "staff") {
			t.Errorf("expected fully-booked reply, got %q", cap.last())
		}
	})
}

func TestUnknownWorkflow(t *testing.T) {
	reg := loadReg(t)
	_, _, err := reg.Start(context.Background(), "does_not_exist", rc(&capture{}))
	if err == nil {
		t.Error("expected error for unknown workflow")
	}
}
