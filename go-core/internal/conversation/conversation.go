// Package conversation owns per-phone conversation state, backed by the shared
// SQLite tables rainbow_conversation_state (state) and rainbow_messages (history).
// Mirrors assistant/conversation.ts + state-persistence.ts. State survives bridge
// AND core restarts because it lives in the DB, not process memory.
package conversation

import (
	"database/sql"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"rainbow-core/internal/events"
	"rainbow-core/internal/store"
)

// Message is one turn in the history.
type Message struct {
	Role      string `json:"role"` // user | assistant
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"` // unix ms
}

// State mirrors the relevant fields of Node ConversationState.
type State struct {
	Phone                 string
	PushName              string
	ProfileID             string
	Language              string
	UnknownCount          int
	LastIntent            string
	LastIntentConfidence  float64
	LastIntentTimestampMs int64
	Slots                 map[string]any
	RepeatCount           int
	CreatedAtMs           int64
	LastActiveAtMs        int64
	LastUserMessageAtMs   int64
	// Opaque JSON blobs passed through untouched (booking/workflow/flow FSMs ported later).
	BookingStateJSON  string
	WorkflowStateJSON string
	ActiveFlowJSON    string

	isNew bool
	// crossProfile is set when the stored row belonged to another profile and
	// was reset for this one (see GetOrCreate). Exposed for tests/diagnostics.
	crossProfile bool
}

// CrossProfileReset reports whether this state was rebuilt because the stored
// row belonged to a different business profile.
func (s *State) CrossProfileReset() bool { return s.crossProfile }

// Manager provides conversation state + history operations.
type Manager struct {
	st          *store.Store
	idleTimeout time.Duration
	maxHistory  int

	mediaColOnce sync.Once
	mediaCol     bool
}

func NewManager(st *store.Store) *Manager {
	return &Manager{st: st, idleTimeout: 8 * time.Hour, maxHistory: 20}
}

func (m *Manager) SetIdleTimeout(d time.Duration) { m.idleTimeout = d }
func (m *Manager) SetMaxHistory(n int)            { m.maxHistory = n }

// Store exposes the underlying store (tests / admin queries).
func (m *Manager) Store() *store.Store { return m.st }

// ── Contact info (privacy-ID peers) ─────────────────────────────────────────
// rainbow_contact_info maps a conversation key (often an opaque @lid JID) to
// the peer's dialable number once the bridge has resolved it.
var contactTableOnce sync.Map // *store.Store -> bool

func (m *Manager) ensureContactTable() {
	if _, ok := contactTableOnce.Load(m.st); ok {
		return
	}
	_, _ = m.st.DB.Exec(`CREATE TABLE IF NOT EXISTS rainbow_contact_info (
		phone         TEXT PRIMARY KEY,
		contact_phone TEXT,
		updated_at    TEXT
	)`)
	contactTableOnce.Store(m.st, true)
}

// SetContactPhone records the real number for a conversation key (idempotent).
func (m *Manager) SetContactPhone(phone, contactPhone string) {
	phone, contactPhone = strings.TrimSpace(phone), strings.TrimSpace(contactPhone)
	if phone == "" || contactPhone == "" {
		return
	}
	m.ensureContactTable()
	_, _ = m.st.DB.Exec(`INSERT INTO rainbow_contact_info (phone, contact_phone, updated_at) VALUES (?,?,?)
		ON CONFLICT(phone) DO UPDATE SET contact_phone = excluded.contact_phone, updated_at = excluded.updated_at`,
		phone, contactPhone, store.NowISO())
}

// ContactPhone returns the stored real number for a conversation key ("" = unknown).
func (m *Manager) ContactPhone(phone string) string {
	m.ensureContactTable()
	var v sql.NullString
	_ = m.st.DB.QueryRow(`SELECT contact_phone FROM rainbow_contact_info WHERE phone = ?`, phone).Scan(&v)
	return v.String
}

// ─── time helpers (ISO text ⇄ unix ms) ──────────────────────────────────────

func iso(ms int64) string {
	if ms == 0 {
		return store.NowISO()
	}
	return time.UnixMilli(ms).UTC().Format(store.ISO)
}

func parseISO(s string) int64 {
	if s == "" {
		return 0
	}
	for _, layout := range []string{store.ISO, "2006-01-02T15:04:05Z", time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

func nowMs() int64 { return time.Now().UnixMilli() }

// ─── State load / save ───────────────────────────────────────────────────────

// GetOrCreate loads the conversation state for phone, creating a default row if
// none exists. Applies idle reset: if the conversation has been idle past the
// timeout, history-derived context is treated as stale (caller clears as needed).
func (m *Manager) GetOrCreate(phone, pushName, profileID string) (*State, error) {
	if profileID == "" {
		profileID = "pelangi"
	}
	s := &State{Phone: phone, PushName: pushName, ProfileID: profileID, Language: "en", Slots: map[string]any{}}

	var (
		pn, lang, lastIntent, slotsJSON, bookingJSON, workflowJSON, flowJSON sql.NullString
		createdAt, lastActiveAt, lastIntentTs, lastUserMsgAt                 sql.NullString
		profID                                                               sql.NullString
		unknownCount, repeatCount                                            sql.NullInt64
		lastConf                                                             sql.NullFloat64
	)
	row := m.st.DB.QueryRow(`SELECT push_name, language, unknown_count, last_intent, last_intent_confidence,
		last_intent_timestamp, slots_json, repeat_count, profile_id, created_at, last_active_at,
		last_user_message_at, booking_state_json, workflow_state_json, active_flow_json
		FROM rainbow_conversation_state WHERE phone = ?`, phone)
	err := row.Scan(&pn, &lang, &unknownCount, &lastIntent, &lastConf, &lastIntentTs, &slotsJSON,
		&repeatCount, &profID, &createdAt, &lastActiveAt, &lastUserMsgAt, &bookingJSON, &workflowJSON, &flowJSON)
	if err == sql.ErrNoRows {
		s.isNew = true
		s.CreatedAtMs = nowMs()
		s.LastActiveAtMs = s.CreatedAtMs
		if err := m.Save(s); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}

	if pn.Valid && pn.String != "" {
		s.PushName = pn.String
	}
	if lang.Valid && lang.String != "" {
		s.Language = lang.String
	}
	s.UnknownCount = int(unknownCount.Int64)
	s.LastIntent = lastIntent.String
	s.LastIntentConfidence = lastConf.Float64
	s.LastIntentTimestampMs = parseISO(lastIntentTs.String)
	s.RepeatCount = int(repeatCount.Int64)
	if profID.Valid && profID.String != "" {
		s.ProfileID = profID.String
	}
	s.CreatedAtMs = parseISO(createdAt.String)
	s.LastActiveAtMs = parseISO(lastActiveAt.String)
	s.LastUserMessageAtMs = parseISO(lastUserMsgAt.String)
	s.BookingStateJSON = bookingJSON.String
	s.WorkflowStateJSON = workflowJSON.String
	s.ActiveFlowJSON = flowJSON.String
	s.Slots = map[string]any{}
	if slotsJSON.Valid && slotsJSON.String != "" {
		_ = json.Unmarshal([]byte(slotsJSON.String), &s.Slots)
	}

	// Cross-profile guard (2026-09-08): the state row is keyed by phone only.
	// When the same contact talks to ANOTHER business, its row still carries the
	// other business's workflow/booking — resuming that here made Rachel
	// (southern-homestay) send a Pelangi reservation. A row owned by a
	// different profile is treated as a fresh conversation for this profile:
	// keep the push name, drop every transient / flow field.
	if s.ProfileID != profileID {
		s.ProfileID = profileID
		s.UnknownCount = 0
		s.RepeatCount = 0
		s.LastIntent = ""
		s.LastIntentConfidence = 0
		s.LastIntentTimestampMs = 0
		s.BookingStateJSON = ""
		s.WorkflowStateJSON = ""
		s.ActiveFlowJSON = ""
		s.Slots = map[string]any{}
		s.crossProfile = true
	}

	// Idle reset (US-444): clear transient context if idle past timeout.
	if s.LastActiveAtMs > 0 && nowMs()-s.LastActiveAtMs > m.idleTimeout.Milliseconds() {
		s.UnknownCount = 0
		s.RepeatCount = 0
		s.BookingStateJSON = ""
		s.WorkflowStateJSON = ""
		s.ActiveFlowJSON = ""
		s.Slots = map[string]any{}
	}
	return s, nil
}

// Save upserts the conversation state row.
func (m *Manager) Save(s *State) error {
	slotsJSON := "{}"
	if len(s.Slots) > 0 {
		if b, err := json.Marshal(s.Slots); err == nil {
			slotsJSON = string(b)
		}
	}
	now := store.NowISO()
	created := iso(s.CreatedAtMs)
	lastActive := store.NowISO()
	s.LastActiveAtMs = nowMs()
	var lastUserMsg any
	if s.LastUserMessageAtMs > 0 {
		lastUserMsg = iso(s.LastUserMessageAtMs)
	}
	var lastIntentTs any
	if s.LastIntentTimestampMs > 0 {
		lastIntentTs = iso(s.LastIntentTimestampMs)
	}
	var lastIntent any
	if s.LastIntent != "" {
		lastIntent = s.LastIntent
	}
	var lastConf any
	if s.LastIntentConfidence > 0 {
		lastConf = s.LastIntentConfidence
	}
	nullIfEmpty := func(v string) any {
		if v == "" {
			return nil
		}
		return v
	}

	_, err := m.st.DB.Exec(`INSERT INTO rainbow_conversation_state
		(phone, push_name, language, unknown_count, last_intent, last_intent_confidence,
		 last_intent_timestamp, slots_json, repeat_count, profile_id, created_at, last_active_at,
		 last_user_message_at, booking_state_json, workflow_state_json, active_flow_json, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(phone) DO UPDATE SET
		 push_name=excluded.push_name, language=excluded.language, unknown_count=excluded.unknown_count,
		 last_intent=excluded.last_intent, last_intent_confidence=excluded.last_intent_confidence,
		 last_intent_timestamp=excluded.last_intent_timestamp, slots_json=excluded.slots_json,
		 repeat_count=excluded.repeat_count, profile_id=excluded.profile_id,
		 last_active_at=excluded.last_active_at, last_user_message_at=excluded.last_user_message_at,
		 booking_state_json=excluded.booking_state_json, workflow_state_json=excluded.workflow_state_json,
		 active_flow_json=excluded.active_flow_json, updated_at=excluded.updated_at`,
		s.Phone, s.PushName, s.Language, s.UnknownCount, lastIntent, lastConf,
		lastIntentTs, slotsJSON, s.RepeatCount, s.ProfileID, created, lastActive,
		lastUserMsg, nullIfEmpty(s.BookingStateJSON), nullIfEmpty(s.WorkflowStateJSON), nullIfEmpty(s.ActiveFlowJSON), now)
	return err
}

// ─── Message history ─────────────────────────────────────────────────────────

// AddMessage appends a message to rainbow_messages.
func (m *Manager) AddMessage(phone, role, content, profileID string) error {
	return m.AddMessageMeta(phone, role, content, profileID, nil)
}

// MsgMeta carries optional classification metadata for an assistant turn.
type MsgMeta struct {
	Intent       string
	Confidence   float64
	Source       string // tier: regex|fuzzy|semantic|llm
	RoutedAction string
	Model        string
	ResponseMs   int
	MessageType  string
	MediaURL     string // bridge media URL for inbound media (stored in media_url)
}

// hasMediaURLCol reports whether rainbow_messages has the media_url column
// (present on the live DB from the Node era; absent in minimal test schemas).
func (m *Manager) hasMediaURLCol() bool {
	m.mediaColOnce.Do(func() {
		if cols, err := m.st.TableColumns("rainbow_messages"); err == nil {
			_, m.mediaCol = cols["media_url"]
		}
	})
	return m.mediaCol
}

// publish notifies live-chat SSE subscribers that a row was written.
func publish(profileID, phone, role, content, ts string) {
	t, _ := time.Parse(store.ISO, ts)
	preview := events.Preview(content, 80)
	events.Publish(events.Event{Type: "new_message", ProfileID: profileID, Phone: phone, Role: role, Timestamp: t.UnixMilli(), Preview: preview})
}

// AddMessageMeta appends a message with optional metadata.
func (m *Manager) AddMessageMeta(phone, role, content, profileID string, meta *MsgMeta) error {
	if profileID == "" {
		profileID = "pelangi"
	}
	ts := store.NowISO()
	if meta == nil {
		_, err := m.st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id, message_type)
			VALUES (?,?,?,?,?,?)`, phone, role, content, ts, profileID, "text")
		if err == nil {
			publish(profileID, phone, role, content, ts)
		}
		return err
	}
	var intent, source, routed, model, mtype any
	if meta.Intent != "" {
		intent = meta.Intent
	}
	if meta.Source != "" {
		source = meta.Source
	}
	if meta.RoutedAction != "" {
		routed = meta.RoutedAction
	}
	if meta.Model != "" {
		model = meta.Model
	}
	mtype = "text"
	if meta.MessageType != "" {
		mtype = meta.MessageType
	}
	var conf any
	if meta.Confidence > 0 {
		conf = meta.Confidence
	}
	var rt any
	if meta.ResponseMs > 0 {
		rt = meta.ResponseMs
	}
	var err error
	if meta.MediaURL != "" && m.hasMediaURLCol() {
		_, err = m.st.DB.Exec(`INSERT INTO rainbow_messages
			(phone, role, content, timestamp, profile_id, intent, confidence, source, routed_action, model, response_time_ms, message_type, media_url)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			phone, role, content, ts, profileID, intent, conf, source, routed, model, rt, mtype, meta.MediaURL)
	} else {
		_, err = m.st.DB.Exec(`INSERT INTO rainbow_messages
			(phone, role, content, timestamp, profile_id, intent, confidence, source, routed_action, model, response_time_ms, message_type)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
			phone, role, content, ts, profileID, intent, conf, source, routed, model, rt, mtype)
	}
	if err == nil {
		publish(profileID, phone, role, content, ts)
	}
	return err
}

// History returns the last N messages for a phone in chronological order,
// scoped to profileID so a phone talking to two bots at once doesn't leak
// one bot's history into the other's context. profileID "" matches legacy
// rows written before profile_id existed (NULL/'').
func (m *Manager) History(phone, profileID string, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = m.maxHistory
	}
	rows, err := m.st.DB.Query(`SELECT role, content, timestamp FROM rainbow_messages
		WHERE phone = ? AND (deleted_at IS NULL OR deleted_at = '')
		AND (profile_id=? OR (?='' AND (profile_id IS NULL OR profile_id='')))
		ORDER BY CAST(timestamp AS TEXT) DESC LIMIT ?`, phone, profileID, profileID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var role, content, ts string
		if err := rows.Scan(&role, &content, &ts); err != nil {
			return nil, err
		}
		out = append(out, Message{Role: role, Content: content, Timestamp: parseISO(ts)})
	}
	// reverse to chronological
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// HistoryStrings returns history formatted as "role: content" lines for prompts.
func (m *Manager) HistoryStrings(phone, profileID string, limit int) []string {
	msgs, err := m.History(phone, profileID, limit)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(msgs))
	for _, msg := range msgs {
		out = append(out, msg.Role+": "+strings.TrimSpace(msg.Content))
	}
	return out
}
