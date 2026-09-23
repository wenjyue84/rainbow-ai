package admin

// Observer visibility matrix (2026-09-08): lets one profile (e.g. jayson-pa,
// Jay's PA) READ conversations belonging to other profiles without being able
// to write to them. Config lives at <dataDir>/visibility.json:
//
//	{"observers": {"jayson-pa": ["pelangi", "senai-app", "southern"]}}
//
// "*" in the list means "every profile the hub knows about". The file is
// optional — its absence means no observers, same as today.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"
)

const visibilityFile = "visibility.json"

type visibilityDoc struct {
	Observers map[string][]string `json:"observers"`
}

// visibilityState caches the parsed file with a short mtime-based TTL so a
// hot path (every /conversations/unified call) doesn't stat + reparse on
// every request, while still picking up an admin edit within a few seconds.
type visibilityState struct {
	mu       sync.RWMutex
	doc      visibilityDoc
	modTime  time.Time
	lastStat time.Time
}

// loadVisibility re-stats the file at most once per 5s and reparses only when
// its mtime changed. Missing file (or dataDir unset) → empty doc, no error.
func (h *Handler) loadVisibility() visibilityDoc {
	if h.dataDir == "" {
		return visibilityDoc{}
	}
	vs := &h.visibility
	vs.mu.RLock()
	fresh := time.Since(vs.lastStat) < 5*time.Second
	doc := vs.doc
	vs.mu.RUnlock()
	if fresh {
		return doc
	}

	vs.mu.Lock()
	defer vs.mu.Unlock()
	// Re-check under the write lock — another goroutine may have refreshed
	// while we were waiting.
	if time.Since(vs.lastStat) < 5*time.Second {
		return vs.doc
	}
	vs.lastStat = time.Now()

	path := filepath.Join(h.dataDir, visibilityFile)
	info, err := os.Stat(path)
	if err != nil {
		vs.doc = visibilityDoc{}
		vs.modTime = time.Time{}
		return vs.doc
	}
	if info.ModTime().Equal(vs.modTime) {
		return vs.doc
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return vs.doc
	}
	var d visibilityDoc
	if err := json.Unmarshal(b, &d); err != nil {
		return vs.doc
	}
	vs.doc = d
	vs.modTime = info.ModTime()
	return vs.doc
}

// ObservedBy returns the ids of OTHER profiles the given profile may read
// (never itself), resolving "*" against the hub's known profile registry.
// Empty when profile is not an observer or has nothing configured.
func (h *Handler) ObservedBy(profile string) []string {
	if profile == "" {
		profile = h.defaultProfile
	}
	doc := h.loadVisibility()
	list, ok := doc.Observers[profile]
	if !ok || len(list) == 0 {
		return nil
	}
	star := false
	set := map[string]bool{}
	for _, p := range list {
		if p == "*" {
			star = true
			continue
		}
		if p != "" && p != profile {
			set[p] = true
		}
	}
	if star {
		for _, p := range h.knownProfiles() {
			if p != profile {
				set[p] = true
			}
		}
	}
	if len(set) == 0 {
		return nil
	}
	out := make([]string, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	return out
}

// IsObserver reports whether profile has any observer grant.
func (h *Handler) IsObserver(profile string) bool {
	return len(h.ObservedBy(profile)) > 0
}

// knownProfiles returns every profile id the hub knows about, including the
// default profile (h.profileIDs holds only the served ids; ensure default is
// present too since callers may resolve "*" before SetProfiles ran in tests).
func (h *Handler) knownProfiles() []string {
	def := h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	seen := map[string]bool{def: true}
	out := []string{def}
	for _, p := range h.profileIDs {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	// Also fold in any profile referenced by the instance registry, in case
	// SetProfiles was never called with the full set (tests, single-instance).
	for _, ib := range h.instanceSnapshot() {
		if ib.Profile != "" && !seen[ib.Profile] {
			seen[ib.Profile] = true
			out = append(out, ib.Profile)
		}
	}
	return out
}

// observeRow is one message on the observer feed.
type observeRow struct {
	Profile string `json:"profile"`
	Phone   string `json:"phone"`
	Role    string `json:"role"`
	Text    string `json:"text"`
	Ts      int64  `json:"ts"`
	Source  string `json:"source,omitempty"`
	ID      int64  `json:"id"`
}

// observe serves GET /api/rainbow/observe?since=<epoch ms>&limit=<n> — a flat
// feed of messages from every profile the caller observes (visibility.go),
// EXCLUDING its own profile's messages (those already show in its normal
// live-chat views). 403 for a caller with no observer grant.
func (h *Handler) observe(w http.ResponseWriter, r *http.Request) {
	profileID, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}
	observed := h.ObservedBy(profileID)
	if len(observed) == 0 {
		writeJSON(w, 403, map[string]any{"error": "not an observer"})
		return
	}

	sinceMs := int64(0)
	if v := r.URL.Query().Get("since"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			sinceMs = n
		}
	}
	limit := queryInt(r, "limit", 200)
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}

	placeholders := make([]string, len(observed))
	args := make([]any, 0, len(observed)+3)
	for i, p := range observed {
		placeholders[i] = "?"
		args = append(args, p)
	}
	sinceISO := ""
	if sinceMs > 0 {
		sinceISO = time.UnixMilli(sinceMs).UTC().Format("2006-01-02T15:04:05.000Z")
	}
	args = append(args, sinceISO, sinceISO, limit)
	rows, err := h.st.DB.Query(`
		SELECT m.id, COALESCE(m.profile_id,''), m.phone, m.role, m.content,
		       COALESCE(CAST(m.timestamp AS TEXT),''), COALESCE(m.source,'')
		FROM rainbow_messages m
		WHERE m.profile_id IN (`+joinPlaceholders(placeholders)+`)
		AND (m.deleted_at IS NULL OR m.deleted_at='')
		AND (? = '' OR CAST(m.timestamp AS TEXT) > ?)
		ORDER BY CAST(m.timestamp AS TEXT) ASC LIMIT ?`,
		args...)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	out := []observeRow{}
	for rows.Next() {
		var id int64
		var profile, phone, role, content, ts, source string
		if err := rows.Scan(&id, &profile, &phone, &role, &content, &ts, &source); err != nil {
			continue
		}
		if profile == "" {
			continue // legacy default-profile rows have no profile_id to observe by
		}
		if len(content) > 2000 {
			content = content[:2000]
		}
		out = append(out, observeRow{
			Profile: profile, Phone: phone, Role: role, Text: content,
			Ts: tsToMillis(ts), Source: source, ID: id,
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Ts < out[j].Ts })
	writeJSON(w, 200, map[string]any{
		"since": sinceMs, "now": time.Now().UnixMilli(),
		"count": len(out), "messages": out,
	})
}

func joinPlaceholders(ph []string) string {
	s := ""
	for i, p := range ph {
		if i > 0 {
			s += ","
		}
		s += p
	}
	return s
}
