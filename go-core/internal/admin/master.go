package admin

// Master layer (2026-09-08): cross-business settings that are not a profile.
//
//	GET|PUT /api/rainbow/master/settings            settings-master.json
//	POST    /api/rainbow/master/settings/apply-all  copy keys into every profile file
//	GET     /api/rainbow/master/overview            numbers + assistants + profiles + last check
//	POST    /api/rainbow/master/check-numbers       run check-numbers.sh (no LLM)
//	GET     /api/rainbow/settings/effective         profile settings merged with master
//
// Inheritance rule (config.applyMaster mirrors it for the engine): a profile
// that has not set a key uses the Master value; a profile that set it wins.
// Every /master/* route is refused for tenant-scoped sessions.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"rainbow-core/internal/config"
)

// masterKeys are the keys a profile may inherit / Apply-to-all may push.
var masterKeys = map[string]bool{"ai.providers": true, "reply_mode": true, "botAvatar": true, "staffName": true}

// masterOnly refuses tenant-scoped sessions.
func (h *Handler) masterOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if sessionFrom(r).Scoped() {
			writeJSON(w, 403, map[string]any{"error": "forbidden: Master is for unrestricted admins only"})
			return
		}
		if h.dataDir == "" {
			writeJSON(w, 404, map[string]any{"error": "no data dir"})
			return
		}
		next(w, r)
	}
}

// settingsFileFor maps a profile id to its settings file name (the default
// profile owns the unsuffixed settings.json).
func (h *Handler) settingsFileFor(pid string) string {
	def := h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	if pid == "" || pid == def {
		return "settings.json"
	}
	return profileVariant("settings.json", pid)
}

// servedProfiles returns the profile ids in a stable order, default first.
func (h *Handler) servedProfiles() []string {
	ids := append([]string(nil), h.profileIDs...)
	sort.Strings(ids)
	out := make([]string, 0, len(ids)+1)
	if h.defaultProfile != "" {
		out = append(out, h.defaultProfile)
	}
	for _, id := range ids {
		if id != h.defaultProfile {
			out = append(out, id)
		}
	}
	return out
}

func (h *Handler) readMasterDoc() map[string]any {
	m := map[string]any{}
	h.readDataJSON(config.MasterFile, &m)
	return m
}

// introFor picks + expands the master intro for profile pid from a raw master
// doc: intro_message when the profile's own doc has a bot_name, else
// intro_message_unnamed with {business} = the profile's business name.
func (h *Handler) introFor(master, own map[string]any, pid string) string {
	m := config.Master{IntroMessage: str(master, "intro_message"), IntroMessageUnnamed: str(master, "intro_message_unnamed")}
	m.ApplyDefaults()
	return config.IntroFor(m, str(own, "bot_name"), config.BusinessName(h.dataDir, pid))
}

func str(m map[string]any, k string) string {
	v, _ := m[k].(string)
	return strings.TrimSpace(v)
}

// providersOf returns doc.ai.providers as a slice (nil when absent/empty).
func providersOf(doc map[string]any) []any {
	ai, _ := doc["ai"].(map[string]any)
	if ai == nil {
		return nil
	}
	list, _ := ai["providers"].([]any)
	if len(list) == 0 {
		return nil
	}
	return list
}

func setProviders(doc map[string]any, list []any) {
	ai, _ := doc["ai"].(map[string]any)
	if ai == nil {
		ai = map[string]any{}
	}
	ai["providers"] = list
	doc["ai"] = ai
}

// effectiveFor merges a profile's own settings file with the master document.
// Returns the merged doc and the list of inherited keys.
func (h *Handler) effectiveFor(pid string) (map[string]any, []string) {
	own := map[string]any{}
	h.readDataJSON(h.settingsFileFor(pid), &own)
	master := h.readMasterDoc()
	inherited := []string{}
	if providersOf(own) == nil {
		if mp := providersOf(master); mp != nil {
			setProviders(own, mp)
			inherited = append(inherited, "ai.providers")
		}
	}
	if str(own, "reply_mode") == "" && str(master, "reply_mode") != "" {
		own["reply_mode"] = str(master, "reply_mode")
		if str(own, "intro_message") == "" {
			own["intro_message"] = h.introFor(master, own, pid)
		}
		inherited = append(inherited, "reply_mode")
	}
	for _, k := range []string{"botAvatar", "staffName"} {
		if str(own, k) == "" && str(master, k) != "" {
			own[k] = str(master, k)
			inherited = append(inherited, k)
		}
	}
	return own, inherited
}

// settingsEffective serves GET /api/rainbow/settings/effective for the
// requesting profile: its own file merged with master + "_inherited".
func (h *Handler) settingsEffective(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if h.dataDir == "" {
		writeJSON(w, 404, map[string]any{"error": "no data dir"})
		return
	}
	pid, err := h.effectiveProfile(r)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	doc, inherited := h.effectiveFor(pid)
	doc["_inherited"] = inherited
	doc["_profile"] = pid
	writeJSON(w, 200, doc)
}

// validateMaster checks a PUT body and returns the cleaned document (only
// the keys present in the body).
func validateMaster(in map[string]any) (map[string]any, string) {
	out := map[string]any{}
	if ai, ok := in["ai"]; ok && ai != nil {
		aim, ok := ai.(map[string]any)
		if !ok {
			return nil, "ai must be an object"
		}
		list, ok := aim["providers"].([]any)
		if !ok && aim["providers"] != nil {
			return nil, "ai.providers must be an array"
		}
		for i, p := range list {
			pm, ok := p.(map[string]any)
			if !ok || str(pm, "id") == "" {
				return nil, fmt.Sprintf("ai.providers[%d] needs an id", i)
			}
		}
		if list == nil {
			list = []any{}
		}
		out["ai"] = map[string]any{"providers": list}
	}
	if v, ok := in["reply_mode"]; ok && v != nil {
		s, _ := v.(string)
		mode, ok := normalizeReplyMode(s)
		if !ok || mode == "" {
			return nil, "reply_mode must be \"normal\", \"intro-once\" or \"silent\""
		}
		out["reply_mode"] = mode
	}
	if v, ok := in["intro_message"]; ok && v != nil {
		s, _ := v.(string)
		s = strings.TrimSpace(s)
		if len([]rune(s)) > 1000 {
			return nil, "intro_message must be 1000 characters or fewer"
		}
		out["intro_message"] = s
	}
	if v, ok := in["intro_message_unnamed"]; ok && v != nil {
		s, _ := v.(string)
		s = strings.TrimSpace(s)
		if len([]rune(s)) > 1000 {
			return nil, "intro_message_unnamed must be 1000 characters or fewer"
		}
		out["intro_message_unnamed"] = s
	}
	if str(out, "reply_mode") == "intro-once" && str(out, "intro_message") == "" {
		return nil, "intro-once needs a non-empty intro_message"
	}
	for _, k := range []string{"botAvatar", "staffName"} {
		if v, ok := in[k]; ok && v != nil {
			s, _ := v.(string)
			s = strings.TrimSpace(s)
			if len([]rune(s)) > 40 {
				return nil, k + " too long"
			}
			out[k] = s
		}
	}
	return out, ""
}

// masterSettings serves GET|PUT /api/rainbow/master/settings.
func (h *Handler) masterSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, map[string]any{"settings": h.readMasterDoc(), "modes": replyModes,
			"hotApply": h.replyModeApplier != nil, "profiles": h.servedProfiles()})
	case http.MethodPut:
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad json"})
			return
		}
		clean, msg := validateMaster(body)
		if msg != "" {
			writeJSON(w, 400, map[string]any{"error": msg})
			return
		}
		old := h.readMasterDoc()
		doc := h.readMasterDoc()
		for k, v := range clean {
			doc[k] = v
		}
		if err := h.writeDataJSON(config.MasterFile, doc); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
		oldP, _ := json.Marshal(providersOf(old))
		newP, _ := json.Marshal(providersOf(doc))
		restart := !bytes.Equal(oldP, newP)
		applied := h.hotApplyInherited()
		log.Printf("[admin] master settings updated keys=%v applied=%v restartRequired=%v", keysOf(clean), applied, restart)
		writeJSON(w, 200, map[string]any{"ok": true, "settings": doc, "applied": applied, "restartRequired": restart})
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// hotApplyInherited pushes the master reply mode to every running engine
// whose profile has no reply_mode of its own. Returns the profile ids applied.
func (h *Handler) hotApplyInherited() []string {
	applied := []string{}
	if h.replyModeApplier == nil {
		return applied
	}
	master, ok := config.LoadMaster(h.dataDir)
	if !ok || master.ReplyMode == "" {
		return applied
	}
	for _, pid := range h.servedProfiles() {
		own := map[string]any{}
		h.readDataJSON(h.settingsFileFor(pid), &own)
		if str(own, "reply_mode") != "" {
			continue
		}
		intro := str(own, "intro_message")
		if intro == "" {
			intro = config.IntroFor(master, str(own, "bot_name"), config.BusinessName(h.dataDir, pid))
		}
		if h.replyModeApplier(pid, master.ReplyMode, intro) {
			applied = append(applied, pid)
		}
	}
	return applied
}

// masterApplyAll serves POST /api/rainbow/master/settings/apply-all
// {"keys":["reply_mode","ai.providers","botAvatar","staffName"]}: writes the
// master value of each key into every served profile's own settings file
// (so it becomes explicit there) and hot-applies reply mode.
func (h *Handler) masterApplyAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	var body struct {
		Keys     []string `json:"keys"`
		Profiles []string `json:"profiles"` // optional subset
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Keys) == 0 {
		writeJSON(w, 400, map[string]any{"error": "keys required"})
		return
	}
	for _, k := range body.Keys {
		if !masterKeys[k] {
			writeJSON(w, 400, map[string]any{"error": "unknown key " + k})
			return
		}
	}
	master := h.readMasterDoc()
	targets := h.servedProfiles()
	if len(body.Profiles) > 0 {
		targets = body.Profiles
	}
	results := []map[string]any{}
	for _, pid := range targets {
		if !h.profileExists(pid) {
			results = append(results, map[string]any{"profile": pid, "ok": false, "error": "unknown profile"})
			continue
		}
		file := h.settingsFileFor(pid)
		own := map[string]any{}
		h.readDataJSON(file, &own)
		written := []string{}
		for _, k := range body.Keys {
			switch k {
			case "ai.providers":
				if mp := providersOf(master); mp != nil {
					setProviders(own, mp)
					written = append(written, k)
				}
			case "reply_mode":
				if m := str(master, "reply_mode"); m != "" {
					own["reply_mode"] = m
					own["intro_message"] = h.introFor(master, own, pid)
					written = append(written, k)
				}
			default:
				if v := str(master, k); v != "" {
					own[k] = v
					written = append(written, k)
				}
			}
		}
		res := map[string]any{"profile": pid, "file": file, "written": written, "ok": true}
		if len(written) > 0 {
			if err := h.writeDataJSON(file, own); err != nil {
				res["ok"] = false
				res["error"] = err.Error()
			} else if contains(written, "reply_mode") && h.replyModeApplier != nil {
				res["applied"] = h.replyModeApplier(pid, str(own, "reply_mode"), str(own, "intro_message"))
			}
		}
		results = append(results, res)
	}
	log.Printf("[admin] master apply-all keys=%v profiles=%d", body.Keys, len(results))
	writeJSON(w, 200, map[string]any{"ok": true, "results": results})
}

// lastCheckPath is where check-numbers.sh writes its JSON result.
func lastCheckPath() string {
	if v := os.Getenv("NUMBER_CHECK_JSON"); v != "" {
		return v
	}
	return "/home/deploy/rainbow-go/last-check.json"
}

func readLastCheck() any {
	b, err := os.ReadFile(lastCheckPath())
	if err != nil {
		return nil
	}
	var v any
	if json.Unmarshal(b, &v) != nil {
		return nil
	}
	return v
}

func checkScriptPath() string {
	if v := os.Getenv("NUMBER_CHECK_SCRIPT"); v != "" {
		return v
	}
	return "/home/deploy/rainbow-go/check-numbers.sh"
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// ── WA Hub (2026-09-08; renamed from baileys-engine 2026-09-09) ────────────
// When WA_HUB_URL is set, the WhatsApp number registry + health come from
// engine-admin (wahub.wenjyue.com, :8800) instead of check-numbers.sh and
// last-check.json. WA_HUB_KEY is sent as x-admin-key. The legacy names
// BAILEYS_ENGINE_URL / BAILEYS_ENGINE_KEY are still honoured as a fallback.

const engineSource = "wa-hub"

func engineURL() string {
	for _, k := range []string{"WA_HUB_URL", "BAILEYS_ENGINE_URL"} {
		if v := strings.TrimRight(strings.TrimSpace(os.Getenv(k)), "/"); v != "" {
			return v
		}
	}
	return ""
}

func engineKey() string {
	for _, k := range []string{"WA_HUB_KEY", "BAILEYS_ENGINE_KEY"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

// engineJSON performs a JSON request against engine-admin. Returns an error on
// any failure so callers can fall back to the legacy script/file.
func engineJSON(ctx context.Context, method, path string) (any, error) {
	var v any
	status, err := engineJSONInto(ctx, method, path, nil, &v)
	if err != nil {
		return v, err
	}
	if status >= 400 {
		return v, fmt.Errorf("engine %s %s: http %d", method, path, status)
	}
	return v, nil
}

// engineJSONInto is engineJSON with an optional JSON body and a typed target.
// Returns the HTTP status (0 when the request never got a response) so
// callers can distinguish "hub said 409" from "hub unreachable". A non-2xx
// status is NOT an error here; the body is still decoded into out.
func engineJSONInto(ctx context.Context, method, path string, body any, out any) (int, error) {
	base := engineURL()
	if base == "" {
		return 0, fmt.Errorf("WA_HUB_URL not set")
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, rd)
	if err != nil {
		return 0, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if k := engineKey(); k != "" {
		req.Header.Set("x-admin-key", k)
	}
	req.Header.Set("x-caller", "rainbow-core")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil {
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out); err != nil {
			return resp.StatusCode, fmt.Errorf("engine %s %s: bad json (%v)", method, path, err)
		}
	}
	return resp.StatusCode, nil
}

// masterOverview serves GET /api/rainbow/master/overview — one call for the
// Master landing page.
func (h *Handler) masterOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	reg := h.readProfileRegistry()
	profiles := []map[string]any{}
	for _, pid := range h.servedProfiles() {
		doc, inherited := h.effectiveFor(pid)
		own := map[string]any{}
		h.readDataJSON(h.settingsFileFor(pid), &own)
		profiles = append(profiles, map[string]any{
			"id": pid, "name": reg.nameOr(pid, titleProfile(pid)),
			"botName":        botNameOr(str(own, "bot_name")),
			"replyMode":      str(doc, "reply_mode"),
			"ownReplyMode":   str(own, "reply_mode"),
			"providersCount": len(providersOf(doc)),
			"botAvatar":      str(doc, "botAvatar"),
			"inherited":      inherited,
			"instanceId":     h.instanceForProfile(pid),
		})
	}
	out := map[string]any{
		"instances": h.listInstances(ctx, nil, ""),
		"bots":      h.botsFor(ctx, nil),
		"profiles":  profiles,
		"master":    h.readMasterDoc(),
		"lastCheck": readLastCheck(),
		"checkScript": map[string]any{
			"available": fileExists(checkScriptPath()),
			"path":      checkScriptPath(),
		},
		"source":       "check-numbers.sh",
		"modelUsage":   h.modelUsageStats(ctx),
		"messageStats": h.numberMessageStats(ctx),
	}
	if base := engineURL(); base != "" {
		eng := map[string]any{"url": base}
		if v, err := engineJSON(ctx, http.MethodGet, "/api/health"); err == nil {
			out["lastCheck"] = v
			out["source"] = engineSource
			out["checkScript"] = map[string]any{"available": true, "path": base + "/api/health/run"}
		} else {
			eng["error"] = err.Error()
			log.Printf("[admin] engine health unavailable: %v (falling back to last-check.json)", err)
		}
		if v, err := engineJSON(ctx, http.MethodGet, "/api/numbers"); err == nil {
			if m, ok := v.(map[string]any); ok {
				eng["numbers"] = m["numbers"]
			}
		}
		out["engine"] = eng
	}
	writeJSON(w, 200, out)
}

// modelUsageStats aggregates llm_cost_daily.request_count by provider, for
// the "how often is each model used" panel on Master → Defaults.
//
// Guard: flushToDb() in src/assistant/llm-cost-budget.ts had a bug (fixed
// 2026-09-23) where every LLM call re-wrote the FULL day-so-far cumulative
// counters instead of just that call's delta, so a heavily-used provider's
// row could carry a wildly inflated request_count (observed: one row at
// ~4.2e90). That bad historical row is still sitting in the DB. Rather than
// guess a replacement number for it, this query excludes any row whose
// request_count is outside a sane bound and reports how many rows were
// dropped so the number stays honest instead of fabricated.
func (h *Handler) modelUsageStats(ctx context.Context) map[string]any {
	const sane = 1_000_000 // no real single day should exceed this
	rows, err := h.st.DB.QueryContext(ctx, `
		SELECT provider,
		       SUM(CASE WHEN request_count >= 0 AND request_count < ? THEN request_count ELSE 0 END) AS reqs,
		       ROUND(SUM(CASE WHEN estimated_cost_usd >= 0 AND estimated_cost_usd < ? THEN estimated_cost_usd ELSE 0 END), 4) AS cost_usd,
		       SUM(CASE WHEN request_count >= ? THEN 1 ELSE 0 END) AS excluded_rows
		FROM llm_cost_daily
		GROUP BY provider
		ORDER BY reqs DESC`, sane, sane, sane)
	if err != nil {
		log.Printf("[admin] model usage query failed: %v", err)
		return map[string]any{"providers": []any{}, "error": err.Error()}
	}
	defer rows.Close()
	list := []map[string]any{}
	excludedTotal := 0
	for rows.Next() {
		var provider string
		var reqs, excluded int64
		var cost float64
		if err := rows.Scan(&provider, &reqs, &cost, &excluded); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"provider":     provider,
			"requestCount": reqs,
			"costUsd":      cost,
			"excludedRows": excluded,
		})
		excludedTotal += int(excluded)
	}
	out := map[string]any{"providers": list}
	if excludedTotal > 0 {
		out["note"] = fmt.Sprintf("%d corrupted row(s) excluded from these totals (bad historical data, not zero usage)", excludedTotal)
	}
	return out
}

// numberMessageStats counts rainbow_messages by profile_id + role, for the
// "how much traffic has each number handled" panel on Master → WhatsApp
// Numbers. Keyed by profile id so the frontend can join it onto each
// instance card.
func (h *Handler) numberMessageStats(ctx context.Context) map[string]any {
	rows, err := h.st.DB.QueryContext(ctx, `
		SELECT COALESCE(NULLIF(profile_id,''), 'pelangi') AS pid, role, COUNT(*)
		FROM rainbow_messages
		WHERE deleted_at IS NULL
		GROUP BY pid, role`)
	if err != nil {
		log.Printf("[admin] number message stats query failed: %v", err)
		return map[string]any{}
	}
	defer rows.Close()
	byProfile := map[string]map[string]int64{}
	for rows.Next() {
		var pid, role string
		var cnt int64
		if err := rows.Scan(&pid, &role, &cnt); err != nil {
			continue
		}
		m, ok := byProfile[pid]
		if !ok {
			m = map[string]int64{}
			byProfile[pid] = m
		}
		m[role] = cnt
		m["total"] += cnt
	}
	out := map[string]any{}
	for pid, m := range byProfile {
		out[pid] = m
	}
	return out
}

// masterCheckNumbers serves POST /api/rainbow/master/check-numbers: runs the
// health script (no probe, no LLM) with a 40 s cap and returns its JSON.
func (h *Handler) masterCheckNumbers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	if engineURL() != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
		defer cancel()
		v, err := engineJSON(ctx, http.MethodPost, "/api/health/run")
		res := map[string]any{"ok": err == nil, "result": v, "source": engineSource}
		if err != nil {
			res["error"] = err.Error()
		} else if m, ok := v.(map[string]any); ok {
			lines := []string{}
			if probs, _ := m["problems"].([]any); len(probs) == 0 {
				lines = append(lines, "ALL OK (wa-hub)")
			} else {
				for _, p := range probs {
					lines = append(lines, fmt.Sprintf("✗ %v", p))
				}
			}
			res["output"] = strings.Join(lines, "\n")
		}
		log.Printf("[admin] master check-numbers via engine ok=%v", err == nil)
		writeJSON(w, 200, res)
		return
	}
	script := checkScriptPath()
	if !fileExists(script) {
		writeJSON(w, 501, map[string]any{"error": "check script not found: " + script})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", script, "--quiet")
	cmd.Dir = filepath.Dir(script)
	out, err := cmd.CombinedOutput()
	res := map[string]any{"ok": err == nil, "output": strings.TrimSpace(string(out)), "result": readLastCheck()}
	if err != nil {
		res["error"] = err.Error()
	}
	log.Printf("[admin] master check-numbers ok=%v", err == nil)
	writeJSON(w, 200, res)
}
