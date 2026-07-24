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

	// /conversations returns a RAW ARRAY (the SPA does $.conversations.filter).
	code, convos := getArray(t, srv.URL+"/api/rainbow/conversations?limit=500", "")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
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

// getArray decodes an endpoint that returns a raw JSON array.
func getArray(t *testing.T, url, key string) (int, []any) {
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
	var a []any
	json.NewDecoder(resp.Body).Decode(&a)
	return resp.StatusCode, a
}

func TestUnifiedAndWebchat(t *testing.T) {
	srv, st := newServer(t, "")
	// Seed one WhatsApp and one webchat conversation.
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('60UNIFIED','user','wa hello',?, 'pelangi')`, store.NowISO())
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('web:sess1','user','web hello',?, 'pelangi')`, store.NowISO())
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('web:sess1','assistant','web reply',?, 'pelangi')`, store.NowISO())

	// Unified list: channels tagged, lastMessageAt numeric.
	code, list := getArray(t, srv.URL+"/api/rainbow/conversations/unified?limit=500", "")
	if code != 200 {
		t.Fatalf("unified status %d", code)
	}
	var sawWA, sawWC bool
	for _, it := range list {
		m, _ := it.(map[string]any)
		switch m["phone"] {
		case "60UNIFIED":
			sawWA = true
			if m["channel"] != "whatsapp" || m["instanceId"] != "default" {
				t.Errorf("wa row wrong: %v", m)
			}
		case "web:sess1":
			sawWC = true
			if m["channel"] != "webchat" || m["sessionId"] != "sess1" {
				t.Errorf("webchat row wrong: %v", m)
			}
			if _, ok := m["lastMessageAt"].(float64); !ok {
				t.Errorf("lastMessageAt not numeric: %T", m["lastMessageAt"])
			}
		}
	}
	if !sawWA || !sawWC {
		t.Errorf("unified missing rows: wa=%v wc=%v", sawWA, sawWC)
	}

	// Webchat list: only webchat sessions.
	code, wlist := getArray(t, srv.URL+"/api/rainbow/webchat/conversations", "")
	if code != 200 {
		t.Fatalf("webchat list status %d", code)
	}
	found := false
	for _, it := range wlist {
		m, _ := it.(map[string]any)
		if m["sessionId"] == "sess1" {
			found = true
		}
		if m["channel"] != "webchat" {
			t.Errorf("non-webchat row in webchat list: %v", m)
		}
	}
	if !found {
		t.Error("sess1 not in webchat list")
	}

	// Full log shape for the WhatsApp conversation.
	code, clog := get(t, srv.URL+"/api/rainbow/conversations/60UNIFIED", "")
	if code != 200 {
		t.Fatalf("log status %d", code)
	}
	if _, ok := clog["responseMode"]; !ok {
		t.Errorf("log missing responseMode: %v", clog)
	}
	if msgs, _ := clog["messages"].([]any); len(msgs) < 1 {
		t.Errorf("log missing messages: %v", clog)
	}

	// Webchat session log (chronological).
	code, wlog := get(t, srv.URL+"/api/rainbow/webchat/conversations/sess1", "")
	if code != 200 {
		t.Fatalf("webchat log status %d", code)
	}
	msgs, _ := wlog["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 webchat messages, got %d", len(msgs))
	}
	if first, _ := msgs[0].(map[string]any); first["content"] != "web hello" {
		t.Errorf("webchat log not chronological: %v", first)
	}

	// Merged sessions endpoint.
	code, mlog := get(t, srv.URL+"/api/rainbow/webchat/sessions-merged?sessions=sess1", "")
	if code != 200 {
		t.Fatalf("merged status %d", code)
	}
	if mmsgs, _ := mlog["messages"].([]any); len(mmsgs) != 2 {
		t.Errorf("merged expected 2 messages, got %d", len(mmsgs))
	}

	// Read no-ops return 200.
	for _, path := range []string{
		"/api/rainbow/conversations/60UNIFIED/read",
		"/api/rainbow/webchat/conversations/sess1/read",
	} {
		req, _ := http.NewRequest("PATCH", srv.URL+path, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Errorf("%s: expected 200, got %d", path, resp.StatusCode)
		}
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
