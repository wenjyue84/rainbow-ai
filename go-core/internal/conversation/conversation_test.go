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
	hist, err := m.History(phone, 10)
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
