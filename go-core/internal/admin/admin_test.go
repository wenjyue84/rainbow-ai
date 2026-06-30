package admin

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"rainbow-core/internal/store"
)

func tempDB(t *testing.T) string {
	t.Helper()
	src := filepath.Join("..", "..", "..", "data", "rainbow-ai.db")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("no local DB: %v", err)
	}
	dst := filepath.Join(t.TempDir(), "test.db")
	in, _ := os.Open(src)
	defer in.Close()
	out, _ := os.Create(dst)
	io.Copy(out, in)
	out.Close()
	return dst
}

func newServer(t *testing.T, key string) (*httptest.Server, *store.Store) {
	t.Helper()
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	New(st, key, "", "").Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { srv.Close(); st.Close() })
	return srv, st
}

func get(t *testing.T, url, key string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	if key != "" {
		req.Header.Set("X-Admin-Key", key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	return resp.StatusCode, m
}

func TestStats(t *testing.T) {
	srv, _ := newServer(t, "")
	code, body := get(t, srv.URL+"/api/rainbow/stats", "")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	if _, ok := body["conversations"]; !ok {
		t.Errorf("missing conversations count: %v", body)
	}
}

func TestConversationsAndMessages(t *testing.T) {
	srv, st := newServer(t, "")
	// Seed a conversation + messages.
	st.DB.Exec(`INSERT INTO rainbow_conversations (phone, push_name, profile_id, status, created_at, updated_at) VALUES ('60ADMIN','Tester','pelangi','active',?,?)`, store.NowISO(), store.NowISO())
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id, intent, confidence, source) VALUES ('60ADMIN','user','hello',?, 'pelangi','greeting',0.95,'regex')`, store.NowISO())
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('60ADMIN','assistant','hi there',?, 'pelangi')`, store.NowISO())

	code, body := get(t, srv.URL+"/api/rainbow/conversations?limit=100", "")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	convos, _ := body["conversations"].([]any)
	found := false
	for _, c := range convos {
		if m, ok := c.(map[string]any); ok && m["phone"] == "60ADMIN" {
			found = true
		}
	}
	if !found {
		t.Error("seeded conversation not listed")
	}

	code, mbody := get(t, srv.URL+"/api/rainbow/conversations/60ADMIN/messages", "")
	if code != 200 {
		t.Fatalf("messages status %d", code)
	}
	msgs, _ := mbody["messages"].([]any)
	if len(msgs) < 2 {
		t.Errorf("expected >=2 messages, got %d", len(msgs))
	}
	// chronological: first is the user 'hello'
	if first, ok := msgs[0].(map[string]any); ok && first["content"] != "hello" {
		t.Errorf("messages not chronological: first=%v", first["content"])
	}
}

func TestAuthRequired(t *testing.T) {
	srv, _ := newServer(t, "secret-key")
	code, _ := get(t, srv.URL+"/api/rainbow/stats", "") // no key
	if code != 401 {
		t.Errorf("expected 401 without key, got %d", code)
	}
	code, _ = get(t, srv.URL+"/api/rainbow/stats", "secret-key")
	if code != 200 {
		t.Errorf("expected 200 with key, got %d", code)
	}
}
