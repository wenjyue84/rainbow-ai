package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rainbow-core/internal/events"
)

// Dashboard "Recent activity" feed.
//
// GET /api/rainbow/activity/stream[?profile=<id>] — SSE. EventSource cannot
// send the x-profile-id header, so the SPA passes ?profile= exactly like the
// live-chat stream. The init event carries the last activityInitLimit
// messages of that profile (so the panel is never empty when live-chat has
// history), then every new_message published on the events bus for the same
// profile is pushed as an "activity" event.
//
// Payload shape matches what dashboard-helpers.js renders:
//
//	{id, type, category, icon, message, phone, role, timestamp}
//
// type ∈ message_received | response_sent (staff sends are response_sent with
// a 👤 icon) so the SPA's category tabs and colours keep working.

const activityInitLimit = 25

type activityEvent struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Category  string `json:"category"`
	Icon      string `json:"icon"`
	Message   string `json:"message"`
	Phone     string `json:"phone"`
	Role      string `json:"role"`
	Timestamp int64  `json:"timestamp"`
}

func activityWho(phone, pushName string) string {
	if _, ok := webchatSession(phone); ok {
		if pushName != "" {
			return pushName + " (web)"
		}
		return "Web visitor"
	}
	if pushName != "" {
		return pushName
	}
	return "+" + phone
}

func activityFrom(id, phone, role, pushName, content string, ts int64) activityEvent {
	who := activityWho(phone, pushName)
	prev := events.Preview(strings.TrimSpace(content), 80)
	ev := activityEvent{ID: id, Phone: phone, Role: role, Timestamp: ts}
	switch role {
	case "user":
		ev.Type, ev.Category, ev.Icon = "message_received", "message", "📩"
		ev.Message = "Message from " + who
	case "staff":
		ev.Type, ev.Category, ev.Icon = "response_sent", "reply", "👤"
		ev.Message = "Staff replied to " + who
	default: // assistant
		ev.Type, ev.Category, ev.Icon = "response_sent", "reply", "🤖"
		ev.Message = "AI replied to " + who
	}
	if prev != "" {
		ev.Message += ": " + prev
	}
	return ev
}

// recentActivity returns the newest rows for the profile, newest first.
func (h *Handler) recentActivity(profileID string, limit int) []activityEvent {
	out := []activityEvent{}
	if h.st == nil {
		return out
	}
	cond, arg := h.profCond("m", profileID)
	rows, err := h.st.DB.Query(`
		SELECT m.id, m.phone, COALESCE(m.role,''), COALESCE(m.content,''),
		       COALESCE(CAST(m.timestamp AS TEXT),''),
		       COALESCE(s.push_name, c.push_name, '')
		FROM rainbow_messages m
		LEFT JOIN rainbow_conversation_state s ON s.phone = m.phone
		LEFT JOIN rainbow_conversations c ON c.phone = m.phone
		WHERE (m.deleted_at IS NULL OR m.deleted_at='')
		AND `+cond+`
		ORDER BY CAST(m.timestamp AS TEXT) DESC, m.id DESC LIMIT ?`, arg, limit)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var phone, role, content, ts, push string
		if err := rows.Scan(&id, &phone, &role, &content, &ts, &push); err != nil {
			continue
		}
		out = append(out, activityFrom("msg-"+strconv.FormatInt(id, 10), phone, role, push, content, tsToMillis(ts)))
	}
	return out
}

func (h *Handler) activityStream(w http.ResponseWriter, r *http.Request) {
	if q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("profile"))); q != "" && r.Header.Get("x-profile-id") == "" {
		if sess := sessionFrom(r); sess != nil && sess.Scoped() && !sess.Allows(q) {
			writeJSON(w, 403, map[string]any{"error": "forbidden: not authorized for this tenant"})
			return
		}
		r.Header.Set("x-profile-id", q)
	}
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	want := h.effProfile(profileID)
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

	initB, _ := json.Marshal(map[string]any{"profile": want, "events": h.recentActivity(profileID, activityInitLimit)})
	fmt.Fprintf(w, "event: init\ndata: %s\n\n", initB)
	flusher.Flush()

	ch, cancel := events.Subscribe(64)
	defer cancel()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case ev, open := <-ch:
			if !open {
				return
			}
			if ev.Type != "new_message" || (ev.ProfileID != "" && ev.ProfileID != want) {
				continue
			}
			id := "live-" + ev.Phone + "-" + strconv.FormatInt(ev.Timestamp, 10)
			b, _ := json.Marshal(activityFrom(id, ev.Phone, ev.Role, h.pushNameFor(ev.Phone), ev.Preview, ev.Timestamp))
			fmt.Fprintf(w, "event: activity\ndata: %s\n\n", b)
			flusher.Flush()
		}
	}
}
