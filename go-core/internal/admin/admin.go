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
	"strconv"
	"strings"
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
	staffNameCol int              // rainbow_messages staff_name column: 0 unknown, 1 yes, -1 no
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
	h.serveJSONFile(w, "routing.json")
}

// serveJSONFile streams a config JSON file from the data dir.
func (h *Handler) serveJSONFile(w http.ResponseWriter, name string) {
	if h.dataDir == "" {
		writeJSON(w, 404, map[string]any{"error": "no data dir"})
		return
	}
	b, err := os.ReadFile(filepath.Join(h.dataDir, name))
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
	mux.HandleFunc("/api/rainbow/intents", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "intents.json") }))
	mux.HandleFunc("/api/rainbow/knowledge", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "knowledge.json") }))
	mux.HandleFunc("/api/rainbow/templates", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "templates.json") }))
	mux.HandleFunc("/api/rainbow/workflows", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "workflows.json") }))
	mux.HandleFunc("/api/rainbow/workflow", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "workflow.json") }))
	mux.HandleFunc("/api/rainbow/intent-manager/keywords", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "intent-keywords.json") }))
	mux.HandleFunc("/api/rainbow/intent-manager/examples", h.auth(func(w http.ResponseWriter, r *http.Request) { h.serveJSONFile(w, "intent-examples.json") }))

	// Understanding tab (t2 stats, t3 tiers, t4 LLM settings/system prompt).
	mux.HandleFunc("/api/rainbow/intent-manager/stats", h.auth(h.imStats))
	mux.HandleFunc("/api/rainbow/intent-manager/tiers", h.auth(h.imTiers))
	mux.HandleFunc("/api/rainbow/intent-manager/llm-settings", h.auth(h.imLLMSettings))
	mux.HandleFunc("/api/rainbow/intent-manager/llm-settings/available-providers", h.auth(h.imAvailableProviders))
	mux.HandleFunc("/api/rainbow/intent-manager/system-prompt", h.auth(h.imSystemPrompt))

	// Responses tab: quick-reply draft generation (LLM-backed).
	mux.HandleFunc("/api/rainbow/knowledge/generate-draft", h.auth(h.generateDraft))

	// Testing tab: Go-native check suites in the vitest JSON shape.
	mux.HandleFunc("/api/rainbow/tests/run", h.auth(h.testsRun))
	mux.HandleFunc("/api/rainbow/testing/run-all", h.auth(h.testingRunAll))
	mux.HandleFunc("/api/rainbow/admin-notifications", h.auth(h.adminNotifications))

	// Profile switcher (called on every tab) + per-tab HTML template loader — both
	// are fatal for the SPA: the switcher runs globally, and each tab's body HTML
	// is fetched from /templates/{name}.
	mux.HandleFunc("/api/rainbow/profiles", h.auth(h.profiles))
	mux.HandleFunc("/api/rainbow/profiles/active", h.auth(h.profilesActive))
	mux.HandleFunc("/api/rainbow/templates/", h.auth(h.templateHTML))

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

// spa serves the admin SPA HTML with the admin key + a fetch interceptor injected
// (mirrors the monolith), so the SPA's /api/rainbow/* calls are authenticated.
func (h *Handler) spa(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && !contains(dashboardTabs, strings.TrimPrefix(r.URL.Path, "/")) {
		http.NotFound(w, r)
		return
	}
	raw, err := os.ReadFile(filepath.Join(h.publicDir, "rainbow-admin.html"))
	if err != nil {
		http.Error(w, "dashboard not found", 500)
		return
	}
	html := string(raw)
	html = strings.ReplaceAll(html, "__CSP_NONCE__", "")
	inject := `<script>window.__ADMIN_KEY__=` + jsonString(h.adminKey) + `;
(function(){var _f=window.fetch;window.fetch=function(u,o){o=o||{};if(typeof u==='string'&&u.indexOf('/api/rainbow/')>=0&&window.__ADMIN_KEY__){var hd=o.headers||{};var has=Object.keys(hd).some(function(k){return k.toLowerCase()==='x-admin-key';});if(!has){o=Object.assign({},o,{headers:Object.assign({'X-Admin-Key':window.__ADMIN_KEY__},hd)});}}return _f.call(this,u,o);};})();
</script>`
	html = strings.Replace(html, "<head>", "<head>\n"+inject, 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(html))
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

// auth enforces X-Admin-Key when an admin key is configured.
func (h *Handler) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.adminKey != "" && r.Header.Get("X-Admin-Key") != h.adminKey {
			writeJSON(w, 401, map[string]any{"error": "unauthorized"})
			return
		}
		next(w, r)
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
	propertyName := os.Getenv("BUSINESS_DISPLAY_NAME")
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
					displayName := os.Getenv("BUSINESS_DISPLAY_NAME")
					var user any
					if n := os.Getenv("RAINBOW_WA_NUMBER"); n != "" {
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
				resp.Body.Close()
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

func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	var convos, msgs, today int
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_conversations WHERE deleted_at IS NULL OR deleted_at=''`).Scan(&convos)
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE deleted_at IS NULL OR deleted_at=''`).Scan(&msgs)
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE CAST(timestamp AS TEXT) >= ?`,
		store.NowISO()[:10]).Scan(&today)
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
	list := make([]map[string]any, 0, len(h.profileIDs))
	for _, id := range h.profileIDs {
		list = append(list, map[string]any{
			"id": id, "name": titleProfile(id), "enabled": true,
			"instanceIds": []string{}, "kbDir": "", "dataDir": "",
			"whatsappInstanceId": "", "siteUrl": "",
		})
	}
	writeJSON(w, 200, map[string]any{"profiles": list, "defaultProfileId": h.defaultProfile})
}

// profilesActive ports GET /api/rainbow/profiles/active.
func (h *Handler) profilesActive(w http.ResponseWriter, r *http.Request) {
	id := h.defaultProfile
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
	h.serveJSONFile(w, "settings.json")
}

// adminNotifications ports GET /api/rainbow/admin-notifications
// (src/lib/admin-notification-settings.ts loadAdminNotificationSettings), built
// from the app_settings rainbow_* keys with the same defaults as the Node app.
func (h *Handler) adminNotifications(w http.ResponseWriter, r *http.Request) {
	kv := map[string]string{}
	if rows, err := h.st.DB.Query(`SELECT key, value FROM app_settings WHERE key LIKE 'rainbow_%'`); err == nil {
		defer rows.Close()
		for rows.Next() {
			var k, v string
			if rows.Scan(&k, &v) == nil {
				kv[k] = v
			}
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
		FallbackMinutes int    `json:"fallbackMinutes"`
	}
	operators := []operator{}
	if raw, ok := kv["rainbow_operators"]; ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), &operators)
	}
	if len(operators) == 0 {
		operators = []operator{
			{Phone: "60167620815", Label: "Operator 1 (Primary)", FallbackMinutes: 5},
			{Phone: "60127088789", Label: "Operator 2 (Fallback)", FallbackMinutes: 10},
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
