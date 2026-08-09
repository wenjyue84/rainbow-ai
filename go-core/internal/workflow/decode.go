package workflow

// JSON decode helpers for the workflow graph config (raw node fields may be
// bare strings or {en,ms,zh,ta} maps). Extracted from workflow.go 2026-07-21.

import (
	"encoding/json"
)

// ─── decode helpers ──────────────────────────────────────────────────────────

func decodeString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

func decodeLangMap(raw json.RawMessage, lang string) string {
	if len(raw) == 0 {
		return ""
	}
	// May be a bare string or a {en,ms,zh,ta} map.
	if s := decodeString(raw); s != "" {
		return s
	}
	var m map[string]string
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if v, ok := m[lang]; ok && v != "" {
		return v
	}
	if v, ok := m["en"]; ok {
		return v
	}
	for _, v := range m {
		return v
	}
	return ""
}

// decodeStringNext decodes a node's `next` when it's a plain string.
func decodeStringNext(raw json.RawMessage) string { return decodeString(raw) }

// decodeSuccessError reads {success,error} from a pelangi_api node's `next`.
func decodeSuccessError(raw json.RawMessage) (success, errNext string) {
	if len(raw) == 0 {
		return "", ""
	}
	var m struct {
		Success string `json:"success"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(raw, &m) == nil {
		return m.Success, m.Error
	}
	return "", ""
}

// decodeBranch reads trueNext/falseNext from a condition node's config.
func decodeBranch(cfg map[string]json.RawMessage) (trueNext, falseNext string) {
	return decodeString(cfg["trueNext"]), decodeString(cfg["falseNext"])
}
