// Staff reply endpoints: webchat staff reply (persist-only — the guest widget
// has no live delivery channel in go-core yet) and WhatsApp send via the
// Baileys bridge (persist + deliver).
package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"rainbow-core/internal/contract"
	"rainbow-core/internal/store"
)

// TextSender delivers WhatsApp text (implemented by bridge.Client).
type TextSender interface {
	SendText(ctx context.Context, phone, text, instanceID string) (*contract.SendResult, error)
}

// SetSender supplies the bridge client for staff WhatsApp sends.
func (h *Handler) SetSender(s TextSender) { h.sender = s }

// hasStaffNameCol reports whether rainbow_messages has a staff_name column
// (lazily initialised once; safe for concurrent callers).
func (h *Handler) hasStaffNameCol() bool {
	h.staffNameColOnce.Do(func() {
		h.staffNameCol = -1
		if cols, err := h.st.TableColumns("rainbow_messages"); err == nil {
			if _, ok := cols["staff_name"]; ok {
				h.staffNameCol = 1
			}
		}
	})
	return h.staffNameCol == 1
}

// insertStaffMessage stores a staff-authored message row and returns its
// timestamp in epoch millis.
func (h *Handler) insertStaffMessage(phone, content, source, staffName string) (int64, error) {
	ts := store.NowISO()
	var err error
	if h.hasStaffNameCol() {
		_, err = h.st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, source, staff_name)
			VALUES (?, 'staff', ?, ?, ?, ?)`, phone, content, ts, source, staffName)
	} else {
		_, err = h.st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, source)
			VALUES (?, 'staff', ?, ?, ?)`, phone, content, ts, source)
	}
	if err != nil {
		return 0, err
	}
	t, _ := time.Parse(store.ISO, ts)
	return t.UnixMilli(), nil
}

// webchatReply handles POST /api/rainbow/webchat/conversations/{sid}/reply
// {message, staffName}. The row lands under whichever phone spelling the
// session already uses (web:<sid> Go era, webchat-<sid> Node era).
func (h *Handler) webchatReply(w http.ResponseWriter, r *http.Request, sid string) {
	var in struct {
		Message   string `json:"message"`
		StaffName string `json:"staffName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Message == "" {
		writeJSON(w, 400, map[string]any{"error": "message required"})
		return
	}
	if in.StaffName == "" {
		in.StaffName = "Staff"
	}
	phone := "web:" + sid
	for _, p := range webchatPhones(sid) {
		var n int
		h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone=?`, p).Scan(&n)
		if n > 0 {
			phone = p
			break
		}
	}
	ms, err := h.insertStaffMessage(phone, in.Message, "webchat-admin", in.StaffName)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "timestamp": ms})
}

// conversationSend handles POST /api/rainbow/conversations/{phone}/send
// {message, instanceId, staffName} — deliver via the bridge, then persist.
func (h *Handler) conversationSend(w http.ResponseWriter, r *http.Request, phone string) {
	var in struct {
		Message    string `json:"message"`
		InstanceID string `json:"instanceId"`
		StaffName  string `json:"staffName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Message == "" {
		writeJSON(w, 400, map[string]any{"error": "message required"})
		return
	}
	if in.StaffName == "" {
		in.StaffName = "Staff"
	}
	// Webchat conversations live in the same unified list; a "send" to a
	// web:<sid> phone is a staff webchat reply (persist, no bridge — the guest
	// widget has no live delivery channel yet).
	if _, isWebchat := webchatSession(phone); isWebchat {
		ms, err := h.insertStaffMessage(phone, in.Message, "webchat-admin", in.StaffName)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "timestamp": ms})
		return
	}
	if h.sender == nil {
		writeJSON(w, 501, map[string]any{"error": "sending unavailable: no bridge configured"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if _, err := h.sender.SendText(ctx, phone, in.Message, in.InstanceID); err != nil {
		writeJSON(w, 502, map[string]any{"error": "bridge send failed: " + err.Error()})
		return
	}
	ms, err := h.insertStaffMessage(phone, in.Message, "staff-manual", in.StaffName)
	if err != nil {
		// Delivered but not persisted — report success with a warning so the
		// SPA doesn't retry-send a duplicate.
		writeJSON(w, 200, map[string]any{"ok": true, "warning": "sent but not persisted: " + err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "timestamp": ms})
}
