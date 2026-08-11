// Package admin serves the Rainbow admin API (/api/rainbow/*) from the shared
// SQLite DB. This is the Go port of the most-used read endpoints in
// src/routes/admin/* (conversations, messages, stats, settings). The full Node
// admin API is large (~40 sub-routers) and non-leaky, so it can stay on Node
// during a phased cutover; this covers the dashboard's core read views.
package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"rainbow-core/internal/store"
)

// Handler wires the admin endpoints onto a mux.
type Handler struct {
	st        *store.Store
	adminKey  string
	publicDir string // src/public (SPA + assets); empty = don't serve the UI
	dataDir   string // src/assistant/data (config JSON for read endpoints)

	profileIDs     []string // profiles served by the hub (for the profile switcher)
	defaultProfile string
	bridgeURL      string // rainbow-bridge base URL; "" = no bridge (WA state unknown)

	ai           AIChatter        // LLM manager for generate-draft (nil = 502)
	activeModels ActiveModelsFunc // classify + reply active-model summary (nil = omit)
	classify     ClassifyFunc     // in-process classifier for the semantic check suite
	sender       TextSender       // bridge client for staff WhatsApp sends (nil = 501)
	staffNameCol     int       // rainbow_messages staff_name column: 0 unknown, 1 yes, -1 no
	staffNameColOnce sync.Once // guards one-time init of staffNameCol
}

// SetBridge supplies the bridge base URL so /status can report the live
// WhatsApp connection state instead of a hardcoded "unknown".
func (h *Handler) SetBridge(url string) { h.bridgeURL = strings.TrimRight(url, "/") }

// ActiveModelsFunc returns the active-model summary for the T4 classify manager
// and the guest-reply manager (each: {id,name,model,available}). Wired from main
// so the dashboard can show which model serves classify vs reply.
type ActiveModelsFunc func() (classify, reply map[string]any)

// SetActiveModels supplies the classify/reply active-model summary for /status.
func (h *Handler) SetActiveModels(f ActiveModelsFunc) { h.activeModels = f }

func New(st *store.Store, adminKey, publicDir, dataDir string) *Handler {
	return &Handler{st: st, adminKey: adminKey, publicDir: publicDir, dataDir: dataDir}
}

// SetProfiles supplies the served profile ids + default so /profiles renders the
// switcher. Called by main after the hub is built.
func (h *Handler) SetProfiles(ids []string, def string) {
	h.profileIDs = ids
	h.defaultProfile = def
}

// routing serves the profile's routing.json (read-only).
func (h *Handler) routing(w http.ResponseWriter, r *http.Request) {
	h.serveJSONFile(w, r, "routing.json")
}

// ── Profile isolation ───────────────────────────────────────────────────────
// Every config read/write resolves through reqProfile + profileVariant. The old
// profileFilePath fell back to the GLOBAL file whenever a profile variant was
// missing on disk, which showed — and on write paths, overwrote — the default
// business's data under every other profile. Isolation rule: a non-default
// profile NEVER touches the global (default-profile) file; a missing variant
// reads as an empty document and is created on first write.

var profileIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// reqProfile returns the profile id from x-profile-id, mapped to "" for the
// default profile (which owns the unsuffixed global files). Malformed or
// unknown ids return an error — a typo must fail loudly, not leak another
// business's data.
func (h *Handler) reqProfile(r *http.Request) (string, error) {
	p := strings.ToLower(strings.TrimSpace(r.Header.Get("x-profile-id")))
	if p == "" {
		return "", nil
	}
	if !profileIDRe.MatchString(p) {
		return "", fmt.Errorf("invalid x-profile-id %q", p)
	}
	def := h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	if p == def {
		return "", nil
	}
	if len(h.profileIDs) > 0 {
		for _, id := range h.profileIDs {
			if id == p {
				return p, nil
			}
		}
		return "", fmt.Errorf("unknown profile %q", p)
	}
	return p, nil
}

// profileVariant maps name.ext to name-<profile>.ext.
func profileVariant(name, profile string) string {
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext) + "-" + profile + ext
}

// emptyDocLike returns "[]" when the reference file holds a JSON array, "{}"
// otherwise — so a profile with no data yet gets a type-correct empty doc and
// the SPA renders its empty state instead of erroring.
func emptyDocLike(refPath string) []byte {
	if b, err := os.ReadFile(refPath); err == nil {
		for _, c := range b {
			if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
				continue
			}
			if c == '[' {
				return []byte("[]")
			}
			break
		}
	}
	return []byte("{}")
}

// serveJSONFile streams a config JSON file from the data dir. Non-default
// profiles are served ONLY their own -<profile> variant; if it doesn't exist
// yet the response is an empty doc, never the default profile's file.
func (h *Handler) serveJSONFile(w http.ResponseWriter, r *http.Request, name string) {
	if h.dataDir == "" {
		writeJSON(w, 404, map[string]any{"error": "no data dir"})
		return
	}
	p, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	path := filepath.Join(h.dataDir, name)
	if p != "" {
		path = filepath.Join(h.dataDir, profileVariant(name, p))
		if _, statErr := os.Stat(path); statErr != nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(emptyDocLike(filepath.Join(h.dataDir, name)))
			return
		}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": name + " not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

// dashboardTabs mirror the SPA client-side routes the monolith served.
var dashboardTabs = []string{
	"dashboard", "understanding", "responses", "intents", "chat-simulator",
	"testing", "performance", "settings", "help", "intent-manager",
	"static-replies", "kb", "preview", "real-chat", "workflow",
	"widget-chats", // operator view for website widget chat sessions
}

// Register mounts the admin API + (optionally) the dashboard SPA on the mux.
func (h *Handler) Register(mux *http.ServeMux) {
	// ── API (read endpoints) ──
	mux.HandleFunc("/api/rainbow/status", h.auth(h.status))
	mux.HandleFunc("/api/rainbow/stats", h.auth(h.stats))
	mux.HandleFunc("/api/rainbow/conversations", h.auth(h.conversations))
	mux.HandleFunc("/api/rainbow/settings", h.auth(h.settings))
	mux.HandleFunc("/api/rainbow/routing", h.auth(h.routing))
	mux.HandleFunc("/api/rainbow/conversations/unified", h.auth(h.unifiedConversations))
	mux.HandleFunc("/api/rainbow/conversations/", h.auth(h.conversationMessages))

	// Live-chat webchat sub-tab (js/modules/webchat-admin.js).
	mux.HandleFunc("/api/rainbow/webchat/conversations", h.auth(h.webchatConversations))
	mux.HandleFunc("/api/rainbow/webchat/conversations/", h.auth(h.webchatConversation))
	mux.HandleFunc("/api/rainbow/webchat/sessions-merged", h.auth(h.webchatSessionsMerged))

	// ── Config read endpoints (raw passthrough of the profile config JSON, so
	//    every dashboard tab's fatal load call returns 200 with the shape the SPA
	//    expects — matching the Node getStore().getX() output). ──
	mux.HandleFunc("/api/rainbow/intents", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "intents.json") }))
	mux.HandleFunc("/api/rainbow/knowledge", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "knowledge.json") }))
	mux.HandleFunc("/api/rainbow/templates", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "templates.json") }))
	mux.HandleFunc("/api/rainbow/workflows", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "workflows.json") }))
	mux.HandleFunc("/api/rainbow/workflow", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "workflow.json") }))
	mux.HandleFunc("/api/rainbow/intent-manager/keywords", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "intent-keywords.json") }))
	mux.HandleFunc("/api/rainbow/intent-manager/examples", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, r, "intent-examples.json") }))

	// Understanding tab (t2 stats, t3 tiers, t4 LLM settings/system prompt).
	mux.HandleFunc("/api/rainbow/intent-manager/stats", h.auth(h.imStats))
	mux.HandleFunc("/api/rainbow/intent-manager/tiers", h.auth(h.imTiers))
	mux.HandleFunc("/api/rainbow/intent-manager/llm-settings", h.auth(h.imLLMSettings))
	mux.HandleFunc("/api/rainbow/intent-manager/llm-settings/available-providers", h.auth(h.imAvailableProviders))
	mux.HandleFunc("/api/rainbow/intent-manager/system-prompt", h.auth(h.imSystemPrompt))
	mux.HandleFunc("/api/rainbow/intent-manager/regex", h.auth(h.imRegex))

	// Responses tab: quick-reply draft generation (LLM-backed).
	mux.HandleFunc("/api/rainbow/knowledge/generate-draft", h.auth(h.generateDraft))

	// Testing tab: Go-native check suites in the vitest JSON shape.
	mux.HandleFunc("/api/rainbow/tests/run", h.auth(h.testsRun))
	mux.HandleFunc("/api/rainbow/testing/run-all", h.auth(h.testingRunAll))
	mux.HandleFunc("/api/rainbow/admin-notifications", h.auth(h.adminNotifications))
	mux.HandleFunc("/api/rainbow/admin-notifications/operators", h.auth(h.adminNotificationsOperators))
	mux.HandleFunc("/api/rainbow/admin-notifications/preferences", h.auth(h.adminNotificationsPreferences))
	mux.HandleFunc("/api/rainbow/admin-notifications/system-admin-phone", h.auth(h.adminNotificationsSystemPhone))

	// Booking notification from PMS2 public website bookings. NOT wrapped in
	// h.auth because PMS2's rainbowNotify sends no X-Admin-Key header. Instead,
	// an optional NOTIFY_SHARED_SECRET env var / X-Notify-Secret header pair
	// is checked inside the handler itself.
	mux.HandleFunc("/api/rainbow/notify-booking", h.notifyBooking)

	// Admin user management (CRUD for admin_users table).
	// Scoped sessions can only see/edit users within their own tenants.
	mux.HandleFunc("/api/rainbow/admin-users", h.auth(h.adminUsersRouter))
	mux.HandleFunc("/api/rainbow/admin-users/", h.auth(h.adminUsersRouter))

	// Username/password login (public, rate-limited) — mints scoped session
	// tokens for client users (e.g. dental-world) without exposing the admin key.
	mux.HandleFunc("/api/rainbow/auth/login", h.login)
	mux.HandleFunc("/api/rainbow/auth/logout", h.logout)

	// Guest webchat page + staff-reply poll, one per profile:
	//   GET /chat/{profileId}       — self-contained chat UI (POST /chat backend)
	//   GET /chat/{profileId}/poll  — staff replies after a timestamp
	mux.HandleFunc("/chat/", h.chatPage)

	// Profile switcher (called on every tab) + per-tab HTML template loader — both
	// are fatal for the SPA: the switcher runs globally, and each tab's body HTML
	// is fetched from /templates/{name}.
	mux.HandleFunc("/api/rainbow/profiles", h.auth(h.profiles))
	mux.HandleFunc("/api/rainbow/profiles/active", h.auth(h.profilesActive))
	mux.HandleFunc("/api/rainbow/templates/", h.auth(h.templatesItem))

	// Analytics endpoints backed by Postgres in the Node monolith. go-core has no
	// such data, so these return an empty-but-valid shape (totals = 0) — the SPA's
	// performance tab reads total===0 and renders a clean empty state instead of a
	// "Failed to load" error toast.
	mux.HandleFunc("/api/rainbow/feedback/stats", h.auth(h.feedbackStats))
	mux.HandleFunc("/api/rainbow/intent/accuracy", h.auth(h.intentAccuracy))

	// Activity stream: SSE endpoint the dashboard's Recent Activity panel subscribes
	// to. go-core emits an empty init event and then heartbeats — no events yet, but
	// the connection stays open so the SPA shows "connected" instead of "Reconnecting".
	mux.HandleFunc("/api/rainbow/activity/stream", h.auth(h.activityStream))

	// ── Dashboard SPA + static assets ──
	if h.publicDir != "" {
		fs := http.FileServer(http.Dir(h.publicDir))
		// no-cache (revalidate, not no-store): SPA module chunks otherwise stay
		// heuristically cached in browsers/CDN and mask fresh deploys.
		mux.Handle("/public/", http.StripPrefix("/public/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-cache")
			fs.ServeHTTP(w, r)
		})))
		mux.HandleFunc("/", h.spa)
		for _, tab := range dashboardTabs {
			mux.HandleFunc("/"+tab, h.spa)
		}
	}
}

// spa serves the admin SPA HTML behind a login gate. The credential injected as
// window.__ADMIN_KEY__ depends on who is asking:
//   - session cookie holding the raw admin key (set via ?adminKey=…) → raw key
//   - session cookie holding a signed token → that token (scoped users never
//     see the raw key, so they cannot escape their allowed_tenants)
//   - no valid credential → the login page
//
// The previous behaviour (inject the raw admin key to every anonymous visitor)
// leaked full admin access to anyone who found the URL.
func (h *Handler) spa(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && !contains(dashboardTabs, strings.TrimPrefix(r.URL.Path, "/")) {
		http.NotFound(w, r)
		return
	}
	injectVal := ""
	if h.adminKey == "" {
		injectVal = "" // no auth configured (dev) — serve open with empty key
	} else {
		// ?adminKey=<raw key> — bookmark-friendly bypass for Jay/staff: set the
		// cookie and redirect to the clean URL.
		if q := r.URL.Query().Get("adminKey"); q != "" {
			if q == h.adminKey {
				setSessionCookie(w, h.adminKey, int(sessionTTL.Seconds()))
				http.Redirect(w, r, r.URL.Path, http.StatusFound)
				return
			}
			http.Redirect(w, r, r.URL.Path, http.StatusFound)
			return
		}
		cred := h.credential(r)
		switch {
		case cred == h.adminKey:
			injectVal = h.adminKey
		case verifySession(h.adminKey, cred) != nil:
			injectVal = cred // scoped/unrestricted session token
		default:
			h.loginPage(w)
			return
		}
	}
	raw, err := os.ReadFile(filepath.Join(h.publicDir, "rainbow-admin.html"))
	if err != nil {
		http.Error(w, "dashboard not found", 500)
		return
	}
	html := string(raw)
	html = strings.ReplaceAll(html, "__CSP_NONCE__", "")
	// Build __SESSION__ so the SPA knows if the caller is scoped.
	var sessionJSON string
	if sess := verifySession(h.adminKey, injectVal); sess != nil {
		b, _ := json.Marshal(map[string]any{
			"username": sess.Username,
			"role":     sess.Role,
			"tenants":  sess.Tenants, // nil = unrestricted
		})
		sessionJSON = string(b)
	} else {
		// Raw admin key — unrestricted, no tenant list.
		sessionJSON = `{"username":"","role":"admin","tenants":null}`
	}
	// NOTE: the interceptor must merge via the Headers API, never Object.assign.
	// Other wrappers (profile-switcher.js) pass a Headers INSTANCE, whose entries
	// are not own-enumerable — Object.assign silently dropped x-profile-id and
	// Content-Type, so profile switching served the default business's chats.
	inject := `<script>window.__ADMIN_KEY__=` + jsonString(injectVal) + `;window.__SESSION__=` + sessionJSON + `;
(function(){var _f=window.fetch;window.fetch=function(u,o){try{var url=typeof u==='string'?u:((u&&u.url)||'');if(url.indexOf('/api/rainbow/')>=0&&window.__ADMIN_KEY__){o=o||{};var h=new Headers(o.headers||(typeof u!=='string'&&u.headers)||{});if(!h.has('x-admin-key')){h.set('X-Admin-Key',window.__ADMIN_KEY__);}o.headers=h;}}catch(e){}return _f.call(this,u,o);};})();
</script>`
	html = strings.Replace(html, "<head>", "<head>\n"+inject, 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(html))
}

// loginPage serves a minimal self-contained login form. On success the server
// sets the session cookie; the page then reloads into the SPA.
func (h *Handler) loginPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rainbow AI — Login</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1e293b;padding:32px;border-radius:14px;width:320px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
h1{font-size:20px;margin:0 0 4px}p{color:#94a3b8;font-size:13px;margin:0 0 20px}
input{width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px}
button{width:100%;padding:10px;border:0;border-radius:8px;background:#6366f1;color:#fff;font-size:15px;cursor:pointer}
button:hover{background:#4f46e5}.err{color:#f87171;font-size:13px;min-height:18px;margin-bottom:8px}
</style></head><body>
<div class="card"><h1>🌈 Rainbow AI</h1><p>Admin dashboard login</p>
<div class="err" id="err"></div>
<form id="f"><input id="u" placeholder="Username" autocomplete="username" required>
<input id="p" type="password" placeholder="Password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form></div>
<script>
document.getElementById('f').addEventListener('submit',async function(e){
e.preventDefault();var err=document.getElementById('err');err.textContent='';
try{var res=await fetch('/api/rainbow/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:document.getElementById('u').value.trim(),password:document.getElementById('p').value})});
var j=await res.json();if(res.ok&&j.authenticated){location.reload();}else{err.textContent=j.error||'Login failed';}}
catch(ex){err.textContent='Network error';}});
</script></body></html>`))
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// ctxSessionKey carries the authenticated *Session (nil for raw-key auth).
type ctxKey int

const ctxSessionKey ctxKey = 0

// sessionFrom returns the scoped session on the request, or nil (raw admin key
// or unrestricted session).
func sessionFrom(r *http.Request) *Session {
	s, _ := r.Context().Value(ctxSessionKey).(*Session)
	return s
}

// scopedBlocked lists endpoints a tenant-scoped session must NOT mutate or
// read: global operator phone books and cross-profile test harnesses.
func scopedBlocked(path, method string) bool {
	if strings.HasPrefix(path, "/api/rainbow/admin-notifications") {
		return method != http.MethodGet
	}
	switch path {
	case "/api/rainbow/tests/run", "/api/rainbow/testing/run-all":
		return true
	}
	return false
}

// credential extracts the caller's credential: X-Admin-Key header first, then
// the session cookie (browser page loads carry only the cookie).
func (h *Handler) credential(r *http.Request) string {
	if v := r.Header.Get("X-Admin-Key"); v != "" {
		return v
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		return c.Value
	}
	return ""
}

// auth enforces the admin credential when an admin key is configured. Accepted:
//   - the raw RAINBOW_ADMIN_KEY (full access, legacy behaviour), or
//   - a signed session token from /api/rainbow/auth/login.
//
// Tenant-scoped sessions (allowed_tenants set on the admin_users row) are
// confined server-side: a missing x-profile-id is rewritten to the first
// allowed tenant, a disallowed one is rejected with 403, and global staff
// endpoints are blocked. This is what keeps a client login (e.g. dental-world)
// out of the other businesses' data.
func (h *Handler) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.adminKey == "" {
			next(w, r)
			return
		}
		cred := h.credential(r)
		if cred == h.adminKey {
			next(w, r)
			return
		}
		sess := verifySession(h.adminKey, cred)
		if sess == nil {
			writeJSON(w, 401, map[string]any{"error": "unauthorized"})
			return
		}
		if sess.Scoped() {
			if scopedBlocked(r.URL.Path, r.Method) {
				writeJSON(w, 403, map[string]any{"error": "forbidden: not authorized for this endpoint"})
				return
			}
			p := strings.ToLower(strings.TrimSpace(r.Header.Get("x-profile-id")))
			if p == "" {
				r.Header.Set("x-profile-id", sess.Tenants[0])
			} else if !sess.Allows(p) {
				writeJSON(w, 403, map[string]any{"error": "forbidden: not authorized for this tenant", "tenantId": p})
				return
			}
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxSessionKey, sess)))
	}
}

// settingsFile is the subset of src/assistant/data/settings.json the dashboard needs.
type settingsFile struct {
	AI struct {
		Providers []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Type      string `json:"type"`
			Priority  int    `json:"priority"`
			Enabled   bool   `json:"enabled"`
			APIKey    string `json:"api_key"`
			APIKeyEnv string `json:"api_key_env"`
			BaseURL   string `json:"base_url"`
		} `json:"providers"`
	} `json:"ai"`
	ResponseModes map[string]any `json:"response_modes"`
}

// loadSettingsFile reads settings.json from the data dir (best-effort; returns
// a zero value if absent so /status still renders).
func (h *Handler) loadSettingsFile() settingsFile {
	var s settingsFile
	if h.dataDir == "" {
		return s
	}
	b, err := os.ReadFile(filepath.Join(h.dataDir, "settings.json"))
	if err != nil {
		return s
	}
	_ = json.Unmarshal(b, &s)
	return s
}

// status ports GET /api/rainbow/status (src/routes/admin/metrics.ts:26). This is
// the ONLY fatally-awaited call on the dashboard tab, so it must return 200 with
// the expected shape. go-core has no Baileys manager, so whatsappInstances is
// empty (the SPA renders a graceful "no instances" state); AI providers come from
// settings.json in the data dir.
func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	s := h.loadSettingsFile()
	lastChecked := time.Now().UTC().Format(time.RFC3339)

	providers := make([]map[string]any, 0, len(s.AI.Providers))
	anyAvailable := false
	for _, p := range s.AI.Providers {
		hasKey := p.Type == "ollama" || p.APIKey != "" || (p.APIKeyEnv != "" && os.Getenv(p.APIKeyEnv) != "")
		if hasKey {
			anyAvailable = true
		}
		status := "not_configured"
		details := "No API key"
		if hasKey {
			status = "configured"
			switch {
			case p.APIKeyEnv != "":
				details = p.APIKeyEnv + " set"
			case p.Type == "ollama":
				details = p.BaseURL
			default:
				details = "API key stored"
			}
		} else if p.APIKeyEnv != "" {
			details = p.APIKeyEnv + " not set"
		}
		providers = append(providers, map[string]any{
			"id": p.ID, "name": p.Name, "type": p.Type, "priority": p.Priority,
			"enabled": p.Enabled, "available": hasKey, "status": status, "details": details,
		})
	}

	respModes := s.ResponseModes
	if respModes == nil {
		respModes = map[string]any{"default_mode": "autopilot"}
	}

	port := 3003
	if v, err := strconv.Atoi(os.Getenv("CORE_PORT")); err == nil && v > 0 {
		port = v
	}
	// Per-profile override: x-profile-id header → RAINBOW_WA_NUMBER_<PROFILE>
	// and BUSINESS_DISPLAY_NAME_<PROFILE> take precedence over global vars.
	profileHeader := r.Header.Get("x-profile-id")
	waNumberEnvKey := "RAINBOW_WA_NUMBER"
	displayNameEnvKey := "BUSINESS_DISPLAY_NAME"
	if profileHeader != "" {
		suffix := strings.ToUpper(strings.ReplaceAll(profileHeader, "-", "_"))
		if v := os.Getenv("RAINBOW_WA_NUMBER_" + suffix); v != "" {
			waNumberEnvKey = "RAINBOW_WA_NUMBER_" + suffix
		}
		if v := os.Getenv("BUSINESS_DISPLAY_NAME_" + suffix); v != "" {
			displayNameEnvKey = "BUSINESS_DISPLAY_NAME_" + suffix
		}
	}

	propertyName := os.Getenv(displayNameEnvKey)
	if propertyName == "" {
		propertyName = os.Getenv("BUSINESS_NAME")
	}

	// Live WhatsApp state from the bridge (the Baileys session owner). The
	// bridge /health reports connState ("open" = paired and connected); the
	// bot number is not exposed there, so it comes from RAINBOW_WA_NUMBER.

	waStatus := map[string]any{"state": "unknown", "user": nil}
	waInstances := []any{}
	if h.bridgeURL != "" {
		bctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if req, err := http.NewRequestWithContext(bctx, http.MethodGet, h.bridgeURL+"/health", nil); err == nil {
			if resp, err := http.DefaultClient.Do(req); err == nil {
				defer resp.Body.Close()
				var hb struct {
					Whatsapp   string `json:"whatsapp"`
					InstanceID string `json:"instanceId"`
				}
				if json.NewDecoder(resp.Body).Decode(&hb) == nil && hb.Whatsapp != "" {
					// The SPA reads user.phone / user.name (renderInstanceCard),
					// so user must be an object, not a bare string.
					// Display name comes only from BUSINESS_DISPLAY_NAME
					// (BUSINESS_NAME on the VPS is a stale Node-era value
					// for a different business).
					displayName := os.Getenv(displayNameEnvKey)
					var user any
					if n := os.Getenv(waNumberEnvKey); n != "" {
						user = map[string]any{"phone": n, "name": displayName}
					}
					label := hb.InstanceID
					if displayName != "" {
						label = displayName
					}
					waStatus = map[string]any{"state": hb.Whatsapp, "user": user}
					waInstances = []any{map[string]any{
						"id": hb.InstanceID, "label": label, "state": hb.Whatsapp,
						"user": user, "unlinkedFromWhatsApp": false,
					}}
				}
			}
		}
	}

	aiBlock := map[string]any{"available": anyAvailable, "providers": providers}
	if h.activeModels != nil {
		classifyModel, replyModel := h.activeModels()
		aiBlock["classifyModel"] = classifyModel
		aiBlock["replyModel"] = replyModel
	}

	writeJSON(w, 200, map[string]any{
		"servers": map[string]any{
			"mcp": map[string]any{
				"name":          "Rainbow AI",
				"description":   "WhatsApp AI assistant + Admin Dashboard (go-core)",
				"port":          port,
				"online":        true,
				"responseTime":  0,
				"lastCheckedAt": lastChecked,
			},
		},
		"whatsapp":          waStatus,
		"whatsappInstances": waInstances,
		"ai":                aiBlock,
		"config_files":      []string{"knowledge", "intents", "templates", "settings", "workflow", "workflows", "routing"},
		"response_modes":    respModes,
		"isCloud":           os.Getenv("RAINBOW_ROLE") == "primary",
		"propertyName":      propertyName,
	})
}

// stats is profile-scoped: each business sees only its own volume. Counts
// derive from rainbow_messages (the same source as the conversation list) so
// the numbers always match what the live-chat tab shows.
func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	cond, carg := h.profCond("m", profileID)
	var convos, msgs, today int
	h.st.DB.QueryRow(`SELECT COUNT(DISTINCT m.phone) FROM rainbow_messages m
		WHERE (m.deleted_at IS NULL OR m.deleted_at='') AND `+cond, carg).Scan(&convos)
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages m
		WHERE (m.deleted_at IS NULL OR m.deleted_at='') AND `+cond, carg).Scan(&msgs)
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages m
		WHERE CAST(m.timestamp AS TEXT) >= ? AND `+cond,
		store.NowISO()[:10], carg).Scan(&today)
	writeJSON(w, 200, map[string]any{
		"conversations": convos, "messages": msgs, "messagesToday": today,
	})
}

func titleProfile(id string) string {
	if id == "" {
		return id
	}
	return strings.ToUpper(id[:1]) + id[1:]
}

// profiles ports GET /api/rainbow/profiles (src/routes/admin/profiles.ts) — the
// profile switcher fetches this on every tab. Built from the hub's served ids.
func (h *Handler) profiles(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	ids := h.profileIDs
	def := h.defaultProfile
	if sess.Scoped() {
		// Scoped users see only their tenants; their first tenant acts as the
		// default so the SPA lands on it instead of the global default profile.
		ids = nil
		for _, id := range h.profileIDs {
			if sess.Allows(id) {
				ids = append(ids, id)
			}
		}
		if len(ids) > 0 {
			def = ids[0]
		}
	}
	list := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		list = append(list, map[string]any{
			"id": id, "name": titleProfile(id), "enabled": true,
			"instanceIds": []string{}, "kbDir": "", "dataDir": "",
			"whatsappInstanceId": "", "siteUrl": "",
		})
	}
	writeJSON(w, 200, map[string]any{"profiles": list, "defaultProfileId": def})
}

// profilesActive ports GET /api/rainbow/profiles/active.
func (h *Handler) profilesActive(w http.ResponseWriter, r *http.Request) {
	id := h.defaultProfile
	if sess := sessionFrom(r); sess.Scoped() {
		id = sess.Tenants[0]
	}
	if id == "" && len(h.profileIDs) > 0 {
		id = h.profileIDs[0]
	}
	writeJSON(w, 200, map[string]any{
		"id": id, "name": titleProfile(id), "instanceIds": []string{},
		"kbDir": "", "dataDir": "", "enabled": true, "isDefault": true,
		"whatsappInstanceId": "",
	})
}

// templateHTML ports GET /api/rainbow/templates/{name} — each dashboard tab's
// body HTML is loaded from src/public/templates/tabs/{name}.html.
// templatesItem multiplexes /api/rainbow/templates/<name>: GET serves the SPA
// tab HTML (legacy behavior), PUT/DELETE edit the requesting profile's system
// message templates file (templates.json or its -<profile> variant).
func (h *Handler) templatesItem(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		h.templateHTML(w, r)
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/api/rainbow/templates/")
	if key == "" || strings.ContainsAny(key, `/\`) || strings.Contains(key, "..") {
		writeJSON(w, 400, map[string]any{"error": "bad template key"})
		return
	}
	if _, err := h.reqProfile(r); err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	doc := map[string]any{}
	h.readDataJSONReq(r, "templates.json", &doc)
	switch r.Method {
	case http.MethodPut:
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad json"})
			return
		}
		doc[key] = body
	case http.MethodDelete:
		delete(doc, key)
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if err := h.writeDataJSONReq(r, "templates.json", doc); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (h *Handler) templateHTML(w http.ResponseWriter, r *http.Request) {
	if h.publicDir == "" {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/rainbow/templates/")
	if name == "" || strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(filepath.Join(h.publicDir, "templates", "tabs", name+".html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(b)
}

// feedbackStats returns an empty-but-valid feedback stats shape (go-core has no
// Postgres rainbow_feedback table). overall.totalFeedback=0 makes the SPA render
// the graceful empty state, not an error toast.
func (h *Handler) feedbackStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"success": true,
		"stats": map[string]any{
			"overall": map[string]any{
				"totalFeedback": 0, "thumbsUp": 0, "thumbsDown": 0,
				"avgConfidence": 0, "avgResponseTime": 0, "satisfactionRate": 0,
			},
			"byIntent": []any{}, "byTier": []any{}, "dailyTrend": []any{},
		},
	})
}

// intentAccuracy returns an empty-but-valid intent-accuracy shape (go-core has no
// Postgres intentPredictions table). overall.total=0 makes the SPA render the
// graceful empty state, not an error toast.
func (h *Handler) intentAccuracy(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"success": true,
		"accuracy": map[string]any{
			"overall": map[string]any{
				"total": 0, "correct": 0, "incorrect": 0,
				"unvalidated": 0, "avgConfidence": 0, "accuracyRate": 0,
			},
			"byIntent": []any{}, "byTier": []any{}, "byModel": []any{},
		},
	})
}

// settings serves the structured settings.json directly (matching Node's
// getStore().getSettings()), which the Settings/Intents/Live-Chat tabs read at
// the top level (ai, staff, response_modes, …). Serving the file — not the flat
// app_settings KV — is what the SPA expects.
func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	h.serveJSONFile(w, r, "settings.json")
}

// adminNotifications ports GET /api/rainbow/admin-notifications
// (src/lib/admin-notification-settings.ts loadAdminNotificationSettings), built
// from the app_settings rainbow_* keys with the same defaults as the Node app.
func (h *Handler) adminNotifications(w http.ResponseWriter, r *http.Request) {
	// Tenant-scoped sessions get an empty shape: the operator phone book is
	// global staff data, not theirs to read.
	if sessionFrom(r).Scoped() {
		writeJSON(w, 200, map[string]any{
			"enabled": false, "systemAdminPhone": "", "notifyOnDisconnect": false,
			"notifyOnUnlink": false, "notifyOnReconnect": false,
			"operators": []any{}, "defaultFallbackMinutes": 5,
		})
		return
	}
	kv := map[string]string{}
	if rows, err := h.st.DB.Query(`SELECT key, value FROM app_settings WHERE key LIKE 'rainbow_%'`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var k, v string
			if rows.Scan(&k, &v) == nil {
				kv[k] = v
			}
		}
		if err := rows.Err(); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
	}
	boolOf := func(key string, def bool) bool {
		if v, ok := kv[key]; ok {
			return v == "true"
		}
		return def
	}
	strOf := func(key, def string) string {
		if v, ok := kv[key]; ok && v != "" {
			return v
		}
		return def
	}
	intOf := func(key string, def int) int {
		if v, ok := kv[key]; ok {
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
		}
		return def
	}
	type operator struct {
		Phone           string `json:"phone"`
		Label           string `json:"label"`
		Name            string `json:"name"`
		FallbackMinutes int    `json:"fallbackMinutes"`
	}
	operators := []operator{}
	if raw, ok := kv["rainbow_operators"]; ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), &operators)
	}
	if len(operators) == 0 {
		operators = []operator{
			{Phone: "60167620815", Label: "Operator 1 (Primary)", Name: "Alston", FallbackMinutes: 5},
			{Phone: "60127088789", Label: "Operator 2 (Fallback)", Name: "Jay", FallbackMinutes: 10},
			{Phone: "60176701102", Label: "Operator 3 (On-site)", Name: "Maya", FallbackMinutes: 15},
		}
	}
	writeJSON(w, 200, map[string]any{
		"enabled":                boolOf("rainbow_admin_notifications_enabled", true),
		"systemAdminPhone":       strOf("rainbow_system_admin_phone", "60127088789"),
		"notifyOnDisconnect":     boolOf("rainbow_admin_notify_disconnect", true),
		"notifyOnUnlink":         boolOf("rainbow_admin_notify_unlink", true),
		"notifyOnReconnect":      boolOf("rainbow_admin_notify_reconnect", true),
		"operators":              operators,
		"defaultFallbackMinutes": intOf("rainbow_default_fallback_minutes", 5),
	})
}

// adminNotificationsOperators handles PUT /api/rainbow/admin-notifications/operators.
func (h *Handler) adminNotificationsOperators(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	var body struct {
		Operators json.RawMessage `json:"operators"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON"})
		return
	}
	upsert := `INSERT INTO app_settings(id,key,value,updated_at)
	           VALUES(lower(hex(randomblob(16))),?,?,unixepoch())
	           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
	if _, err := h.st.DB.Exec(upsert, "rainbow_operators", string(body.Operators)); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// adminNotificationsPreferences handles PUT /api/rainbow/admin-notifications/preferences.
func (h *Handler) adminNotificationsPreferences(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	var body struct {
		Enabled          *bool `json:"enabled"`
		NotifyDisconnect *bool `json:"notifyDisconnect"`
		NotifyUnlink     *bool `json:"notifyUnlink"`
		NotifyReconnect  *bool `json:"notifyReconnect"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON"})
		return
	}
	upsert := `INSERT INTO app_settings(id,key,value,updated_at)
	           VALUES(lower(hex(randomblob(16))),?,?,unixepoch())
	           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
	set := func(key string, val *bool) {
		if val != nil {
			v := "false"
			if *val {
				v = "true"
			}
			h.st.DB.Exec(upsert, key, v)
		}
	}
	set("rainbow_admin_notifications_enabled", body.Enabled)
	set("rainbow_admin_notify_disconnect", body.NotifyDisconnect)
	set("rainbow_admin_notify_unlink", body.NotifyUnlink)
	set("rainbow_admin_notify_reconnect", body.NotifyReconnect)
	writeJSON(w, 200, map[string]any{"ok": true})
}

// adminNotificationsSystemPhone handles PUT /api/rainbow/admin-notifications/system-admin-phone.
func (h *Handler) adminNotificationsSystemPhone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	var body struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Phone == "" {
		writeJSON(w, 400, map[string]any{"error": "phone required"})
		return
	}
	upsert := `INSERT INTO app_settings(id,key,value,updated_at)
	           VALUES(lower(hex(randomblob(16))),?,?,unixepoch())
	           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
	if _, err := h.st.DB.Exec(upsert, "rainbow_system_admin_phone", body.Phone); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// activityStream serves GET /api/rainbow/activity/stream as a Server-Sent
// Events endpoint. go-core does not yet push live activity events, so it sends
// an empty init payload and then heartbeat comments every 25 s to keep the
// connection alive. The SPA's EventSource shows "connected" (green dot) once
// the init event arrives, and stops showing "Reconnecting...".
func (h *Handler) activityStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, 500, map[string]any{"error": "streaming not supported"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx/Caddy proxy buffering
	w.WriteHeader(http.StatusOK)

	// Send initial batch (empty) so the SPA's 'init' listener fires immediately.
	fmt.Fprintf(w, "event: init\ndata: {\"activities\":[]}\n\n")
	flusher.Flush()

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
