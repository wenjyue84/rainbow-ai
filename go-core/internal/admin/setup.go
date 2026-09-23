package admin

import (
	"net/http"
	"strings"

	"rainbow-core/internal/config"
	"rainbow-core/internal/kb"
)

// Setup wizard support (2026-09-23).
//
//	GET /api/rainbow/setup/status?profile=<id>
//	  → {profile, exists, profileActive, businessName, botName,
//	     instance: {id,state,user,canManage,label} | null,
//	     kbFiles: n, hasLogin: bool, replyMode: <effective>, hubConfigured}
//
// One call that tells the wizard (js/modules/setup.js) which steps are already
// done so it can resume where the user left off. Everything else the wizard
// does reuses existing routes: POST /profiles/blank, POST /whatsapp/instances,
// GET /whatsapp/instances/{id}/qr, PUT /kb-files/<file>, PUT /settings/reply-mode,
// POST /chat, POST /admin-users.

// ProfileActivator hot-loads a freshly created profile (wired from main:
// config.Load + RAG + NewEngine + hub.AddEngine). nil = restart needed.
type ProfileActivator func(profileID string) error

// SetProfileActivator installs the hot-load callback.
func (h *Handler) SetProfileActivator(f ProfileActivator) { h.profileActivator = f }

// addProfileID appends a served profile id (dedupe) so /profiles, reqProfile
// and the scoped checks see it immediately.
func (h *Handler) addProfileID(id string) {
	for _, p := range h.profileIDs {
		if p == id {
			return
		}
	}
	h.profileIDs = append(h.profileIDs, id)
}

func (h *Handler) servesProfile(id string) bool {
	if id == h.defaultProfile {
		return true
	}
	for _, p := range h.profileIDs {
		if p == id {
			return true
		}
	}
	return false
}

// profileHasLogin reports whether any dashboard user is scoped to the profile.
func (h *Handler) profileHasLogin(profile string) bool {
	if h.st == nil || h.st.DB == nil {
		return false
	}
	rows, err := h.st.DB.Query(`SELECT allowed_tenants FROM admin_users WHERE allowed_tenants IS NOT NULL AND allowed_tenants != ''`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var raw *string
		if rows.Scan(&raw) != nil {
			continue
		}
		for _, t := range parseTenants(raw) {
			if t == profile {
				return true
			}
		}
	}
	return false
}

// setupStatus serves GET /api/rainbow/setup/status.
func (h *Handler) setupStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	profile := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("profile")))
	if profile == "" {
		profile = strings.ToLower(strings.TrimSpace(r.Header.Get("x-profile-id")))
	}
	if profile == "" {
		profile = h.defaultProfile
	}
	if !profileIDRe.MatchString(profile) {
		writeJSON(w, 400, map[string]any{"error": "invalid profile id"})
		return
	}
	if sess := sessionFrom(r); sess != nil && !sess.Allows(profile) {
		writeJSON(w, 403, map[string]any{"error": "forbidden: not authorized for this tenant"})
		return
	}
	exists := h.profileExists(profile)
	out := map[string]any{
		"profile":       profile,
		"exists":        exists,
		"profileActive": h.servesProfile(profile),
		"instance":      nil,
		"kbFiles":       0,
		"hasLogin":      false,
		"replyMode":     "",
		"businessName":  "",
		"botName":       "",
		"hubConfigured": engineURL() != "",
	}
	if !exists {
		writeJSON(w, 200, out)
		return
	}
	out["businessName"] = config.BusinessName(h.dataDir, profile)
	settings := map[string]any{}
	_ = h.readDataJSON(h.settingsFileFor(profile), &settings)
	out["botName"] = str(settings, "bot_name")
	mode := str(settings, "reply_mode")
	if mode == "" {
		if master, ok := config.LoadMaster(h.dataDir); ok && master.ReplyMode != "" {
			mode = master.ReplyMode
		} else {
			mode = "normal"
		}
	}
	out["replyMode"] = mode
	if list := h.listInstances(r.Context(), nil, profile); len(list) > 0 {
		it := list[0]
		user := ""
		if it.User != nil {
			user, _ = it.User["phone"].(string)
		}
		out["instance"] = map[string]any{"id": it.ID, "state": it.State, "user": user, "canManage": it.CanManage, "label": it.Label}
	}
	if dir, ok := h.kbDir(profile); ok {
		if files, err := kb.List(dir); err == nil {
			out["kbFiles"] = len(files)
		}
	}
	out["hasLogin"] = h.profileHasLogin(profile)
	writeJSON(w, 200, out)
}
