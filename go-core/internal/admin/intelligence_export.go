package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// intelligenceFiles lists the config JSON files that form the intelligence bundle.
// Matches the Node intelligence-export.ts bundle shape exactly.
var intelligenceFiles = []string{
	"knowledge.json",
	"settings.json",
	"routing.json",
	"intent-keywords.json",
	"intents.json",
	"templates.json",
	"workflows.json",
}

// intelligenceExport handles GET /api/rainbow/intelligence/export.
// Reads all 7 intelligence config files and returns them as a single JSON bundle.
func (h *Handler) intelligenceExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if h.dataDir == "" {
		writeJSON(w, 500, map[string]any{"error": "no data dir configured"})
		return
	}

	p, perr := h.reqProfile(r)
	if perr != nil {
		writeJSON(w, 400, map[string]any{"error": perr.Error()})
		return
	}

	// Determine profile id label for the manifest and filename.
	profileLabel := h.defaultProfile
	if profileLabel == "" {
		profileLabel = "pelangi"
	}
	if p != "" {
		profileLabel = p
	}

	files := map[string]any{}
	for _, name := range intelligenceFiles {
		key := name[:len(name)-len(filepath.Ext(name))] // strip .json

		// For non-default profiles, try profile variant first.
		path := filepath.Join(h.dataDir, name)
		if p != "" {
			variant := filepath.Join(h.dataDir, profileVariant(name, p))
			if _, err := os.Stat(variant); err == nil {
				path = variant
			}
		}

		raw, err := os.ReadFile(path)
		if err != nil {
			// File missing for this profile — include null (same as Node behaviour).
			files[key] = nil
			continue
		}
		var parsed any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			files[key] = nil
			continue
		}
		files[key] = parsed
	}

	bundle := map[string]any{
		"manifest": map[string]any{
			"profileId":  profileLabel,
			"exportedAt": time.Now().UTC().Format(time.RFC3339),
			"version":    "1.0",
		},
		"files": files,
	}

	out, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "failed to marshal bundle"})
		return
	}

	date := time.Now().UTC().Format("2006-01-02")
	filename := fmt.Sprintf("intelligence-%s-%s.json", profileLabel, date)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(200)
	w.Write(out)
}
