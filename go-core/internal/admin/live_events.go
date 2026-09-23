package admin

// Live-chat extras for WhatsApp-Web parity in the dashboard:
//   - GET  /api/rainbow/conversations/events            SSE: new_message push
//   - GET  /api/rainbow/media/{file}                    proxy to the bridge's media store
//   - GET  /api/rainbow/conversations/{phone}/message-metadata
//   - POST /api/rainbow/conversations/{phone}/messages/{idx}/{pin|star|react}
// Pin/star/reaction state lives in rainbow_message_meta keyed by the stable
// rainbow_messages.id, scoped per profile so two businesses sharing a guest
// phone never see each other's marks.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"rainbow-core/internal/events"
	"rainbow-core/internal/store"
)

var (
	// Per-DB caches (keyed by *store.Store so tests with many DBs don't cross-talk).
	colCacheMu  sync.Mutex
	colCache    = map[*store.Store]map[string]string{}
	metaReady   = map[*store.Store]bool{}
	mediaNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,200}$`)
)

// hasMsgCol reports whether rainbow_messages has the named column (cached per DB).
func (h *Handler) hasMsgCol(name string) bool {
	colCacheMu.Lock()
	cols, ok := colCache[h.st]
	if !ok {
		c, err := h.st.TableColumns("rainbow_messages")
		if err != nil {
			c = map[string]string{}
		}
		colCache[h.st] = c
		cols = c
	}
	colCacheMu.Unlock()
	_, has := cols[name]
	return has
}

// ensureMetaTable creates rainbow_message_meta on first use (per DB).
func (h *Handler) ensureMetaTable() error {
	colCacheMu.Lock()
	defer colCacheMu.Unlock()
	if metaReady[h.st] {
		return nil
	}
	_, err := h.st.DB.Exec(`CREATE TABLE IF NOT EXISTS rainbow_message_meta (
		profile_id TEXT NOT NULL,
		phone      TEXT NOT NULL,
		message_id INTEGER NOT NULL,
		kind       TEXT NOT NULL,
		value      TEXT,
		updated_at INTEGER,
		PRIMARY KEY (profile_id, phone, message_id, kind)
	)`)
	if err == nil {
		metaReady[h.st] = true
	}
	return err
}

// effProfile maps the request's profile ("" = default) to the concrete id
// used in rainbow_messages.profile_id / events.
func (h *Handler) effProfile(p string) string {
	if p != "" {
		return p
	}
	if h.defaultProfile != "" {
		return h.defaultProfile
	}
	return "pelangi"
}

// publicMediaURL turns a bridge media URL (http://127.0.0.1:8789/media/x.jpg)
// into the dashboard-relative proxy path; "" when the row has no media.
func publicMediaURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	i := strings.LastIndex(raw, "/media/")
	if i < 0 {
		return ""
	}
	name := raw[i+len("/media/"):]
	if strings.ContainsAny(name, "/\\?#") || !mediaNameRe.MatchString(name) || strings.Contains(name, "..") {
		return ""
	}
	return "/api/rainbow/media/" + name
}

// mimeByExt maps the media file extension to a browser-renderable type.
func mimeByExt(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".mp4":
		return "video/mp4"
	case ".3gp":
		return "video/3gpp"
	case ".ogg", ".oga", ".opus":
		return "audio/ogg"
	case ".mp3":
		return "audio/mpeg"
	case ".m4a", ".aac":
		return "audio/mp4"
	case ".pdf":
		return "application/pdf"
	}
	return ""
}

func (h *Handler) registerLiveChatExtras(mux *http.ServeMux) {
	mux.HandleFunc("/api/rainbow/conversations/events", h.auth(h.conversationEvents))
	mux.HandleFunc("/api/rainbow/media/", h.auth(h.mediaProxy))
	mux.HandleFunc("/api/rainbow/whatsapp/avatar/", h.auth(h.avatarProxy))
}

// conversationEvents streams new_message events for the caller's profile.
// EventSource cannot send custom headers, so the SPA passes ?profile=<id>;
// tenant-scoped sessions are still confined to their allowed tenants.
func (h *Handler) conversationEvents(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, 500, map[string]any{"error": "streaming unsupported"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "event: init\ndata: {\"profile\":%q}\n\n", want)
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
			if ev.ProfileID != "" && ev.ProfileID != want {
				continue
			}
			b, _ := json.Marshal(ev)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, b)
			flusher.Flush()
		}
	}
}

// mediaProxy serves GET /api/rainbow/media/{file} from the bridge's media
// store (which is bound to localhost only), so the dashboard can render
// inbound photos/voice notes/documents inline.
func (h *Handler) mediaProxy(w http.ResponseWriter, r *http.Request) {
	name := path.Base(strings.TrimPrefix(r.URL.Path, "/api/rainbow/media/"))
	if !mediaNameRe.MatchString(name) || name == "." {
		writeJSON(w, 400, map[string]any{"error": "invalid media name"})
		return
	}
	profileID, _ := h.reqProfile(r)
	base := h.bridgeURLFor(profileID)
	if base == "" {
		writeJSON(w, 404, map[string]any{"error": "no bridge configured"})
		return
	}
	// Ownership: only media referenced by a message row visible to this
	// profile may be fetched (no enumeration of the bridge store).
	if !h.ownsMedia(name, profileID) {
		writeJSON(w, 404, map[string]any{"error": "media not found"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/media/"+name, nil)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": "bridge unreachable"})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		writeJSON(w, resp.StatusCode, map[string]any{"error": "media not found"})
		return
	}
	// The bridge serves files as application/octet-stream; infer the real type
	// from the extension so <img>/<audio>/<video> render inline.
	ct := mimeByExt(name)
	if ct == "" {
		ct = resp.Header.Get("Content-Type")
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	_, _ = io.Copy(w, resp.Body)
}

var avatarJidRe = regexp.MustCompile(`^[0-9A-Za-z._:-]{1,64}(@(s\.whatsapp\.net|lid|g\.us))?$`)

// avatarProxy serves GET /api/rainbow/whatsapp/avatar/{jid} — the contact's
// WhatsApp profile picture via the profile's bridge. The jid may be a bare
// number (→ @s.whatsapp.net) or a full JID (@lid peers). Only conversations
// visible to the requesting profile can be looked up (no directory scraping).
func (h *Handler) avatarProxy(w http.ResponseWriter, r *http.Request) {
	jid := strings.TrimPrefix(r.URL.Path, "/api/rainbow/whatsapp/avatar/")
	if u, err := url.PathUnescape(jid); err == nil {
		jid = u
	}
	jid = strings.TrimSpace(jid)
	if !avatarJidRe.MatchString(jid) {
		writeJSON(w, 400, map[string]any{"error": "invalid jid"})
		return
	}
	if !strings.Contains(jid, "@") {
		jid += "@s.whatsapp.net"
	}
	profileID, _ := h.reqProfile(r)
	// Conversation keys are stored as full JIDs (or bare numbers for legacy rows).
	if !h.ownsConversation([]string{jid, strings.Split(jid, "@")[0]}, profileID) {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	// The profile's own bridge first, then every other linked number: a
	// WhatsApp account that was restricted earlier (pelangi/senai, 2026-09)
	// times out on picture lookups for non-contacts while a fresh account
	// answers in <0.5 s. The picture is the same whichever account asks.
	bases := []string{}
	if own := h.bridgeURLFor(profileID); own != "" {
		bases = append(bases, own)
	}
	snap := h.instanceSnapshot()
	for _, id := range sortedIDs(snap) {
		if u := snap[id].URL; u != "" && (len(bases) == 0 || u != bases[0]) {
			bases = append(bases, u)
		}
	}
	if len(bases) == 0 {
		writeJSON(w, 404, map[string]any{"error": "no bridge configured"})
		return
	}
	var resp *http.Response
	for _, base := range bases {
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/avatar/"+url.PathEscape(jid), nil)
		if err != nil {
			cancel()
			continue
		}
		rs, err := http.DefaultClient.Do(req)
		if err != nil {
			cancel()
			continue
		}
		if rs.StatusCode == 200 {
			resp = rs
			defer cancel()
			break
		}
		rs.Body.Close()
		cancel()
	}
	if resp == nil {
		w.Header().Set("Cache-Control", "private, max-age=600")
		writeJSON(w, 404, map[string]any{"error": "no avatar"})
		return
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image/") {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	_, _ = io.Copy(w, resp.Body)
}

// logIndex returns the chronological log (same ordering the SPA renders) so a
// message index from the UI can be resolved to a stable rainbow_messages.id.
func (h *Handler) logIndex(phone, profileID string) ([]logMsg, error) {
	return h.fetchLog([]string{phone}, 500, profileID)
}

// messageMetadata serves GET .../{phone}/message-metadata →
// {pinned:[idx], starred:[idx], reactions:{idx:emoji}} with idx as strings
// (the SPA compares against data-msg-idx attributes).
func (h *Handler) messageMetadata(w http.ResponseWriter, r *http.Request, phone string) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	if !h.ownsConversation([]string{phone}, profileID) {
		writeJSON(w, 404, map[string]any{"error": "conversation not found"})
		return
	}
	out := map[string]any{"pinned": []string{}, "starred": []string{}, "reactions": map[string]string{}}
	if err := h.ensureMetaTable(); err != nil {
		writeJSON(w, 200, out)
		return
	}
	log, err := h.logIndex(phone, profileID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	idToIdx := make(map[int64]int, len(log))
	for i, m := range log {
		idToIdx[m.ID] = i
	}
	rows, err := h.st.DB.Query(`SELECT message_id, kind, COALESCE(value,'') FROM rainbow_message_meta WHERE profile_id=? AND phone=?`, h.effProfile(profileID), phone)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	pinned, starred := []string{}, []string{}
	reactions := map[string]string{}
	byID := map[string]map[string]any{} // stable keys for the SPA (data-msg-key = id)
	for rows.Next() {
		var id int64
		var kind, value string
		if rows.Scan(&id, &kind, &value) != nil {
			continue
		}
		idx, ok := idToIdx[id]
		if !ok {
			continue
		}
		s := strconv.Itoa(idx)
		k := strconv.FormatInt(id, 10)
		if byID[k] == nil {
			byID[k] = map[string]any{}
		}
		switch kind {
		case "pin":
			pinned = append(pinned, s)
			byID[k]["pinned"] = true
		case "star":
			starred = append(starred, s)
			byID[k]["starred"] = true
		case "react":
			if value != "" {
				reactions[s] = value
				byID[k]["reaction"] = value
			}
		}
	}
	out["pinned"], out["starred"], out["reactions"], out["byId"] = pinned, starred, reactions, byID
	writeJSON(w, 200, out)
}

// messageAction handles POST .../{phone}/messages/{idx}/{pin|star|react}.
// pin/star toggle; react sets (or clears, with empty emoji) the staff reaction.
func (h *Handler) messageAction(w http.ResponseWriter, r *http.Request, phone, idxStr, action string) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	if !h.ownsConversation([]string{phone}, profileID) {
		writeJSON(w, 404, map[string]any{"error": "conversation not found"})
		return
	}
	if err := h.ensureMetaTable(); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	// Body is shared by all actions: {emoji?, messageId?}. messageId (stable
	// rainbow_messages.id) wins over the positional idx, which can shift when a
	// message arrives between render and click.
	var body struct {
		Emoji     string `json:"emoji"`
		MessageID int64  `json:"messageId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if q := r.URL.Query().Get("id"); q != "" && body.MessageID == 0 {
		body.MessageID, _ = strconv.ParseInt(q, 10, 64)
	}
	var msgID int64
	if body.MessageID > 0 {
		cond, carg := h.profCond("m", profileID)
		var n int
		_ = h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages m WHERE m.id=? AND m.phone=? AND (m.deleted_at IS NULL OR m.deleted_at='') AND `+cond, body.MessageID, phone, carg).Scan(&n)
		if n == 0 {
			writeJSON(w, 404, map[string]any{"error": "message not found"})
			return
		}
		msgID = body.MessageID
	} else {
		idx, err := strconv.Atoi(idxStr)
		if err != nil || idx < 0 {
			writeJSON(w, 400, map[string]any{"error": "invalid message index"})
			return
		}
		log, err := h.logIndex(phone, profileID)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		if idx >= len(log) {
			writeJSON(w, 404, map[string]any{"error": "message not found"})
			return
		}
		msgID = log[idx].ID
	}
	prof := h.effProfile(profileID)
	now := time.Now().UnixMilli()
	var err error

	switch action {
	case "pin", "star":
		var n int
		_ = h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_message_meta WHERE profile_id=? AND phone=? AND message_id=? AND kind=?`, prof, phone, msgID, action).Scan(&n)
		on := n == 0
		if on {
			_, err = h.st.DB.Exec(`INSERT OR REPLACE INTO rainbow_message_meta (profile_id, phone, message_id, kind, value, updated_at) VALUES (?,?,?,?,?,?)`, prof, phone, msgID, action, "1", now)
		} else {
			_, err = h.st.DB.Exec(`DELETE FROM rainbow_message_meta WHERE profile_id=? AND phone=? AND message_id=? AND kind=?`, prof, phone, msgID, action)
		}
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		key := "pinned"
		if action == "star" {
			key = "starred"
		}
		writeJSON(w, 200, map[string]any{"ok": true, key: on, "messageId": msgID})
	case "react":
		emoji := strings.TrimSpace(body.Emoji)
		if len(emoji) > 16 {
			writeJSON(w, 400, map[string]any{"error": "invalid emoji"})
			return
		}
		if emoji == "" {
			_, err = h.st.DB.Exec(`DELETE FROM rainbow_message_meta WHERE profile_id=? AND phone=? AND message_id=? AND kind='react'`, prof, phone, msgID)
		} else {
			_, err = h.st.DB.Exec(`INSERT OR REPLACE INTO rainbow_message_meta (profile_id, phone, message_id, kind, value, updated_at) VALUES (?,?,?,'react',?,?)`, prof, phone, msgID, emoji, now)
		}
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		// Note: the Baileys bridge has no reaction op yet, so the reaction is
		// recorded for the dashboard only (the guest does not see it on WhatsApp).
		writeJSON(w, 200, map[string]any{"ok": true, "emoji": emoji, "messageId": msgID, "delivered": false})
	default:
		writeJSON(w, 404, map[string]any{"error": "unknown action"})
	}
}

// ownsMedia reports whether a media file name is referenced by a message row
// visible to profileID (default profile also owns legacy NULL/'' rows).
func (h *Handler) ownsMedia(name, profileID string) bool {
	if !h.hasMsgCol("media_url") {
		return false
	}
	cond, carg := h.profCond("m", profileID)
	var n int
	err := h.st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages m WHERE m.media_url LIKE ? AND (m.deleted_at IS NULL OR m.deleted_at='') AND `+cond,
		"%/media/"+name, carg).Scan(&n)
	return err == nil && n > 0
}
