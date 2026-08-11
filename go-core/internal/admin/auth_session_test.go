package admin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Hash produced by Node: crypto.scrypt('admin123', salt, 64) with salt =
// randomBytes(16).toString('hex') — verifies Go/Node scrypt parameter parity.
const nodeHash = "3208eef9552c0dfc2636e4dd0c3d4c7c:671d5406267d3f86b4ad69b7d2d4c6c8e84e9e6380c701e4813d75154fff90652a382cab1fa4e14d5b8e7753092c507edcefb384b68745a8b2a2e55235b042b5"

func TestScryptVerifyNodeParity(t *testing.T) {
	if !scryptVerify("admin123", nodeHash) {
		t.Fatal("correct password rejected")
	}
	if scryptVerify("admin124", nodeHash) {
		t.Fatal("wrong password accepted")
	}
	if scryptVerify("admin123", "malformed") {
		t.Fatal("malformed hash accepted")
	}
}

func TestSessionTokenRoundTrip(t *testing.T) {
	secret := "test-secret"
	s := Session{Username: "admin", Role: "operator", Tenants: []string{"dental-world"}, Exp: time.Now().Add(time.Hour).Unix()}
	tok := mintSession(secret, s)

	got := verifySession(secret, tok)
	if got == nil {
		t.Fatal("valid token rejected")
	}
	if got.Username != "admin" || !got.Scoped() || got.Tenants[0] != "dental-world" {
		t.Fatalf("payload mismatch: %+v", got)
	}
	if verifySession("other-secret", tok) != nil {
		t.Fatal("token accepted under wrong secret")
	}
	if verifySession(secret, tok+"x") != nil {
		t.Fatal("tampered token accepted")
	}
	expired := mintSession(secret, Session{Username: "admin", Exp: time.Now().Add(-time.Minute).Unix()})
	if verifySession(secret, expired) != nil {
		t.Fatal("expired token accepted")
	}
	if verifySession(secret, "not-a-token") != nil {
		t.Fatal("garbage accepted")
	}
}

// authProbe wraps h.auth around a handler that records the effective profile
// header, mimicking a scoped dashboard API call.
func authProbe(t *testing.T, h *Handler, cred, profileHeader string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	var seenProfile string
	next := func(w http.ResponseWriter, r *http.Request) {
		seenProfile = r.Header.Get("x-profile-id")
		writeJSON(w, 200, map[string]any{"ok": true})
	}
	req := httptest.NewRequest("GET", "/api/rainbow/settings", nil)
	if cred != "" {
		req.Header.Set("X-Admin-Key", cred)
	}
	if profileHeader != "" {
		req.Header.Set("x-profile-id", profileHeader)
	}
	rec := httptest.NewRecorder()
	h.auth(next)(rec, req)
	return rec, seenProfile
}

func TestAuthScopedTenantEnforcement(t *testing.T) {
	key := "real-admin-key"
	h := &Handler{adminKey: key, profileIDs: []string{"pelangi", "senai-app", "dental-world"}, defaultProfile: "pelangi"}
	scoped := mintSession(key, Session{
		Username: "admin", Role: "operator", Tenants: []string{"dental-world"},
		Exp: time.Now().Add(time.Hour).Unix(),
	})

	// Raw key: full access, header untouched.
	rec, seen := authProbe(t, h, key, "pelangi")
	if rec.Code != 200 || seen != "pelangi" {
		t.Fatalf("raw key: code=%d seen=%q", rec.Code, seen)
	}

	// Scoped token + no header → rewritten to the allowed tenant.
	rec, seen = authProbe(t, h, scoped, "")
	if rec.Code != 200 || seen != "dental-world" {
		t.Fatalf("scoped no-header: code=%d seen=%q", rec.Code, seen)
	}

	// Scoped token + own tenant → allowed.
	rec, _ = authProbe(t, h, scoped, "dental-world")
	if rec.Code != 200 {
		t.Fatalf("scoped own tenant: code=%d", rec.Code)
	}

	// Scoped token + other tenants → 403.
	for _, other := range []string{"pelangi", "senai-app"} {
		rec, _ = authProbe(t, h, scoped, other)
		if rec.Code != 403 {
			t.Fatalf("scoped cross-tenant %s: code=%d want 403", other, rec.Code)
		}
	}

	// Bad credential → 401.
	rec, _ = authProbe(t, h, "wrong", "")
	if rec.Code != 401 {
		t.Fatalf("bad cred: code=%d want 401", rec.Code)
	}
	rec, _ = authProbe(t, h, "", "")
	if rec.Code != 401 {
		t.Fatalf("no cred: code=%d want 401", rec.Code)
	}
}

func TestScopedBlockedEndpoints(t *testing.T) {
	key := "real-admin-key"
	h := &Handler{adminKey: key, profileIDs: []string{"dental-world"}, defaultProfile: "pelangi"}
	scoped := mintSession(key, Session{
		Username: "admin", Role: "operator", Tenants: []string{"dental-world"},
		Exp: time.Now().Add(time.Hour).Unix(),
	})
	next := func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"ok": true}) }

	cases := []struct {
		method, path string
		want         int
	}{
		{"PUT", "/api/rainbow/admin-notifications/operators", 403},
		{"PUT", "/api/rainbow/admin-notifications/system-admin-phone", 403},
		{"GET", "/api/rainbow/admin-notifications", 200}, // sanitized in handler
		{"POST", "/api/rainbow/tests/run", 403},
		{"POST", "/api/rainbow/testing/run-all", 403},
		{"GET", "/api/rainbow/settings", 200},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, nil)
		req.Header.Set("X-Admin-Key", scoped)
		rec := httptest.NewRecorder()
		h.auth(next)(rec, req)
		if rec.Code != c.want {
			t.Fatalf("%s %s: code=%d want %d", c.method, c.path, rec.Code, c.want)
		}
	}
}

func TestSpaGatedWithoutCredential(t *testing.T) {
	h := &Handler{adminKey: "secret-key-1", publicDir: t.TempDir()}
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	h.spa(rec, req)
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, "Sign in") {
		t.Fatalf("expected login page, code=%d", rec.Code)
	}
	if strings.Contains(body, "secret-key-1") {
		t.Fatal("admin key leaked to anonymous visitor")
	}
}
