// Package admin serves the Rainbow admin API (/api/rainbow/*) from the shared
// SQLite DB. This is the Go port of the most-used read endpoints in
// src/routes/admin/* (conversations, messages, stats, settings). The full Node
// admin API is large (~40 sub-routers) and non-leaky, so it can stay on Node
// during a phased cutover; this covers the dashboard's core read views.
package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"rainbow-core/internal/store"
)

// Handler wires the admin endpoints onto a mux.
type Handler struct {
	st       *store.Store
	adminKey string
}

func New(st *store.Store, adminKey string) *Handler {
	return &Handler{st: st, adminKey: adminKey}
}

// Register mounts the admin routes under /api/rainbow on the given mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/rainbow/stats", h.auth(h.stats))
	mux.HandleFunc("/api/rainbow/conversations", h.auth(h.conversations))
	mux.HandleFunc("/api/rainbow/settings", h.auth(h.settings))
	// /api/rainbow/conversations/{phone}/messages
	mux.HandleFunc("/api/rainbow/conversations/", h.auth(h.conversationMessages))
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
