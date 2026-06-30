// Package admin serves the Rainbow admin API (/api/rainbow/*) from the shared
// SQLite DB. This is the Go port of the most-used read endpoints in
// src/routes/admin/* (conversations, messages, stats, settings). The full Node
// admin API is large (~40 sub-routers) and non-leaky, so it can stay on Node
// during a phased cutover; this covers the dashboard's core read views.
package admin

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"rainbow-core/internal/store"
)

// Handler wires the admin endpoints onto a mux.
type Handler struct {
	st        *store.Store
	adminKey  string
	publicDir string // src/public (SPA + assets); empty = don't serve the UI
	dataDir   string // src/assistant/data (config JSON for read endpoints)
}

func New(st *store.Store, adminKey, publicDir, dataDir string) *Handler {
	return &Handler{st: st, adminKey: adminKey, publicDir: publicDir, dataDir: dataDir}
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
	mux.HandleFunc("/api/rainbow/stats", h.auth(h.stats))
	mux.HandleFunc("/api/rainbow/conversations", h.auth(h.conversations))
	mux.HandleFunc("/api/rainbow/settings", h.auth(h.settings))
	mux.HandleFunc("/api/rainbow/routing", h.auth(h.routing))
	mux.HandleFunc("/api/rainbow/conversations/", h.auth(h.conversationMessages))

	// ── Dashboard SPA + static assets ──
	if h.publicDir != "" {
		fs := http.FileServer(http.Dir(h.publicDir))
		mux.Handle("/public/", http.StripPrefix("/public/", fs))
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

type convRow struct {
	Phone       string `json:"phone"`
	PushName    string `json:"pushName"`
	ProfileID   string `json:"profileId"`
	Status      string `json:"status"`
	UpdatedAt   string `json:"updatedAt"`
	LastMessage string `json:"lastMessage"`
}

func (h *Handler) conversations(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)
	rows, err := h.st.DB.Query(`
		SELECT c.phone, COALESCE(c.push_name,''), COALESCE(c.profile_id,'pelangi'), COALESCE(c.status,'active'),
		       COALESCE(CAST(c.updated_at AS TEXT),''),
		       COALESCE((SELECT m.content FROM rainbow_messages m WHERE m.phone=c.phone ORDER BY CAST(m.timestamp AS TEXT) DESC LIMIT 1),'')
		FROM rainbow_conversations c
		WHERE c.deleted_at IS NULL OR c.deleted_at=''
		ORDER BY CAST(c.updated_at AS TEXT) DESC LIMIT ?`, limit)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := []convRow{}
	for rows.Next() {
		var c convRow
		if err := rows.Scan(&c.Phone, &c.PushName, &c.ProfileID, &c.Status, &c.UpdatedAt, &c.LastMessage); err != nil {
			continue
		}
		if len(c.LastMessage) > 120 {
			c.LastMessage = c.LastMessage[:120]
		}
		out = append(out, c)
	}
	writeJSON(w, 200, map[string]any{"conversations": out, "count": len(out)})
}

type msgRow struct {
	Role       string  `json:"role"`
	Content    string  `json:"content"`
	Timestamp  string  `json:"timestamp"`
	Intent     string  `json:"intent,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
	Source     string  `json:"source,omitempty"`
}

func (h *Handler) conversationMessages(w http.ResponseWriter, r *http.Request) {
	// path: /api/rainbow/conversations/{phone}/messages
	rest := strings.TrimPrefix(r.URL.Path, "/api/rainbow/conversations/")
	parts := strings.Split(rest, "/")
	if len(parts) < 2 || parts[1] != "messages" || parts[0] == "" {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	phone := parts[0]
	limit := queryInt(r, "limit", 100)
	rows, err := h.st.DB.Query(`
		SELECT role, content, COALESCE(CAST(timestamp AS TEXT),''), COALESCE(intent,''), COALESCE(confidence,0), COALESCE(source,'')
		FROM rainbow_messages WHERE phone=? AND (deleted_at IS NULL OR deleted_at='')
		ORDER BY CAST(timestamp AS TEXT) DESC LIMIT ?`, phone, limit)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := []msgRow{}
	for rows.Next() {
		var m msgRow
		if err := rows.Scan(&m.Role, &m.Content, &m.Timestamp, &m.Intent, &m.Confidence, &m.Source); err != nil {
			continue
		}
		out = append(out, m)
	}
	// reverse to chronological
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	writeJSON(w, 200, map[string]any{"phone": phone, "messages": out, "count": len(out)})
}

func (h *Handler) settings(w http.ResponseWriter, r *http.Request) {
	rows, err := h.st.DB.Query(`SELECT key, value FROM app_settings ORDER BY key`)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			out[k] = v
		}
	}
	writeJSON(w, 200, map[string]any{"settings": out})
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
