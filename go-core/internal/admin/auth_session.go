// Username/password login for the admin dashboard, backed by the shared
// admin_users SQLite table (created by the Node monolith, scrypt "salt:hex"
// password hashes with Node's default params N=16384 r=8 p=1 keylen=64).
//
// A successful login mints a signed session token:
//
//	rst1.<base64url payload JSON>.<base64url HMAC-SHA256(payload, RAINBOW_ADMIN_KEY)>
//
// The payload carries the username, role and allowed_tenants list. The token is
// set as an HttpOnly cookie AND accepted in the X-Admin-Key header, so the
// existing SPA fetch interceptor (which injects window.__ADMIN_KEY__) works
// unchanged for scoped users — the server just injects the token instead of the
// real admin key. Tenant scoping is enforced server-side in auth(): a scoped
// session can only reach its allowed_tenants profiles.
package admin

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"
)

const (
	sessionCookie = "rainbow_session"
	tokenPrefix   = "rst1."
	sessionTTL    = 7 * 24 * time.Hour
)

// Session is the authenticated identity carried by a session token.
type Session struct {
	Username string   `json:"u"`
	Role     string   `json:"r"`
	Tenants  []string `json:"t,omitempty"` // empty = unrestricted
	Exp      int64    `json:"exp"`         // unix seconds
}

// Scoped reports whether the session is restricted to specific tenants.
func (s *Session) Scoped() bool { return s != nil && len(s.Tenants) > 0 }

// Allows reports whether the session may access the given profile id.
func (s *Session) Allows(profile string) bool {
	if !s.Scoped() {
		return true
	}
	for _, t := range s.Tenants {
		if t == profile {
			return true
		}
	}
	return false
}

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func signPayload(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return b64u(mac.Sum(nil))
}

// mintSession builds a signed token for the given session.
func mintSession(secret string, s Session) string {
	payload, _ := json.Marshal(s)
	return tokenPrefix + b64u(payload) + "." + signPayload(secret, payload)
}

// verifySession parses + verifies a token. Returns nil if invalid or expired.
func verifySession(secret, token string) *Session {
	if secret == "" || !strings.HasPrefix(token, tokenPrefix) {
		return nil
	}
	parts := strings.SplitN(strings.TrimPrefix(token, tokenPrefix), ".", 2)
	if len(parts) != 2 {
		return nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil
	}
	if !hmac.Equal([]byte(signPayload(secret, payload)), []byte(parts[1])) {
		return nil
	}
	var s Session
	if json.Unmarshal(payload, &s) != nil || s.Username == "" {
		return nil
	}
	if time.Now().Unix() >= s.Exp {
		return nil
	}
	return &s
}

// scryptVerify checks a password against a Node-format "salthex:keyhex" hash.
// Node's crypto.scrypt receives the salt as the hex STRING (utf-8 bytes), so
// the Go side must NOT hex-decode it.
func scryptVerify(password, stored string) bool {
	parts := strings.SplitN(stored, ":", 2)
	if len(parts) != 2 {
		return false
	}
	want, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	got, err := scrypt.Key([]byte(password), []byte(parts[0]), 16384, 8, 1, len(want))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(want, got) == 1
}

// ── Login rate limiting (per IP, fixed window) ──────────────────────────────

type loginLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

var limiter = &loginLimiter{hits: map[string][]time.Time{}}

// allow permits max 5 attempts per IP per minute.
func (l *loginLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	kept := l.hits[ip][:0]
	for _, t := range l.hits[ip] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	l.hits[ip] = kept
	if len(kept) >= 5 {
		return false
	}
	l.hits[ip] = append(l.hits[ip], now)
	return true
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// setSessionCookie attaches the session cookie (HttpOnly; SameSite=Lax).
func setSessionCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

// login handles POST /api/rainbow/auth/login {username, password}.
// Public endpoint (rate-limited): it is the way in for users who don't hold
// the raw admin key.
func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if !limiter.allow(clientIP(r)) {
		writeJSON(w, 429, map[string]any{"error": "too many attempts, try again in a minute"})
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Username == "" || in.Password == "" {
		writeJSON(w, 400, map[string]any{"error": "username and password required"})
		return
	}
	var (
		hash, role     string
		allowedTenants *string
		totpEnabled    int
	)
	err := h.st.DB.QueryRow(
		`SELECT password_hash, role, allowed_tenants, totp_enabled FROM admin_users WHERE username=?`,
		in.Username,
	).Scan(&hash, &role, &allowedTenants, &totpEnabled)
	if err != nil || !scryptVerify(in.Password, hash) {
		writeJSON(w, 401, map[string]any{"error": "invalid credentials"})
		return
	}
	if totpEnabled != 0 {
		writeJSON(w, 501, map[string]any{"error": "2FA login not supported on this endpoint"})
		return
	}
	var tenants []string
	if allowedTenants != nil && *allowedTenants != "" {
		_ = json.Unmarshal([]byte(*allowedTenants), &tenants)
	}
	sess := Session{
		Username: in.Username,
		Role:     role,
		Tenants:  tenants,
		Exp:      time.Now().Add(sessionTTL).Unix(),
	}
	token := mintSession(h.adminKey, sess)
	setSessionCookie(w, token, int(sessionTTL.Seconds()))
	writeJSON(w, 200, map[string]any{
		"authenticated":  true,
		"username":       in.Username,
		"role":           role,
		"allowedTenants": tenants,
		"token":          token,
	})
}

// logout handles POST /api/rainbow/auth/logout — clears the session cookie.
func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	setSessionCookie(w, "", -1)
	writeJSON(w, 200, map[string]any{"ok": true})
}
