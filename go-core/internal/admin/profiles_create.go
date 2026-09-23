package admin

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Profile creation for the SPA wizard (profile-switcher.js wizardCreate).
//
//	POST /api/rainbow/profiles/blank            {newProfileId, displayName}
//	POST /api/rainbow/profiles/{source}/clone   {newProfileId, displayName}
//
// These were Node-only routes; with the Node engine retired the wizard hit
// the SPA fallback / 404 text and the browser reported "Unexpected
// non-whitespace character after JSON at position 4" (the body was
// "404 page not found").
//
// go-core keeps every profile's config in ONE data dir as <file>-<id>.json
// (config.Load picks intents-<id>.json before intents.json etc.), so creating
// a profile means writing that file set plus registering the id in
// <dataDir>/profiles.json, which main reads at boot to decide which profiles
// to serve. The wizard already tells the user to restart to activate.

const profileRegistryFile = "profiles.json"

// cloneFiles are the per-profile files config.Load reads (in load order).
var cloneFiles = []string{"intents.json", "intent-keywords.json", "knowledge.json", "routing.json", "llm-settings.json", "settings.json"}

// blankScaffold is a valid-but-empty document per file.
var blankScaffold = map[string]string{
	"intents.json":         "{\n  \"categories\": []\n}\n",
	"intent-keywords.json": "{\n  \"intents\": []\n}\n",
	"knowledge.json":       "{}\n",
	"routing.json":         "{}\n",
}

// settingsStripFields are WhatsApp/tenant-bound keys never copied on clone.
var settingsStripFields = []string{"whatsappInstanceId", "whatsappPhoneNumber", "ignoredNumbers"}

var newProfileIDRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

type registryProfile struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	Source    string `json:"source,omitempty"` // "blank" or the cloned profile id
	CreatedAt string `json:"createdAt,omitempty"`
}

type profileRegistry struct {
	Profiles []registryProfile `json:"profiles"`
}

func (reg profileRegistry) nameOr(id, fallback string) string {
	for _, p := range reg.Profiles {
		if p.ID == id && strings.TrimSpace(p.Name) != "" {
			return p.Name
		}
	}
	return fallback
}

func readProfileRegistryDir(dataDir string) profileRegistry {
	var reg profileRegistry
	if dataDir == "" {
		return reg
	}
	b, err := os.ReadFile(filepath.Join(dataDir, profileRegistryFile))
	if err != nil {
		return reg
	}
	_ = json.Unmarshal(b, &reg)
	return reg
}

func (h *Handler) readProfileRegistry() profileRegistry { return readProfileRegistryDir(h.dataDir) }

func (h *Handler) writeProfileRegistry(reg profileRegistry) error {
	return h.writeDataJSON(profileRegistryFile, reg)
}

// ExtraProfileIDs returns the enabled ids registered by the wizard so main can
// serve them alongside RAINBOW_PROFILE + PROFILE_INSTANCES.
func ExtraProfileIDs(dataDir string) []string {
	var out []string
	for _, p := range readProfileRegistryDir(dataDir).Profiles {
		if p.Enabled && newProfileIDRe.MatchString(p.ID) {
			out = append(out, p.ID)
		}
	}
	return out
}

func (h *Handler) profileExists(id string) bool {
	for _, p := range h.profileIDs {
		if p == id {
			return true
		}
	}
	if id == h.defaultProfile {
		return true
	}
	for _, p := range h.readProfileRegistry().Profiles {
		if p.ID == id {
			return true
		}
	}
	return false
}

// profilesCreate dispatches the /api/rainbow/profiles/ subtree.
func (h *Handler) profilesCreate(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/rainbow/profiles/"), "/")
	source := ""
	switch {
	case rest == "blank":
	case strings.HasSuffix(rest, "/clone") && strings.Count(rest, "/") == 1:
		source = strings.TrimSuffix(rest, "/clone")
	default:
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if h.dataDir == "" {
		writeJSON(w, 501, map[string]any{"error": "profile creation unavailable: no data dir"})
		return
	}
	if sess := sessionFrom(r); sess != nil && sess.Scoped() {
		writeJSON(w, 403, map[string]any{"error": "forbidden: tenant users cannot create profiles"})
		return
	}
	var in struct {
		NewProfileID string `json:"newProfileId"`
		DisplayName  string `json:"displayName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON body"})
		return
	}
	id := strings.ToLower(strings.TrimSpace(in.NewProfileID))
	name := strings.TrimSpace(in.DisplayName)
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "newProfileId is required (string)"})
		return
	}
	if name == "" {
		writeJSON(w, 400, map[string]any{"error": "displayName is required (string)"})
		return
	}
	if !newProfileIDRe.MatchString(id) || len(id) > 40 {
		writeJSON(w, 400, map[string]any{"error": "newProfileId must be lowercase alphanumeric with hyphens (e.g., \"my-new-profile\")"})
		return
	}
	if h.profileExists(id) {
		writeJSON(w, 409, map[string]any{"error": "Profile \"" + id + "\" already exists"})
		return
	}
	if source != "" && !h.profileExists(source) {
		writeJSON(w, 404, map[string]any{"error": "Source profile \"" + source + "\" not found"})
		return
	}

	def := h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	copied := []string{}
	for _, f := range cloneFiles {
		dst := filepath.Join(h.dataDir, profileVariant(f, id))
		var content []byte
		if source != "" {
			// Source's own variant first; the default profile owns the unsuffixed file.
			cands := []string{filepath.Join(h.dataDir, profileVariant(f, source))}
			if source == def {
				cands = append(cands, filepath.Join(h.dataDir, f))
			}
			for _, c := range cands {
				if b, err := os.ReadFile(c); err == nil {
					content = b
					break
				}
			}
			if content == nil {
				continue // source has no such file → inherit the shared default at load time
			}
		} else {
			s, ok := blankScaffold[f]
			if !ok && f != "settings.json" {
				continue // llm-settings: fall back to shared defaults
			}
			content = []byte(s)
		}
		if f == "settings.json" {
			doc := map[string]any{}
			if len(content) > 0 {
				_ = json.Unmarshal(content, &doc)
			}
			for _, k := range settingsStripFields {
				delete(doc, k)
			}
			doc["businessName"] = name
			if _, ok := doc["bot_name"]; !ok {
				// The bot introduces itself by the profile's first name
				// ("Jayson - Jay's PA" → "Jayson"); "Rainbow" only when empty.
				bot := "Rainbow"
				if f := strings.Fields(name); len(f) > 0 {
					bot = f[0]
				}
				doc["bot_name"] = bot
			}
			b, _ := json.MarshalIndent(doc, "", "  ")
			content = append(b, '\n')
		}
		if err := os.WriteFile(dst, content, 0o644); err != nil {
			log.Printf("[admin] profile create: write %s: %v", dst, err)
			writeJSON(w, 500, map[string]any{"error": "failed to write " + filepath.Base(dst)})
			return
		}
		copied = append(copied, f)
	}

	reg := h.readProfileRegistry()
	src := "blank"
	if source != "" {
		src = source
	}
	reg.Profiles = append(reg.Profiles, registryProfile{ID: id, Name: name, Enabled: true, Source: src, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	if err := h.writeProfileRegistry(reg); err != nil {
		log.Printf("[admin] profile create: registry write: %v", err)
		writeJSON(w, 500, map[string]any{"error": "failed to update profile registry"})
		return
	}
	// Hot-load (setup wizard, 2026-09-23): main wires an activator that builds
	// the engine and registers it with the hub, so the profile answers
	// immediately. Without one (or on failure) the old restart advice stands.
	active := false
	msg := "Profile created. Restart rainbow-core to activate it."
	if h.profileActivator != nil {
		if err := h.profileActivator(id); err != nil {
			log.Printf("[admin] profile create: activate %s: %v", id, err)
			msg = "Profile created, but it could not be activated live (" + err.Error() + "). Restart rainbow-core to activate it."
		} else {
			active = true
			msg = "Profile created and active."
		}
	}
	if active {
		h.addProfileID(id)
	}
	log.Printf("[admin] profile created id=%s name=%q source=%s files=%d active=%v", id, name, src, len(copied), active)
	writeJSON(w, 201, map[string]any{
		"profileId":   id,
		"displayName": name,
		"copied":      copied,
		"source":      src,
		"active":      active,
		"message":     msg,
	})
}
