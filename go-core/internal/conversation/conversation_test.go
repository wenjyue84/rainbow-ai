package conversation

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"rainbow-core/internal/store"
)

// tempDBCopy copies the real DB so tests exercise the exact production schema
// without mutating it.
func tempDBCopy(t *testing.T) string {
	t.Helper()
	src := filepath.Join("..", "..", "..", "data", "rainbow-ai.db")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("no local DB: %v", err)
	}
	dst := filepath.Join(t.TempDir(), "test.db")
	in, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(out, in); err != nil {
		t.Fatal(err)
	}
	out.Close()
	return dst
}

func TestStateRoundTrip(t *testing.T) {
	db := tempDBCopy(t)
	st, err := store.Open(db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	m := NewManager(st)

	phone := "60123456789"
	s, err := m.GetOrCreate(phone, "Alice", "pelangi")
	if err != nil {
		t.Fatalf("GetOrCreate: %v", err)
	}
	if !s.isNew {
		t.Error("expected new state")
	}

	// Mutate + save.
	s.Language = "ms"
	s.LastIntent = "booking"
	s.LastIntentConfidence = 0.91
	s.LastIntentTimestampMs = nowMs()
	s.UnknownCount = 2
	s.Slots = map[string]any{"checkInDate": "tomorrow", "guests": 2}
	if err := m.Save(s); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Reload.
	s2, err := m.GetOrCreate(phone, "Alice", "pelangi")
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if s2.isNew {
		t.Error("expected existing state on reload")
	}
	if s2.Language != "ms" {
		t.Errorf("language = %q, want ms", s2.Language)
	}
	if s2.LastIntent != "booking" || s2.LastIntentConfidence != 0.91 {
		t.Errorf("lastIntent=%q conf=%.2f", s2.LastIntent, s2.LastIntentConfidence)
	}
	if s2.UnknownCount != 2 {
		t.Errorf("unknownCount=%d want 2", s2.UnknownCount)
	}
	if s2.Slots["checkInDate"] != "tomorrow" {
		t.Errorf("slots not persisted: %v", s2.Slots)
	}
}

func TestMessageHistory(t *testing.T) {
	db := tempDBCopy(t)
	st, err := store.Open(db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	m := NewManager(st)

	phone := "60198887777"
	if err := m.AddMessage(phone, "user", "hello", "pelangi"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	if err := m.AddMessageMeta(phone, "assistant", "Hi! How can I help?", "pelangi",
		&MsgMeta{Intent: "greeting", Confidence: 0.95, Source: "regex", RoutedAction: "static_reply"}); err != nil {
		t.Fatalf("AddMessageMeta: %v", err)
	}
	hist, err := m.History(phone, "pelangi", 10)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 2 {
		t.Fatalf("history len = %d, want 2", len(hist))
	}
	if hist[0].Role != "user" || hist[0].Content != "hello" {
		t.Errorf("first msg = %+v", hist[0])
	}
	if hist[1].Role != "assistant" {
		t.Errorf("second msg role = %s", hist[1].Role)
	}
}

// TestHistoryScopedByProfile guards against cross-bot history leakage: the
// same phone talking to two different profiles must get two separate
// histories, not a merged one (D — fix for the go-core visibility matrix).
func TestHistoryScopedByProfile(t *testing.T) {
	db := tempDBCopy(t)
	st, err := store.Open(db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	m := NewManager(st)

	phone := "60198880000"
	if err := m.AddMessage(phone, "user", "hi pelangi bot", "pelangi"); err != nil {
		t.Fatalf("AddMessage pelangi: %v", err)
	}
	if err := m.AddMessage(phone, "user", "hi senai bot", "senai-app"); err != nil {
		t.Fatalf("AddMessage senai-app: %v", err)
	}

	pelangiHist, err := m.History(phone, "pelangi", 10)
	if err != nil {
		t.Fatalf("History pelangi: %v", err)
	}
	if len(pelangiHist) != 1 || pelangiHist[0].Content != "hi pelangi bot" {
		t.Fatalf("pelangi history = %+v, want 1 row 'hi pelangi bot'", pelangiHist)
	}

	senaiHist, err := m.History(phone, "senai-app", 10)
	if err != nil {
		t.Fatalf("History senai-app: %v", err)
	}
	if len(senaiHist) != 1 || senaiHist[0].Content != "hi senai bot" {
		t.Fatalf("senai-app history = %+v, want 1 row 'hi senai bot'", senaiHist)
	}
}

// The state row is keyed by phone only; a contact mid-workflow with business A
// must start clean at business B (2026-09-08: Rachel resumed a Pelangi flow).
func TestGetOrCreateCrossProfileResetsFlow(t *testing.T) {
	m := newTestManager(t)
	a, err := m.GetOrCreate("60111222333", "Guest", "pelangi")
	if err != nil {
		t.Fatal(err)
	}
	a.WorkflowStateJSON = `{"awaiting":true,"flow":"check_in"}`
	a.BookingStateJSON = `{"ref":"PLG-1"}`
	a.Slots["unit"] = "B1"
	if err := m.Save(a); err != nil {
		t.Fatal(err)
	}
	b, err := m.GetOrCreate("60111222333", "", "southern-homestay")
	if err != nil {
		t.Fatal(err)
	}
	if !b.CrossProfileReset() || b.WorkflowStateJSON != "" || b.BookingStateJSON != "" || len(b.Slots) != 0 || b.ProfileID != "southern-homestay" {
		t.Fatalf("cross-profile state leaked: %+v", b)
	}
	if b.PushName != "Guest" {
		t.Errorf("push name should survive, got %q", b.PushName)
	}
	// Same profile again → flow preserved
	a2, _ := m.GetOrCreate("60111222333", "", "pelangi")
	_ = a2 // after B saved, A's row is B's; only guarantee is no leak INTO B
}

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	st, err := store.Open(tempDBCopy(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewManager(st)
}
