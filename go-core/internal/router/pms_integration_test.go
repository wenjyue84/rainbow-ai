package router

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"rainbow-core/internal/bridge"
	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/digiman"
	"rainbow-core/internal/store"
	"rainbow-core/internal/workflow"
)

// pmsHarness wires the engine with BOTH a mock Node bridge (captures /send) and a
// mock PMS (serves availability + records problem POSTs) — the literal
// bridge→core→PMS simulation for the two guest intents.
type pmsHarness struct {
	eng       *Engine
	bridgeURL string

	mu        sync.Mutex
	sends     []contract.SendRequest // everything the core pushed to the bridge
	availHits int                    // GET /api/units/available count
	problems  []map[string]any       // POST /api/problems bodies
}

func newPMSHarness(t *testing.T) *pmsHarness {
	t.Helper()
	h := &pmsHarness{}

	mockBridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req contract.SendRequest
		json.NewDecoder(r.Body).Decode(&req)
		h.mu.Lock()
		h.sends = append(h.sends, req)
		h.mu.Unlock()
		json.NewEncoder(w).Encode(contract.SendResult{OK: true, Sent: true})
	}))
	t.Cleanup(mockBridge.Close)

	mockPMS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/units/available":
			h.mu.Lock()
			h.availHits++
			h.mu.Unlock()
			w.Write([]byte(`[{"unitNumber":"C12"},{"unitNumber":"C13"}]`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/problems":
			body, _ := io.ReadAll(r.Body)
			var m map[string]any
			json.Unmarshal(body, &m)
			h.mu.Lock()
			h.problems = append(h.problems, m)
			h.mu.Unlock()
			w.Write([]byte(`{"id":"P-100","status":"open"}`))
		default:
			http.Error(w, "not found", 404)
		}
	}))
	t.Cleanup(mockPMS.Close)

	prof, err := config.Load("../../../src/assistant/data", "pelangi")
	if err != nil {
		t.Fatalf("load profile: %v", err)
	}
	wf, err := workflow.Load("../../../src/assistant/data")
	if err != nil {
		t.Fatalf("load workflows: %v", err)
	}
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	h.eng = NewEngine(prof, conversation.NewManager(st), bridge.New(mockBridge.URL), Options{
		PMS:             digiman.New(mockPMS.URL, ""),
		Workflows:       wf,
		TypingIndicator: true,
	})
	h.bridgeURL = mockBridge.URL
	return h
}

// guestText returns the concatenation of all OpText messages the core sent to the
// given guest phone (excludes staff-notify sends to other numbers).
func (h *pmsHarness) guestText(phone string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var b strings.Builder
	for _, s := range h.sends {
		if s.Op == contract.OpText && s.Phone == phone {
			b.WriteString(s.Text)
			b.WriteString("\n")
		}
	}
	return b.String()
}

// TestGuestAvailabilityHitsPMS proves an availability question flows
// inbound→classify→workflow→live PMS and the answer returns via the bridge.
func TestGuestAvailabilityHitsPMS(t *testing.T) {
	h := newPMSHarness(t)
	const guest = "60123456789"

	res, err := h.eng.Process(context.Background(), contract.IncomingMessage{
		From: guest, Text: "Do you have any rooms available tonight?",
		PushName: "Alice", MessageID: "av1", MessageType: contract.MsgText, InstanceID: "default",
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Intent != "availability" {
		t.Fatalf("intent = %q, want availability", res.Intent)
	}

	h.mu.Lock()
	hits := h.availHits
	h.mu.Unlock()
	if hits == 0 {
		t.Error("mock PMS /api/units/available was never hit")
	}
	reply := h.guestText(guest)
	if !strings.Contains(strings.ToLower(reply), "available") {
		t.Errorf("guest never received an availability answer via bridge, got %q", reply)
	}
}

// TestGuestMaintenanceHitsPMS proves a maintenance report flows
// inbound→classify→workflow: since FIX 5 (2026-07-21) every "broken / faulty /
// not working" report is the facility_malfunction T1 override → the
// ac_fault_escalate workflow, which acknowledges, asks ONLY for the capsule
// number, then pages on-site staff over WhatsApp carrying that detail. (The
// older service_request_handler → PMS /api/problems ticket path is no longer
// reachable from natural guest text on the Pelangi profile — the RSI data
// sync of 2026-09-20 made the override cover all fault wording — so this test
// asserts the staff page, not a PMS ticket; the mock PMS stays wired for
// TestGuestAvailabilityHitsPMS.)
func TestGuestMaintenanceHitsPMS(t *testing.T) {
	h := newPMSHarness(t)
	const guest = "60123456789"

	// Turn 1: report the issue → workflow starts, asks for the capsule, pauses.
	res, err := h.eng.Process(context.Background(), contract.IncomingMessage{
		From: guest, Text: "the power socket is faulty and needs repair",
		PushName: "Bob", MessageID: "mt1", MessageType: contract.MsgText, InstanceID: "default",
	})
	if err != nil {
		t.Fatalf("Process turn 1: %v", err)
	}
	if res.Action != "workflow" {
		t.Fatalf("turn 1 action = %q, want workflow (intent=%q)", res.Action, res.Intent)
	}
	if res.Intent != "facility_malfunction" {
		t.Fatalf("turn 1 intent = %q, want facility_malfunction", res.Intent)
	}

	// Turn 2: supply the capsule → staff are paged with it, guest is reassured.
	_, err = h.eng.Process(context.Background(), contract.IncomingMessage{
		From: guest, Text: "C12",
		PushName: "Bob", MessageID: "mt2", MessageType: contract.MsgText, InstanceID: "default",
	})
	if err != nil {
		t.Fatalf("Process turn 2: %v", err)
	}

	h.mu.Lock()
	sends := append([]contract.SendRequest(nil), h.sends...)
	h.mu.Unlock()
	staffPaged := false
	for _, s := range sends {
		if s.Op == contract.OpText && s.Phone != guest && strings.Contains(s.Text, "C12") {
			staffPaged = true
			break
		}
	}
	if !staffPaged {
		t.Fatalf("no staff WhatsApp page carrying the capsule number; sends=%+v", sends)
	}

	reply := strings.ToLower(h.guestText(guest))
	if !strings.Contains(reply, "staff") && !strings.Contains(reply, "capsule") {
		t.Errorf("guest never received the acknowledgement via bridge, got %q", reply)
	}
}
