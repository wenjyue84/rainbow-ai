package admin

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"rainbow-core/internal/kb"
)

// KBReloader re-indexes one profile's KB directory and swaps it into the
// running engine. Returns the chunk count. An error means the file is saved
// but the engine still serves the old index (restart picks it up).
type KBReloader func(profileID string) (int, error)

// SetKB wires the KB root, the script-facing Bearer token and the reloader.
func (h *Handler) SetKB(root, token string, reload KBReloader) {
	h.kbRoot = strings.TrimSpace(root)
	h.kbToken = strings.TrimSpace(token)
	h.kbReloader = reload
}

// kbTokenAuth guards /api/kb/* with `Authorization: Bearer $KB_API_TOKEN`.
// Deliberately NOT h.auth: scripts (Ramli-Knowledge.ps1) hold only this
// token, never an admin session; and the browser never holds this token —
// the SPA goes through the session-authed /api/rainbow/kb-files/* twins.
func (h *Handler) kbTokenAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.kbToken == "" {
			writeJSON(w, 503, map[string]any{"error": "KB API disabled (KB_API_TOKEN not set)"})
			return
		}
		got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(h.kbToken)) != 1 {
			writeJSON(w, 401, map[string]any{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

var kbProfileRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)

func (h *Handler) kbDir(profile string) (string, bool) {
	if h.kbRoot == "" || !kbProfileRe.MatchString(profile) {
		return "", false
	}
	return kb.DirFor(h.kbRoot, profile), true
}

// kbAPI serves the token-authed script API:
//
//	GET  /api/kb/{profile}                  → {"profile","files":[{name,size,modified}],"strict":bool}
//	GET  /api/kb/{profile}/stale?days=90    → {"entries":[{file,title,as_of,review_by,why}]}
//	GET  /api/kb/{profile}/{file.md}        → {"name","content"}
//	PUT  /api/kb/{profile}/{file.md}        {"content"} → {"ok","backup","chunks","applied"}
//	POST /api/kb/{profile}/{file.md}/append {"title","as_of","source","review_by","body"}
//	                                        or {"entry":"<raw markdown block>"}
//
// Strict profiles (kb.Strict) validate every write: as_of + source required,
// money / deposit / payment-state content → 422 "belongs in senai.wenjyue.com".
func (h *Handler) kbAPI(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/kb/"), "/")
	parts := strings.SplitN(rest, "/", 2)
	profile := strings.ToLower(parts[0])
	dir, ok := h.kbDir(profile)
	if !ok {
		writeJSON(w, 404, map[string]any{"error": "unknown profile or KB root not configured"})
		return
	}
	if len(parts) == 1 || parts[1] == "" {
		if r.Method != http.MethodGet {
			writeJSON(w, 405, map[string]any{"error": "method not allowed"})
			return
		}
		files, err := kb.List(dir)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"profile": profile, "dir": dir, "files": files, "strict": kb.Strict(profile)})
		return
	}
	name := parts[1]
	if name == "stale" && r.Method == http.MethodGet {
		h.kbStale(w, r, dir)
		return
	}
	appendMode := false
	if strings.HasSuffix(name, "/append") {
		appendMode = true
		name = strings.TrimSuffix(name, "/append")
	}
	h.kbFileOp(w, r, profile, dir, name, appendMode)
}

// kbFileOp is shared by the token API and the SPA twin.
func (h *Handler) kbFileOp(w http.ResponseWriter, r *http.Request, profile, dir, name string, appendMode bool) {
	switch {
	case r.Method == http.MethodGet && !appendMode:
		content, err := kb.Read(dir, name)
		if errors.Is(err, os.ErrNotExist) {
			writeJSON(w, 404, map[string]any{"error": name + " not found"})
			return
		}
		if err != nil {
			writeJSON(w, 400, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"name": name, "content": content})

	case r.Method == http.MethodPut && !appendMode:
		var body struct {
			Content *string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == nil {
			writeJSON(w, 400, map[string]any{"error": "content required"})
			return
		}
		// README.md is the operator-facing rule sheet (never indexed by rag) and
		// legitimately spells out the forbidden words — exempt it.
		if kb.Strict(profile) && !strings.EqualFold(name, "README.md") {
			if verr := kb.Validate(*body.Content); verr != nil {
				kbReject(w, verr)
				return
			}
		}
		backup, err := kb.Write(dir, name, *body.Content)
		if err != nil {
			writeJSON(w, 400, map[string]any{"error": err.Error()})
			return
		}
		chunks, applied := h.kbReload(profile)
		log.Printf("[kb] %s/%s written (%d bytes) backup=%q chunks=%d applied=%v", profile, name, len(*body.Content), backup, chunks, applied)
		writeJSON(w, 200, map[string]any{"ok": true, "name": name, "backup": backup, "chunks": chunks, "applied": applied})

	case r.Method == http.MethodPost && appendMode:
		var body struct {
			Entry    string `json:"entry"`
			Title    string `json:"title"`
			AsOf     string `json:"as_of"`
			Source   string `json:"source"`
			ReviewBy string `json:"review_by"`
			Body     string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"error": "invalid JSON"})
			return
		}
		entry := strings.TrimSpace(body.Entry)
		if entry == "" {
			if body.Title == "" || body.Body == "" {
				writeJSON(w, 400, map[string]any{"error": "entry, or title + as_of + source + body, required"})
				return
			}
			if body.AsOf == "" {
				body.AsOf = time.Now().In(myt).Format("2006-01-02")
			}
			entry = kb.Entry(body.Title, body.AsOf, body.Source, body.ReviewBy, body.Body)
		}
		if kb.Strict(profile) {
			if verr := kb.Validate(entry); verr != nil {
				kbReject(w, verr)
				return
			}
		}
		if err := kb.Append(dir, name, entry); err != nil {
			writeJSON(w, 400, map[string]any{"error": err.Error()})
			return
		}
		chunks, applied := h.kbReload(profile)
		log.Printf("[kb] %s/%s appended (%d bytes) chunks=%d applied=%v", profile, name, len(entry), chunks, applied)
		writeJSON(w, 200, map[string]any{"ok": true, "name": name, "entry": entry, "chunks": chunks, "applied": applied})

	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

var myt = time.FixedZone("MYT", 8*3600)

func kbReject(w http.ResponseWriter, err error) {
	var ve *kb.ValidationError
	if errors.As(err, &ve) {
		writeJSON(w, 422, map[string]any{"error": ve.Reason, "code": ve.Code, "match": ve.Match,
			"hint": "numbers, deposits and paid/unpaid state live only in senai.wenjyue.com; the KB keeps soft, one-off, interpersonal knowledge"})
		return
	}
	writeJSON(w, 422, map[string]any{"error": err.Error()})
}

func (h *Handler) kbReload(profile string) (int, bool) {
	if h.kbReloader == nil {
		return 0, false
	}
	n, err := h.kbReloader(profile)
	if err != nil {
		log.Printf("[kb] reload %s: %v", profile, err)
		return n, false
	}
	return n, true
}

func (h *Handler) kbStale(w http.ResponseWriter, r *http.Request, dir string) {
	days := 90
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := parseIntDefault(v, 90); err == nil && n > 0 {
			days = n
		}
	}
	today := time.Now().In(myt)
	entries, err := kb.Stale(dir, time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, myt), time.Duration(days)*24*time.Hour)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"today": today.Format("2006-01-02"), "maxAgeDays": days, "entries": entries})
}

func parseIntDefault(s string, def int) (int, error) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return def, errors.New("not a number")
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}

// ── SPA twins (session auth, profile from x-profile-id) ────────────────────

func (h *Handler) kbUIDir(w http.ResponseWriter, r *http.Request) (profile, dir string, ok bool) {
	pid, err := h.effectiveProfile(r)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return "", "", false
	}
	dir, ok = h.kbDir(pid)
	if !ok {
		writeJSON(w, 404, map[string]any{"error": "KB root not configured"})
		return "", "", false
	}
	return pid, dir, true
}

// kbFilesUI serves GET /api/rainbow/kb-files and GET|PUT /api/rainbow/kb-files/{name}
// for the dashboard KB editor (kb-editor.js). Same storage + validation as /api/kb.
func (h *Handler) kbFilesUI(w http.ResponseWriter, r *http.Request) {
	profile, dir, ok := h.kbUIDir(w, r)
	if !ok {
		return
	}
	name := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/rainbow/kb-files"), "/")
	if name == "" {
		if r.Method != http.MethodGet {
			writeJSON(w, 405, map[string]any{"error": "method not allowed"})
			return
		}
		files, err := kb.List(dir)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"profile": profile, "files": files, "strict": kb.Strict(profile)})
		return
	}
	h.kbFileOp(w, r, profile, dir, name, false)
}

// kbStaleUI serves GET /api/rainbow/kb-stale?days=90 for the dashboard.
func (h *Handler) kbStaleUI(w http.ResponseWriter, r *http.Request) {
	_, dir, ok := h.kbUIDir(w, r)
	if !ok {
		return
	}
	h.kbStale(w, r, dir)
}

var memoryDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// kbMemoryUI serves GET /api/rainbow/memory → {"days":[...]} and
// GET|PUT /api/rainbow/memory/{YYYY-MM-DD} over <kbDir>/memory/<date>.md.
func (h *Handler) kbMemoryUI(w http.ResponseWriter, r *http.Request) {
	profile, dir, ok := h.kbUIDir(w, r)
	if !ok {
		return
	}
	date := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/rainbow/memory"), "/")
	if date == "" {
		files, err := kb.List(dir)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		days := []string{}
		for _, f := range files {
			if strings.HasPrefix(f.Name, "memory/") {
				days = append(days, strings.TrimSuffix(strings.TrimPrefix(f.Name, "memory/"), ".md"))
			}
		}
		// newest first
		for i, j := 0, len(days)-1; i < j; i, j = i+1, j-1 {
			days[i], days[j] = days[j], days[i]
		}
		writeJSON(w, 200, map[string]any{"days": days})
		return
	}
	if !memoryDateRe.MatchString(date) {
		writeJSON(w, 400, map[string]any{"error": "date must be YYYY-MM-DD"})
		return
	}
	h.kbFileOp(w, r, profile, dir, "memory/"+date+".md", false)
}
