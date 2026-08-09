package admin

// Conversation + webchat admin endpoints: /conversations (raw array for the
// SPA), /conversations/unified, per-phone logs, and the /webchat session
// family. Extracted from admin.go 2026-07-21 (cohesion split).

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// conversations serves GET /api/rainbow/conversations — the live-chat and
// real-chat tabs consume this as a RAW ARRAY ($.conversations = results[0];
// $.conversations.filter(...)), matching the Node original. Same rows as
// /conversations/unified.
func (h *Handler) conversations(w http.ResponseWriter, r *http.Request) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	list, err := h.queryUnified(queryInt(r, "limit", 200), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, list)
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
	// paths: /api/rainbow/conversations/{phone}            → full chat log (SPA live-chat)
	//        /api/rainbow/conversations/{phone}/read       → mark-read no-op
	//        /api/rainbow/conversations/{phone}/send       → staff WhatsApp send (bridge)
	//        /api/rainbow/conversations/{phone}/messages   → raw message list
	rest := strings.TrimPrefix(r.URL.Path, "/api/rainbow/conversations/")
	parts := strings.Split(rest, "/")
	if len(parts) == 1 && parts[0] != "" {
		h.conversationLog(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "send" && r.Method == http.MethodPost {
		h.conversationSend(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "mode" && r.Method == http.MethodPost {
		h.conversationMode(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "read" {
		// No unread tracking in go-core (unreadCount is always 0) — ack so the
		// SPA's PATCH .../read succeeds.
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if len(parts) < 2 || parts[1] != "messages" || parts[0] == "" {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	phone := parts[0]
	limit := queryInt(r, "limit", 100)
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	cond, carg := h.profCond("m", profileID)
	rows, err := h.st.DB.Query(`
		SELECT role, content, COALESCE(CAST(timestamp AS TEXT),''), COALESCE(intent,''), COALESCE(confidence,0), COALESCE(source,'')
		FROM rainbow_messages m WHERE m.phone=? AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond+`
		ORDER BY CAST(m.timestamp AS TEXT) DESC LIMIT ?`, phone, carg, limit)
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
	if err := rows.Err(); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	// reverse to chronological
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	writeJSON(w, 200, map[string]any{"phone": phone, "messages": out, "count": len(out)})
}

// ── Live-chat unified + webchat endpoints ──
//
// The SPA's live-chat tab (js/modules/live-chat-core.js) polls
// /conversations/unified and opens /conversations/{phone}; the webchat sub-tab
// (js/modules/webchat-admin.js) polls /webchat/conversations and drills into
// /webchat/conversations/{sessionId} (+ sessions-merged for same-IP groups).
// Webchat rows in rainbow_messages carry phone "web:<sessionId>" (Go era) or
// "webchat-<sessionId>" (Node era); everything else is WhatsApp.

// profCond returns the SQL predicate + bind arg scoping alias's rainbow_messages
// rows to profile p. "" means the default profile, which also owns legacy rows
// written before profile_id existed (NULL/''). Non-default profiles match
// strictly — legacy rows must never leak into another business's views.
func (h *Handler) profCond(alias, p string) (string, string) {
	if p == "" {
		def := h.defaultProfile
		if def == "" {
			def = "pelangi"
		}
		return "(" + alias + ".profile_id IS NULL OR " + alias + ".profile_id='' OR " + alias + ".profile_id=?)", def
	}
	return alias + ".profile_id=?", p
}

// webchatSession returns the sessionId and true when phone is a webchat row.
func webchatSession(phone string) (string, bool) {
	if s, ok := strings.CutPrefix(phone, "web:"); ok {
		return s, true
	}
	if s, ok := strings.CutPrefix(phone, "webchat-"); ok {
		return s, true
	}
	return "", false
}

// tsToMillis converts a stored timestamp (ISO-8601 TEXT, or a legacy numeric
// epoch in seconds/millis) to epoch milliseconds. The SPA sorts and diffs
// lastMessageAt numerically, so it must be a number in JSON.
func tsToMillis(ts string) int64 {
	if ts == "" {
		return 0
	}
	if n, err := strconv.ParseFloat(ts, 64); err == nil {
		if n > 1e12 {
			return int64(n)
		}
		return int64(n * 1000)
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, ts); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

// tsToISO normalises a stored timestamp to ISO-8601 for message rows (the SPA
// feeds msg.timestamp to new Date()).
func tsToISO(ts string) string {
	if ts == "" {
		return ""
	}
	if ms := tsToMillis(ts); ms > 0 {
		if _, err := strconv.ParseFloat(ts, 64); err == nil {
			return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	return ts
}

// defaultResponseMode reads response_modes.default_mode from settings.json.
func (h *Handler) defaultResponseMode() string {
	if rm := h.loadSettingsFile().ResponseModes; rm != nil {
		if v, ok := rm["default_mode"].(string); ok && v != "" {
			return v
		}
	}
	return "autopilot"
}

type unifiedRow struct {
	Phone           string `json:"phone"`
	Channel         string `json:"channel"`
	SessionID       string `json:"sessionId,omitempty"`
	InstanceID      string `json:"instanceId,omitempty"`
	PushName        string `json:"pushName"`
	LastMessage     string `json:"lastMessage"`
	LastMessageAt   int64  `json:"lastMessageAt"`
	LastMessageRole string `json:"lastMessageRole"`
	UnreadCount     int    `json:"unreadCount"`
	MessageCount    int    `json:"messageCount"`
	Favourite       bool   `json:"favourite"`
	Pinned          bool   `json:"pinned"`
}

// queryUnified derives the conversation list from rainbow_messages (same
// GROUP BY as conversations()) plus last-message role, tagged per channel.
// profileID filters to a specific business profile (x-profile-id header value);
// an empty string returns all profiles (admin/unscoped access).
func (h *Handler) queryUnified(limit int, profileID string) ([]unifiedRow, error) {
	// One query, profile-scoped per alias. "" = default profile (owns legacy
	// NULL/'' rows); non-default profiles match strictly — the old else-branch
	// served EVERY profile's conversations to the default view.
	c1, a1 := h.profCond("m2", profileID)
	c2, a2 := h.profCond("m3", profileID)
	c3, a3 := h.profCond("m4", profileID)
	c4, a4 := h.profCond("m", profileID)
	rows, err := h.st.DB.Query(`
		SELECT m.phone,
		       COALESCE(s.push_name, c.push_name, ''),
		       COALESCE(MAX(CAST(m.timestamp AS TEXT)), ''),
		       COALESCE((SELECT m2.content FROM rainbow_messages m2
		                 WHERE m2.phone = m.phone AND (m2.deleted_at IS NULL OR m2.deleted_at='')
		                 AND `+c1+`
		                 ORDER BY CAST(m2.timestamp AS TEXT) DESC LIMIT 1), ''),
		       COALESCE((SELECT m3.role FROM rainbow_messages m3
		                 WHERE m3.phone = m.phone AND (m3.deleted_at IS NULL OR m3.deleted_at='')
		                 AND `+c2+`
		                 ORDER BY CAST(m3.timestamp AS TEXT) DESC LIMIT 1), ''),
		       (SELECT COUNT(*) FROM rainbow_messages m4
		        WHERE m4.phone = m.phone AND (m4.deleted_at IS NULL OR m4.deleted_at='')
		        AND `+c3+`)
		FROM rainbow_messages m
		LEFT JOIN rainbow_conversation_state s ON s.phone = m.phone
		LEFT JOIN rainbow_conversations c ON c.phone = m.phone
		WHERE (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+c4+`
		GROUP BY m.phone
		ORDER BY MAX(CAST(m.timestamp AS TEXT)) DESC LIMIT ?`,
		a1, a2, a3, a4, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []unifiedRow{}
	for rows.Next() {
		var phone, pushName, lastTs, lastMsg, lastRole string
		var msgCount int
		if err := rows.Scan(&phone, &pushName, &lastTs, &lastMsg, &lastRole, &msgCount); err != nil {
			continue
		}
		if len(lastMsg) > 120 {
			lastMsg = lastMsg[:120]
		}
		u := unifiedRow{
			Phone: phone, Channel: "whatsapp", PushName: pushName,
			LastMessage: lastMsg, LastMessageAt: tsToMillis(lastTs), LastMessageRole: lastRole,
			MessageCount: msgCount,
		}
		if sid, ok := webchatSession(phone); ok {
			u.Channel = "webchat"
			u.SessionID = sid
			if u.PushName == "" {
				u.PushName = "Web Visitor"
			}
		} else {
			u.InstanceID = "default"
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (h *Handler) unifiedConversations(w http.ResponseWriter, r *http.Request) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	list, err := h.queryUnified(queryInt(r, "limit", 200), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, list) // SPA expects a raw array
}

// logMsg is the message shape the live-chat/webchat transcript views render.
// Timestamp is epoch-ms (number) to match Node's rowToMessage output so that
// pairTracesToMessages can use arithmetic subtraction for matching.
type logMsg struct {
	Role         string  `json:"role"`
	Content      string  `json:"content"`
	Timestamp    int64   `json:"timestamp"`
	SessionID    string  `json:"sessionId,omitempty"`
	Intent       string  `json:"intent,omitempty"`
	Confidence   float64 `json:"confidence,omitempty"`
	Source       string  `json:"source,omitempty"`
	RoutedAction string  `json:"routedAction,omitempty"`
	Model        string  `json:"model,omitempty"`
	ResponseTime int64   `json:"responseTime,omitempty"`
	MessageType  string  `json:"messageType,omitempty"`
}

// fetchLog returns the chronological message log for a set of phones, tagging
// each message with the sessionId derived from its phone (webchat rows).
func (h *Handler) fetchLog(phones []string, limit int, profileID string) ([]logMsg, error) {
	if len(phones) == 0 {
		return []logMsg{}, nil
	}
	ph := make([]string, len(phones))
	args := make([]any, 0, len(phones)+2)
	for i, p := range phones {
		ph[i] = "?"
		args = append(args, p)
	}
	cond, carg := h.profCond("m", profileID)
	args = append(args, carg, limit)
	rows, err := h.st.DB.Query(`
		SELECT m.phone, m.role, m.content, COALESCE(CAST(m.timestamp AS TEXT),''),
		       COALESCE(m.intent,''), COALESCE(m.confidence,0), COALESCE(m.source,''),
		       COALESCE(m.routed_action,''), COALESCE(m.model,''),
		       COALESCE(m.response_time_ms,0), COALESCE(m.message_type,'')
		FROM rainbow_messages m
		WHERE m.phone IN (`+strings.Join(ph, ",")+`) AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond+`
		ORDER BY CAST(m.timestamp AS TEXT) DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []logMsg{}
	for rows.Next() {
		var phone, role, content, ts, intent, source, routedAction, model, messageType string
		var confidence float64
		var responseTime int64
		if err := rows.Scan(&phone, &role, &content, &ts,
			&intent, &confidence, &source, &routedAction, &model, &responseTime, &messageType); err != nil {
			continue
		}
		m := logMsg{
			Role: role, Content: content, Timestamp: tsToMillis(ts),
			Intent: intent, Confidence: confidence, Source: source,
			RoutedAction: routedAction, Model: model, ResponseTime: responseTime,
			MessageType: messageType,
		}
		if sid, ok := webchatSession(phone); ok {
			m.SessionID = sid
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// reverse to chronological ASC
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// pushNameFor looks up the stored push name for a phone (state table first,
// legacy conversations table as fallback).
func (h *Handler) pushNameFor(phone string) string {
	var name string
	h.st.DB.QueryRow(`SELECT COALESCE(push_name,'') FROM rainbow_conversation_state WHERE phone=?`, phone).Scan(&name)
	if name == "" {
		h.st.DB.QueryRow(`SELECT COALESCE(push_name,'') FROM rainbow_conversations WHERE phone=?`, phone).Scan(&name)
	}
	return name
}

// conversationLog serves GET /api/rainbow/conversations/{phone} — the full chat
// log shape the live-chat tab renders (renderChat in live-chat-core.js).
func (h *Handler) conversationLog(w http.ResponseWriter, r *http.Request, phone string) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	msgs, err := h.fetchLog([]string{phone}, queryInt(r, "limit", 500), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{
		"phone": phone, "pushName": h.pushNameFor(phone),
		"messages": msgs, "responseMode": h.defaultResponseMode(),
	})
}

// webchatConversations serves GET /api/rainbow/webchat/conversations — the
// webchat sub-tab sidebar list (raw array).
func (h *Handler) webchatConversations(w http.ResponseWriter, r *http.Request) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	list, err := h.queryUnified(queryInt(r, "limit", 200), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	out := []map[string]any{}
	for _, u := range list {
		if u.Channel != "webchat" {
			continue
		}
		out = append(out, map[string]any{
			"sessionId": u.SessionID, "pushName": u.PushName,
			"lastMessage": u.LastMessage, "lastMessageAt": u.LastMessageAt,
			"unreadCount": 0, "channel": "webchat",
		})
	}
	writeJSON(w, 200, out)
}

// conversationMode handles POST /api/rainbow/conversations/{phone}/mode.
// Persists per-conversation response mode (autopilot/copilot/manual) in
// app_settings; optionally sets the global default.
func (h *Handler) conversationMode(w http.ResponseWriter, r *http.Request, phone string) {
	// Validate phone so it cannot inject arbitrary keys into app_settings.
	for _, c := range phone {
		if !((c >= '0' && c <= '9') || c == '@' || c == '.' || c == '_' || c == '-' || c == ':') {
			writeJSON(w, 400, map[string]any{"error": "invalid phone"})
			return
		}
	}
	var body struct {
		Mode               string `json:"mode"`
		SetAsGlobalDefault bool   `json:"setAsGlobalDefault"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Mode == "" {
		writeJSON(w, 400, map[string]any{"error": "mode required"})
		return
	}
	valid := map[string]bool{"autopilot": true, "copilot": true, "manual": true}
	if !valid[body.Mode] {
		writeJSON(w, 400, map[string]any{"error": "invalid mode: must be autopilot, copilot or manual"})
		return
	}
	// app_settings has a non-autoincrement TEXT id — use a random hex blob.
	upsert := `INSERT INTO app_settings(id,key,value,updated_at)
	           VALUES(lower(hex(randomblob(16))),?,?,unixepoch())
	           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
	if _, err := h.st.DB.Exec(upsert, "conv_mode_"+phone, body.Mode); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	if body.SetAsGlobalDefault {
		_, _ = h.st.DB.Exec(upsert, "default_response_mode", body.Mode)
	}
	writeJSON(w, 200, map[string]any{"ok": true, "mode": body.Mode, "phone": phone})
}

// webchatPhones returns both phone spellings for a webchat sessionId.
func webchatPhones(sessionID string) []string {
	return []string{"web:" + sessionID, "webchat-" + sessionID}
}

// webchatConversation handles /api/rainbow/webchat/conversations/{sessionId}
// (GET full log) and .../{sessionId}/read (PATCH no-op).
func (h *Handler) webchatConversation(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/rainbow/webchat/conversations/")
	parts := strings.Split(rest, "/")
	if len(parts) == 2 && parts[1] == "reply" && r.Method == http.MethodPost {
		h.webchatReply(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "read" {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if len(parts) != 1 || parts[0] == "" {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	sid := parts[0]
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	msgs, err := h.fetchLog(webchatPhones(sid), queryInt(r, "limit", 500), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	pushName := ""
	for _, p := range webchatPhones(sid) {
		if pushName = h.pushNameFor(p); pushName != "" {
			break
		}
	}
	if pushName == "" {
		pushName = "Web Visitor"
	}
	writeJSON(w, 200, map[string]any{
		"sessionId": sid, "pushName": pushName,
		"messages": msgs, "responseMode": h.defaultResponseMode(),
	})
}

// webchatSessionsMerged serves GET /api/rainbow/webchat/sessions-merged?sessions=a,b
// — the union of the sessions' logs sorted chronologically (same-IP group view).
func (h *Handler) webchatSessionsMerged(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("sessions")
	if raw == "" {
		writeJSON(w, 400, map[string]any{"error": "sessions query param required"})
		return
	}
	phones := []string{}
	sids := []string{}
	for _, sid := range strings.Split(raw, ",") {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		sids = append(sids, sid)
		phones = append(phones, webchatPhones(sid)...)
	}
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	msgs, err := h.fetchLog(phones, queryInt(r, "limit", 1000), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	sort.SliceStable(msgs, func(i, j int) bool { return msgs[i].Timestamp < msgs[j].Timestamp })
	pushName := ""
	for _, sid := range sids {
		for _, p := range webchatPhones(sid) {
			if pushName = h.pushNameFor(p); pushName != "" {
				break
			}
		}
		if pushName != "" {
			break
		}
	}
	if pushName == "" {
		pushName = "Web Visitor"
	}
	sessionID := ""
	if len(sids) > 0 {
		sessionID = sids[0]
	}
	writeJSON(w, 200, map[string]any{
		"sessionId": sessionID, "pushName": pushName,
		"messages": msgs, "responseMode": h.defaultResponseMode(),
	})
}
