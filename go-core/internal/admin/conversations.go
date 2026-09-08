package admin

// Conversation + webchat admin endpoints: /conversations (raw array for the
// SPA), /conversations/unified, per-phone logs, and the /webchat session
// family. Extracted from admin.go 2026-07-21 (cohesion split).

import (
	"database/sql"
	"encoding/json"
	"fmt"
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
	ProfileID  string  `json:"profileId,omitempty"` // set on an observed row (visibility.go); empty = own profile
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
	// Live-chat message metadata (pin/star/react) — see live_events.go.
	if len(parts) == 2 && parts[1] == "message-metadata" {
		h.messageMetadata(w, r, parts[0])
		return
	}
	if len(parts) == 4 && parts[1] == "messages" && r.Method == http.MethodPost {
		h.messageAction(w, r, parts[0], parts[2], parts[3])
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
	cond, cargs := h.profCondRead("m", profileID)
	args := append([]any{phone}, cargs...)
	args = append(args, limit)
	rows, err := h.st.DB.Query(`
		SELECT role, content, COALESCE(CAST(timestamp AS TEXT),''), COALESCE(intent,''), COALESCE(confidence,0), COALESCE(source,''), COALESCE(profile_id,'')
		FROM rainbow_messages m WHERE m.phone=? AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond+`
		ORDER BY CAST(m.timestamp AS TEXT) DESC LIMIT ?`, args...)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	own := profileID
	if own == "" {
		own = h.defaultProfile
		if own == "" {
			own = "pelangi"
		}
	}
	out := []msgRow{}
	for rows.Next() {
		var m msgRow
		var rowProfile string
		if err := rows.Scan(&m.Role, &m.Content, &m.Timestamp, &m.Intent, &m.Confidence, &m.Source, &rowProfile); err != nil {
			continue
		}
		actual := rowProfile
		if actual == "" {
			def := h.defaultProfile
			if def == "" {
				def = "pelangi"
			}
			actual = def
		}
		if actual != own {
			m.ProfileID = actual
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

// profCondRead is profCond's read-only counterpart: when p is an observer
// (visibility.go) it widens the predicate to (self OR each observed profile),
// so a query using it returns rows from every profile the caller may READ.
// Non-observers get exactly profCond's behaviour — this must never be used on
// a write path (send / mode), which stays self-only via profCond.
func (h *Handler) profCondRead(alias, p string) (string, []any) {
	observed := h.ObservedBy(p)
	if len(observed) == 0 {
		cond, arg := h.profCond(alias, p)
		return cond, []any{arg}
	}
	selfCond, selfArg := h.profCond(alias, p)
	parts := []string{selfCond}
	args := []any{selfArg}
	for _, op := range observed {
		parts = append(parts, alias+".profile_id=?")
		args = append(args, op)
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

// ownsConversation reports whether the profile has at least one live message
// row for any of the given phones. This is the gate for every per-conversation
// read AND write: a conversation that has no rows in the requesting profile
// does not exist for that profile — no transcript, no pushName, no send, no
// mode change (absolute cross-profile separation).
func (h *Handler) ownsConversation(phones []string, profileID string) bool {
	if len(phones) == 0 {
		return false
	}
	cond, carg := h.profCond("m", profileID)
	ph := make([]string, len(phones))
	args := make([]any, 0, len(phones)+1)
	for i, p := range phones {
		ph[i] = "?"
		args = append(args, p)
	}
	args = append(args, carg)
	var n int
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages m
		WHERE m.phone IN (`+strings.Join(ph, ",")+`) AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond, args...).Scan(&n)
	return n > 0
}

// ownsConversationRead is ownsConversation's read-only counterpart: true when
// the profile owns the conversation itself OR may observe the profile that
// does (visibility.go). Used only to gate GET /conversations/{phone} (the
// transcript view) — send and mode changes stay on ownsConversation.
func (h *Handler) ownsConversationRead(phones []string, profileID string) bool {
	if len(phones) == 0 {
		return false
	}
	cond, cargs := h.profCondRead("m", profileID)
	ph := make([]string, len(phones))
	args := make([]any, 0, len(phones)+len(cargs))
	for i, p := range phones {
		ph[i] = "?"
		args = append(args, p)
	}
	args = append(args, cargs...)
	var n int
	h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages m
		WHERE m.phone IN (`+strings.Join(ph, ",")+`) AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond, args...).Scan(&n)
	return n > 0
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
	ContactPhone    string `json:"contactPhone,omitempty"` // real number for @lid peers (rainbow_contact_info)
	LastMessage     string `json:"lastMessage"`
	LastMessageAt   int64  `json:"lastMessageAt"`
	LastMessageRole string `json:"lastMessageRole"`
	UnreadCount     int    `json:"unreadCount"`
	MessageCount    int    `json:"messageCount"`
	Favourite       bool   `json:"favourite"`
	Pinned          bool   `json:"pinned"`
	ProfileID       string `json:"profileId,omitempty"` // set on an observed row (visibility.go); empty = own profile
}

// queryUnified derives the conversation list from rainbow_messages (same
// GROUP BY as conversations()) plus last-message role, tagged per channel.
// profileID filters to a specific business profile (x-profile-id header value);
// an empty string returns all profiles (admin/unscoped access).
func (h *Handler) queryUnified(limit int, profileID string) ([]unifiedRow, error) {
	// Read-scoped: profCondRead widens to (self OR every profile this caller
	// observes — visibility.go). Non-observers get exactly profCond's rows,
	// unchanged from before. Grouping key is (phone, profile_id) rather than
	// just phone, so the same phone talking to two profiles yields two rows,
	// each correctly tagged — this also fixes the plain (non-observer) case
	// where a shared phone across profiles used to collapse into one group.
	cond, cargs := h.profCondRead("m", profileID)
	args := make([]any, 0, len(cargs)*3+1)
	args = append(args, cargs...) // m2 content subquery
	args = append(args, cargs...) // m3 role subquery
	args = append(args, cargs...) // m4 count subquery
	args = append(args, cargs...) // outer WHERE
	args = append(args, limit)
	sameGroup := "COALESCE(%s.profile_id,'')=COALESCE(m.profile_id,'')"
	rows, err := h.st.DB.Query(`
		SELECT m.phone, COALESCE(m.profile_id,''),
		       COALESCE(s.push_name, c.push_name, ''),
		       COALESCE(MAX(CAST(m.timestamp AS TEXT)), ''),
		       COALESCE((SELECT m2.content FROM rainbow_messages m2
		                 WHERE m2.phone = m.phone AND (m2.deleted_at IS NULL OR m2.deleted_at='')
		                 AND `+fmt.Sprintf(sameGroup, "m2")+` AND `+strings.ReplaceAll(cond, "m.", "m2.")+`
		                 ORDER BY CAST(m2.timestamp AS TEXT) DESC LIMIT 1), ''),
		       COALESCE((SELECT m3.role FROM rainbow_messages m3
		                 WHERE m3.phone = m.phone AND (m3.deleted_at IS NULL OR m3.deleted_at='')
		                 AND `+fmt.Sprintf(sameGroup, "m3")+` AND `+strings.ReplaceAll(cond, "m.", "m3.")+`
		                 ORDER BY CAST(m3.timestamp AS TEXT) DESC LIMIT 1), ''),
		       (SELECT COUNT(*) FROM rainbow_messages m4
		        WHERE m4.phone = m.phone AND (m4.deleted_at IS NULL OR m4.deleted_at='')
		        AND `+fmt.Sprintf(sameGroup, "m4")+` AND `+strings.ReplaceAll(cond, "m.", "m4.")+`)
		FROM rainbow_messages m
		LEFT JOIN rainbow_conversation_state s ON s.phone = m.phone
		LEFT JOIN rainbow_conversations c ON c.phone = m.phone
		WHERE (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond+`
		GROUP BY m.phone, COALESCE(m.profile_id,'')
		ORDER BY MAX(CAST(m.timestamp AS TEXT)) DESC LIMIT ?`,
		args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	own := profileID
	if own == "" {
		own = h.defaultProfile
		if own == "" {
			own = "pelangi"
		}
	}
	out := []unifiedRow{}
	for rows.Next() {
		var phone, rowProfile, pushName, lastTs, lastMsg, lastRole string
		var msgCount int
		if err := rows.Scan(&phone, &rowProfile, &pushName, &lastTs, &lastMsg, &lastRole, &msgCount); err != nil {
			continue
		}
		if len(lastMsg) > 120 {
			lastMsg = lastMsg[:120]
		}
		actual := rowProfile
		if actual == "" {
			def := h.defaultProfile
			if def == "" {
				def = "pelangi"
			}
			actual = def
		}
		u := unifiedRow{
			Phone: phone, Channel: "whatsapp", PushName: pushName,
			LastMessage: lastMsg, LastMessageAt: tsToMillis(lastTs), LastMessageRole: lastRole,
			MessageCount: msgCount,
		}
		if actual != own {
			u.ProfileID = actual
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
	// The WhatsApp number a row's conversation belongs to: the row's own
	// profile for an observed row, the requesting profile otherwise (the SPA
	// echoes it back on send; the server re-validates it against the profile).
	profInstance := h.instanceForProfile(profileID)
	for i := range out {
		if out[i].Channel != "whatsapp" {
			continue
		}
		if out[i].ProfileID != "" {
			if id := h.instanceForProfile(out[i].ProfileID); id != "" {
				out[i].InstanceID = id
			}
			continue
		}
		if profInstance != "" {
			out[i].InstanceID = profInstance
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	// Resolved numbers for privacy-ID peers. Done AFTER the cursor is closed:
	// the store runs with a single SQLite connection, so a nested query while
	// iterating rows would deadlock.
	for i := range out {
		if out[i].Channel == "whatsapp" {
			out[i].ContactPhone = h.contactPhoneFor(out[i].Phone)
		}
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
	ID           int64   `json:"id,omitempty"`       // rainbow_messages.id (stable key for pin/star/react)
	MediaURL     string  `json:"mediaUrl,omitempty"` // dashboard-relative media URL (/api/rainbow/media/<file>)
	Manual       bool    `json:"manual,omitempty"`   // staff-authored
	StaffName    string  `json:"staffName,omitempty"`
	ProfileID    string  `json:"profileId,omitempty"` // set on an observed row (visibility.go); empty = own profile
}

// fetchLog returns the chronological message log for a set of phones, tagging
// each message with the sessionId derived from its phone (webchat rows).
// Read-scoped via profCondRead: when profileID is an observer, rows from its
// observed profiles are included too (tagged via ProfileID) — callers gate
// which phones may be queried at all (ownsConversation / ownsConversationRead).
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
	cond, cargs := h.profCondRead("m", profileID)
	args = append(args, cargs...)
	args = append(args, limit)
	mediaSel, staffSel := "''", "''"
	if h.hasMsgCol("media_url") {
		mediaSel = "COALESCE(m.media_url,'')"
	}
	if h.hasMsgCol("staff_name") {
		staffSel = "COALESCE(m.staff_name,'')"
	}
	rows, err := h.st.DB.Query(`
		SELECT m.id, m.phone, m.role, m.content, COALESCE(CAST(m.timestamp AS TEXT),''),
		       COALESCE(m.intent,''), COALESCE(m.confidence,0), COALESCE(m.source,''),
		       COALESCE(m.routed_action,''), COALESCE(m.model,''),
		       COALESCE(m.response_time_ms,0), COALESCE(m.message_type,''),
		       `+mediaSel+`, `+staffSel+`, COALESCE(m.profile_id,'')
		FROM rainbow_messages m
		WHERE m.phone IN (`+strings.Join(ph, ",")+`) AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond+`
		ORDER BY CAST(m.timestamp AS TEXT) DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	own := profileID
	if own == "" {
		own = h.defaultProfile
		if own == "" {
			own = "pelangi"
		}
	}
	out := []logMsg{}
	for rows.Next() {
		var phone, role, content, ts, intent, source, routedAction, model, messageType, mediaURL, staffName, rowProfile string
		var confidence float64
		var responseTime, id int64
		if err := rows.Scan(&id, &phone, &role, &content, &ts,
			&intent, &confidence, &source, &routedAction, &model, &responseTime, &messageType, &mediaURL, &staffName, &rowProfile); err != nil {
			continue
		}
		m := logMsg{
			Role: role, Content: content, Timestamp: tsToMillis(ts),
			Intent: intent, Confidence: confidence, Source: source,
			RoutedAction: routedAction, Model: model, ResponseTime: responseTime,
			MessageType: messageType, ID: id, MediaURL: publicMediaURL(mediaURL),
			Manual: role == "staff", StaffName: staffName,
		}
		actual := rowProfile
		if actual == "" {
			def := h.defaultProfile
			if def == "" {
				def = "pelangi"
			}
			actual = def
		}
		if actual != own {
			m.ProfileID = actual
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

// contactPhoneFor returns the resolved real number for a conversation key
// (privacy-ID peers), "" when unknown or the table does not exist yet.
func (h *Handler) contactPhoneFor(phone string) string {
	var v sql.NullString
	if err := h.st.DB.QueryRow(`SELECT contact_phone FROM rainbow_contact_info WHERE phone = ?`, phone).Scan(&v); err != nil {
		return ""
	}
	return v.String
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
	if !h.ownsConversationRead([]string{phone}, profileID) {
		writeJSON(w, 404, map[string]any{"error": "conversation not found"})
		return
	}
	msgs, err := h.fetchLog([]string{phone}, queryInt(r, "limit", 500), profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{
		"phone": phone, "pushName": h.pushNameFor(phone), "contactPhone": h.contactPhoneFor(phone),
		"instanceId": h.instanceForProfile(profileID),
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
// app_settings; optionally sets the profile's default. Both keys are scoped
// per profile: the same guest phone can talk to two businesses, and one
// business's staff must never flip the other's bot mode.
func (h *Handler) conversationMode(w http.ResponseWriter, r *http.Request, phone string) {
	// Validate phone so it cannot inject arbitrary keys into app_settings.
	for _, c := range phone {
		if !((c >= '0' && c <= '9') || c == '@' || c == '.' || c == '_' || c == '-' || c == ':') {
			writeJSON(w, 400, map[string]any{"error": "invalid phone"})
			return
		}
	}
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	if !h.ownsConversation([]string{phone}, profileID) {
		writeJSON(w, 404, map[string]any{"error": "conversation not found"})
		return
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
	// Key scoping: the default profile keeps the legacy unprefixed keys
	// (existing prod rows), non-default profiles get their own namespace.
	modeKey, defaultKey := "conv_mode_"+phone, "default_response_mode"
	if profileID != "" {
		modeKey = "conv_mode_" + profileID + "_" + phone
		defaultKey = "default_response_mode_" + profileID
	}
	// app_settings has a non-autoincrement TEXT id — use a random hex blob.
	upsert := `INSERT INTO app_settings(id,key,value,updated_at)
	           VALUES(lower(hex(randomblob(16))),?,?,unixepoch())
	           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
	if _, err := h.st.DB.Exec(upsert, modeKey, body.Mode); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	if body.SetAsGlobalDefault {
		_, _ = h.st.DB.Exec(upsert, defaultKey, body.Mode)
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
	if !h.ownsConversation(webchatPhones(sid), profileID) {
		writeJSON(w, 404, map[string]any{"error": "session not found"})
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
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	// Only sessions the profile owns take part in the merge — a foreign sid in
	// the query string must contribute neither transcript nor pushName.
	phones := []string{}
	sids := []string{}
	for _, sid := range strings.Split(raw, ",") {
		sid = strings.TrimSpace(sid)
		if sid == "" || !h.ownsConversation(webchatPhones(sid), profileID) {
			continue
		}
		sids = append(sids, sid)
		phones = append(phones, webchatPhones(sid)...)
	}
	if len(sids) == 0 {
		writeJSON(w, 404, map[string]any{"error": "no sessions found"})
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
