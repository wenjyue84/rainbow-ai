package admin

// Cross-profile isolation suite for the live-chat surface. Every test seeds a
// FRESH SQLite DB with three profiles (pelangi = default, dental-world,
// senai-app) and asserts that one profile's conversations are invisible and
// untouchable from another profile's view — the "absolute separation" rule.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rainbow-core/internal/contract"
	"rainbow-core/internal/store"
)

// isoSchema is the minimal shared-table schema the admin handlers touch.
const isoSchema = `
CREATE TABLE rainbow_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	phone TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	timestamp TEXT,
	intent TEXT, confidence REAL, source TEXT,
	routed_action TEXT, model TEXT, response_time_ms INTEGER,
	message_type TEXT, staff_name TEXT,
	profile_id TEXT, deleted_at TEXT
);
CREATE TABLE rainbow_conversations (
	phone TEXT PRIMARY KEY, push_name TEXT, profile_id TEXT,
	status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE rainbow_conversation_state (
	phone TEXT PRIMARY KEY, push_name TEXT
);
CREATE TABLE app_settings (
	id TEXT PRIMARY KEY, key TEXT UNIQUE, value TEXT, updated_at INTEGER
);
CREATE TABLE admin_users (
	username TEXT PRIMARY KEY, password_hash TEXT, role TEXT,
	allowed_tenants TEXT, totp_enabled INTEGER DEFAULT 0
);
`

const isoKey = "iso-admin-key"

// fakeSender records bridge sends so tests can prove (non-)delivery.
type fakeSender struct{ calls []string }

func (f *fakeSender) SendText(_ context.Context, phone, text, instanceID string) (*contract.SendResult, error) {
	f.calls = append(f.calls, phone+"|"+instanceID)
	return &contract.SendResult{}, nil
}

// newIsoServer builds a handler over a fresh DB seeded with one WhatsApp
// conversation + one webchat session per profile.
func newIsoServer(t *testing.T) (*httptest.Server, *store.Store, *fakeSender) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "iso.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB.Exec(isoSchema); err != nil {
		t.Fatal(err)
	}
	seed := func(phone, profile, content, pushName string) {
		ts := store.NowISO()
		if _, err := st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES (?,?,?,?,?)`,
			phone, "user", content, ts, profile); err != nil {
			t.Fatal(err)
		}
		st.DB.Exec(`INSERT OR IGNORE INTO rainbow_conversation_state (phone, push_name) VALUES (?,?)`, phone, pushName)
	}
	// pelangi (default profile) — legacy rows carry profile_id 'pelangi' or NULL.
	seed("60100000001", "pelangi", "hostel booking question", "Pelangi Guest")
	seed("web:sidpel", "pelangi", "pelangi web hello", "Pelangi Web")
	// dental-world
	seed("60200000001", "dental-world", "tooth hurts", "Dental Patient")
	seed("web:sidden", "dental-world", "dental web hello", "Dental Web")
	// senai-app
	seed("60300000001", "senai-app", "rent due", "Senai Tenant")
	// Shared guest phone: same human talks to BOTH businesses.
	seed("60900000009", "pelangi", "hi pelangi", "Shared Guest")
	seed("60900000009", "dental-world", "hi dental", "Shared Guest")

	h := New(st, isoKey, "", "")
	h.SetProfiles([]string{"pelangi", "dental-world", "senai-app"}, "pelangi")
	fs := &fakeSender{}
	h.SetSender(fs)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { srv.Close(); st.Close() })
	return srv, st, fs
}

// isoReq performs a request with the raw admin key + optional profile header.
func isoReq(t *testing.T, method, url, profile string, body any) (int, []byte) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, url, rdr)
	req.Header.Set("X-Admin-Key", isoKey)
	req.Header.Set("Content-Type", "application/json")
	if profile != "" {
		req.Header.Set("x-profile-id", profile)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.Bytes()
}

// ── List isolation (regression guards — expected green) ─────────────────────

func TestIsoUnifiedListPerProfile(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	cases := []struct {
		profile string
		want    map[string]bool // phone → must appear
		ban     []string        // phones that must NOT appear
	}{
		{"dental-world",
			map[string]bool{"60200000001": true, "web:sidden": true, "60900000009": true},
			[]string{"60100000001", "60300000001", "web:sidpel"}},
		{"senai-app",
			map[string]bool{"60300000001": true},
			[]string{"60100000001", "60200000001", "60900000009", "web:sidpel", "web:sidden"}},
		{"", // default view = pelangi only
			map[string]bool{"60100000001": true, "web:sidpel": true, "60900000009": true},
			[]string{"60200000001", "60300000001", "web:sidden"}},
	}
	for _, c := range cases {
		code, body := isoReq(t, "GET", srv.URL+"/api/rainbow/conversations/unified?limit=100", c.profile, nil)
		if code != 200 {
			t.Fatalf("[%s] code=%d", c.profile, code)
		}
		var rows []map[string]any
		json.Unmarshal(body, &rows)
		seen := map[string]bool{}
		for _, r := range rows {
			seen[fmt.Sprint(r["phone"])] = true
		}
		for p := range c.want {
			if !seen[p] {
				t.Errorf("[%s] missing own conversation %s", c.profile, p)
			}
		}
		for _, p := range c.ban {
			if seen[p] {
				t.Errorf("[%s] LEAK: sees foreign conversation %s", c.profile, p)
			}
		}
	}
}

func TestIsoMessagesEndpointForeignPhoneEmpty(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	code, body := isoReq(t, "GET", srv.URL+"/api/rainbow/conversations/60100000001/messages", "dental-world", nil)
	if code != 200 && code != 404 {
		t.Fatalf("code=%d", code)
	}
	var out struct {
		Messages []any `json:"messages"`
	}
	json.Unmarshal(body, &out)
	if len(out.Messages) != 0 {
		t.Errorf("LEAK: foreign phone returned %d messages", len(out.Messages))
	}
}

// ── Conversation log: foreign phone must 404 and never leak pushName ────────

func TestIsoConversationLogForeignPhone(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	code, body := isoReq(t, "GET", srv.URL+"/api/rainbow/conversations/60100000001", "dental-world", nil)
	if code != 404 {
		t.Errorf("foreign conversation log: code=%d want 404 (existence probing)", code)
	}
	if bytes.Contains(body, []byte("Pelangi Guest")) {
		t.Errorf("LEAK: foreign pushName returned: %s", body)
	}
}

func TestIsoConversationLogSharedPhoneScoped(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	code, body := isoReq(t, "GET", srv.URL+"/api/rainbow/conversations/60900000009", "dental-world", nil)
	if code != 200 {
		t.Fatalf("own view of shared phone: code=%d", code)
	}
	var out struct {
		Messages []struct{ Content string } `json:"messages"`
	}
	json.Unmarshal(body, &out)
	for _, m := range out.Messages {
		if m.Content == "hi pelangi" {
			t.Error("LEAK: pelangi-side messages of shared phone visible to dental-world")
		}
	}
}

// ── Send: staff must not reach a conversation outside their profile ─────────

func TestIsoSendForeignWhatsAppBlocked(t *testing.T) {
	srv, st, fs := newIsoServer(t)
	code, _ := isoReq(t, "POST", srv.URL+"/api/rainbow/conversations/60100000001/send", "dental-world",
		map[string]any{"message": "cross-profile ping", "staffName": "Mallory"})
	if code == 200 {
		t.Error("HOLE: cross-profile WhatsApp send accepted")
	}
	if len(fs.calls) != 0 {
		t.Errorf("HOLE: bridge delivery attempted for foreign phone: %v", fs.calls)
	}
	var n int
	st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone='60100000001' AND role='staff'`).Scan(&n)
	if n != 0 {
		t.Errorf("HOLE: staff row persisted into foreign conversation (n=%d)", n)
	}
}

func TestIsoSendOwnWhatsAppWorks(t *testing.T) {
	srv, _, fs := newIsoServer(t)
	code, body := isoReq(t, "POST", srv.URL+"/api/rainbow/conversations/60200000001/send", "dental-world",
		map[string]any{"message": "your appointment is confirmed", "staffName": "Dr Koh"})
	if code != 200 {
		t.Fatalf("own-profile send failed: code=%d body=%s", code, body)
	}
	if len(fs.calls) != 1 {
		t.Fatalf("expected 1 bridge call, got %v", fs.calls)
	}
}

func TestIsoSendForeignWebchatBlocked(t *testing.T) {
	srv, st, _ := newIsoServer(t)
	code, _ := isoReq(t, "POST", srv.URL+"/api/rainbow/conversations/web:sidpel/send", "dental-world",
		map[string]any{"message": "cross-profile webchat inject"})
	if code == 200 {
		t.Error("HOLE: cross-profile webchat send accepted")
	}
	var n int
	st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone='web:sidpel' AND role='staff'`).Scan(&n)
	if n != 0 {
		t.Errorf("HOLE: staff row injected into foreign webchat session (n=%d)", n)
	}
}

// ── Response-mode: ownership + per-profile keying ────────────────────────────

func TestIsoModeForeignPhoneBlocked(t *testing.T) {
	srv, st, _ := newIsoServer(t)
	code, _ := isoReq(t, "POST", srv.URL+"/api/rainbow/conversations/60100000001/mode", "dental-world",
		map[string]any{"mode": "manual"})
	if code == 200 {
		t.Error("HOLE: cross-profile mode change accepted")
	}
	var n int
	st.DB.QueryRow(`SELECT COUNT(*) FROM app_settings WHERE key LIKE '%60100000001%'`).Scan(&n)
	if n != 0 {
		t.Errorf("HOLE: foreign conversation mode persisted (n=%d)", n)
	}
}

func TestIsoModeSharedPhoneScopedPerProfile(t *testing.T) {
	srv, st, _ := newIsoServer(t)
	// dental sets manual on the shared guest; pelangi's view must stay untouched.
	code, _ := isoReq(t, "POST", srv.URL+"/api/rainbow/conversations/60900000009/mode", "dental-world",
		map[string]any{"mode": "manual"})
	if code != 200 {
		t.Fatalf("own-profile mode set failed: code=%d", code)
	}
	var plain string
	err := st.DB.QueryRow(`SELECT value FROM app_settings WHERE key='conv_mode_60900000009'`).Scan(&plain)
	if err == nil && plain == "manual" {
		t.Error("HOLE: mode key is global (conv_mode_<phone>) — pelangi's bot for the shared guest now forced manual by dental staff")
	}
}

// ── Webchat family ───────────────────────────────────────────────────────────

func TestIsoWebchatConversationForeignSid(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	code, body := isoReq(t, "GET", srv.URL+"/api/rainbow/webchat/conversations/sidpel", "dental-world", nil)
	if code != 404 {
		t.Errorf("foreign webchat session: code=%d want 404", code)
	}
	if bytes.Contains(body, []byte("pelangi web hello")) {
		t.Errorf("LEAK: foreign webchat transcript: %s", body)
	}
}

func TestIsoWebchatReplyForeignSidBlocked(t *testing.T) {
	srv, st, _ := newIsoServer(t)
	code, _ := isoReq(t, "POST", srv.URL+"/api/rainbow/webchat/conversations/sidpel/reply", "dental-world",
		map[string]any{"message": "foreign staff injection"})
	if code == 200 {
		t.Error("HOLE: cross-profile webchat reply accepted")
	}
	var n int
	st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone LIKE '%sidpel' AND role='staff'`).Scan(&n)
	if n != 0 {
		t.Errorf("HOLE: staff reply injected into foreign session (n=%d)", n)
	}
}

func TestIsoSessionsMergedForeignSidsExcluded(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	code, body := isoReq(t, "GET",
		srv.URL+"/api/rainbow/webchat/sessions-merged?sessions=sidpel,sidden", "dental-world", nil)
	if code != 200 && code != 404 {
		t.Fatalf("code=%d", code)
	}
	if bytes.Contains(body, []byte("pelangi web hello")) {
		t.Errorf("LEAK: merged view exposes foreign session transcript")
	}
	if bytes.Contains(body, []byte("Pelangi Web")) {
		t.Errorf("LEAK: merged view exposes foreign pushName")
	}
}

// ── Stats must be scoped to the requesting profile ──────────────────────────

func TestIsoStatsScoped(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	code, body := isoReq(t, "GET", srv.URL+"/api/rainbow/stats", "senai-app", nil)
	if code != 200 {
		t.Fatalf("code=%d", code)
	}
	var out struct {
		Conversations, Messages float64
	}
	json.Unmarshal(body, &out)
	// senai-app owns exactly 1 message / 1 conversation in the seed.
	if out.Messages != 1 {
		t.Errorf("LEAK: stats.messages=%v for senai-app, want 1 (global counts leak business volume)", out.Messages)
	}
}

// ── SPA fetch interceptor must not destroy other wrappers' headers ──────────
// Regression: the injected X-Admin-Key interceptor used Object.assign on a
// Headers INSTANCE (set by profile-switcher.js), which dropped x-profile-id +
// Content-Type — profile switching then served the default business's chats.
func TestSpaInterceptorMergesViaHeadersAPI(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "rainbow-admin.html"), []byte("<html><head></head></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := &Handler{adminKey: isoKey, publicDir: dir}
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Cookie", sessionCookie+"="+isoKey)
	rec := httptest.NewRecorder()
	h.spa(rec, req)
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, "window.__ADMIN_KEY__") {
		t.Fatalf("spa gate did not serve dashboard: code=%d", rec.Code)
	}
	if !strings.Contains(body, "new Headers(") {
		t.Error("interceptor must merge via the Headers API")
	}
	if strings.Contains(body, "Object.assign({'X-Admin-Key'") {
		t.Error("interceptor rebuilds headers with Object.assign — drops Headers-instance entries (x-profile-id)")
	}
}

// ── Scoped session end-to-end: login token confined to its tenant ────────────

func TestIsoScopedSessionEndToEnd(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	tok := mintSession(isoKey, Session{
		Username: "drkoh", Role: "operator", Tenants: []string{"dental-world"},
		Exp: time.Now().Add(time.Hour).Unix(),
	})
	do := func(method, path, profile string) (int, []byte) {
		req, _ := http.NewRequest(method, srv.URL+path, nil)
		req.Header.Set("X-Admin-Key", tok)
		if profile != "" {
			req.Header.Set("x-profile-id", profile)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var buf bytes.Buffer
		buf.ReadFrom(resp.Body)
		return resp.StatusCode, buf.Bytes()
	}
	// No header → rewritten to dental-world; list must hold only dental rows.
	code, body := do("GET", "/api/rainbow/conversations/unified?limit=100", "")
	if code != 200 {
		t.Fatalf("scoped list: code=%d", code)
	}
	for _, leak := range []string{"60100000001", "60300000001", "web:sidpel"} {
		if bytes.Contains(body, []byte(leak)) {
			t.Errorf("LEAK: scoped session sees %s", leak)
		}
	}
	// Forced foreign header → 403.
	if code, _ := do("GET", "/api/rainbow/conversations/unified", "pelangi"); code != 403 {
		t.Errorf("scoped cross-tenant header: code=%d want 403", code)
	}
	// Direct foreign conversation fetch under own tenant → no content.
	code, body = do("GET", "/api/rainbow/conversations/60100000001", "dental-world")
	if code == 200 && bytes.Contains(body, []byte("hostel booking question")) {
		t.Error("LEAK: scoped session reads foreign transcript")
	}
}
