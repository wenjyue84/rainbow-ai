package admin

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// WhatsApp instance management (2026-09-08).
//
// A WhatsApp number is one rainbow-bridge process (Baileys session) with its
// own port, auth dir and BRIDGE_QR_TOKEN. The core knows them through the
// instance registry wired from main (PROFILE_INSTANCES + BRIDGE_INSTANCE_URLS
// + BRIDGE_QR_TOKEN_<INSTANCE>, plus <dataDir>/instances.json for numbers
// created from the dashboard), and proxies the bridge's admin routes so the
// dashboard can log a number out and re-pair it by QR without SSH:
//
//	GET    /api/rainbow/whatsapp/instances                → list with live state
//	POST   /api/rainbow/whatsapp/instances                → create via WA Hub (wizard, 2026-09-23)
//	POST   /api/rainbow/whatsapp/instances/{id}/logout    → bridge POST /logout
//	GET    /api/rainbow/whatsapp/instances/{id}/qr        → bridge GET /qr.json/<token>
//	POST   /api/rainbow/whatsapp/instances/{id}/reconnect → current health (bridge auto-reconnects)
//	DELETE .../{id}                                        → 501 (remove via WA Hub)
//
// Every route is tenant-scoped: a scoped user only sees / acts on instances
// whose profile their session allows.

// InstanceBridge describes one WhatsApp number's bridge.
type InstanceBridge struct {
	URL     string // bridge base URL, e.g. http://127.0.0.1:8791
	Token   string // BRIDGE_QR_TOKEN of that bridge ("" = logout/QR unavailable)
	Profile string // profile the instance's messages route to
}

// InstanceLinker is told about a hot-added instance so main can route it
// (hub.MapInstance + bridge.SetInstanceURL) without a restart.
type InstanceLinker func(instanceID, profileID, bridgeURL string)

// SetInstanceLinker installs the hot-route callback (wired from main).
func (h *Handler) SetInstanceLinker(f InstanceLinker) { h.instanceLinker = f }

// SetBotNumberHook installs the callback fed with every paired number the
// registry observes (hub.AddBotNumber: our own numbers must never be answered).
func (h *Handler) SetBotNumberHook(f func(phone string)) { h.botNumberHook = f }

// SetInstanceBridges installs the instance → bridge registry (from main).
func (h *Handler) SetInstanceBridges(m map[string]InstanceBridge) {
	h.instMu.Lock()
	defer h.instMu.Unlock()
	h.instances = map[string]InstanceBridge{}
	for id, ib := range m {
		ib.URL = strings.TrimRight(ib.URL, "/")
		h.instances[id] = ib
	}
}

// AddInstance hot-registers one instance (setup wizard) and tells main to
// route it. Does not persist; see waInstanceCreate.
func (h *Handler) AddInstance(id string, ib InstanceBridge) {
	ib.URL = strings.TrimRight(ib.URL, "/")
	h.instMu.Lock()
	if h.instances == nil {
		h.instances = map[string]InstanceBridge{}
	}
	h.instances[id] = ib
	h.instMu.Unlock()
	if h.instanceLinker != nil {
		h.instanceLinker(id, ib.Profile, ib.URL)
	}
}

// getInstance returns one registry entry under the read lock.
func (h *Handler) getInstance(id string) (InstanceBridge, bool) {
	h.instMu.RLock()
	defer h.instMu.RUnlock()
	ib, ok := h.instances[id]
	return ib, ok
}

// instanceSnapshot returns a copy of the registry (callers iterate freely).
func (h *Handler) instanceSnapshot() map[string]InstanceBridge {
	h.instMu.RLock()
	defer h.instMu.RUnlock()
	out := make(map[string]InstanceBridge, len(h.instances))
	for id, ib := range h.instances {
		out[id] = ib
	}
	return out
}

func (h *Handler) instanceCount() int {
	h.instMu.RLock()
	defer h.instMu.RUnlock()
	return len(h.instances)
}

// instanceForProfile returns the first (sorted) instance id routed to a
// profile, "" when none is linked. Empty profile = the default profile.
func (h *Handler) instanceForProfile(profileID string) string {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	snap := h.instanceSnapshot()
	for _, id := range sortedIDs(snap) {
		if snap[id].Profile == profileID {
			return id
		}
	}
	return ""
}

// resolveSendInstance picks the WhatsApp number an outbound staff message
// leaves from. A requested instance is honoured only when it belongs to the
// profile; otherwise the profile's own instance is used. With a registry in
// place and no instance for the profile, sending is refused (ok=false) rather
// than silently falling back to the default bridge (= another business's
// number). Without a registry (single-bridge legacy) the request passes through.
func (h *Handler) resolveSendInstance(requested, profileID string) (string, bool) {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	if h.instanceCount() == 0 {
		return requested, true
	}
	if requested != "" {
		if ib, ok := h.getInstance(requested); ok && ib.Profile == profileID {
			return requested, true
		}
	}
	if id := h.instanceForProfile(profileID); id != "" {
		return id, true
	}
	return "", false
}

// bridgeForProfile resolves the bridge base URL for a profile: the registry
// first (an instance routed to that profile), then BRIDGE_URL_<PROFILE>, then
// the default bridge. This is the ONE place that lookup lives.
func (h *Handler) bridgeForProfile(profileID string) string {
	if profileID != "" {
		snap := h.instanceSnapshot()
		for _, id := range sortedIDs(snap) {
			if ib := snap[id]; ib.Profile == profileID && ib.URL != "" {
				return ib.URL
			}
		}
		if v := os.Getenv("BRIDGE_URL_" + envSuffixOf(profileID)); v != "" {
			return strings.TrimRight(v, "/")
		}
	}
	return h.bridgeURL
}

// bridgeURLFor is the historical name, kept for callers.
func (h *Handler) bridgeURLFor(profileID string) string { return h.bridgeForProfile(profileID) }

func envSuffixOf(profile string) string {
	return strings.ToUpper(strings.ReplaceAll(profile, "-", "_"))
}

func sortedIDs(m map[string]InstanceBridge) []string {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (h *Handler) instanceIDsSorted() []string { return sortedIDs(h.instanceSnapshot()) }

// waInstance is the dashboard shape (dashboard.js renderInstanceCard).
type waInstance struct {
	ID                   string         `json:"id"`
	Label                string         `json:"label"`
	Profile              string         `json:"profile"`
	State                string         `json:"state"`
	User                 map[string]any `json:"user"`
	BridgeURL            string         `json:"bridgeUrl,omitempty"`
	CanManage            bool           `json:"canManage"` // token known → logout/QR work
	UnlinkedFromWhatsApp bool           `json:"unlinkedFromWhatsApp"`
}

// bridgeHealthFull fetches /health and returns state, instanceId and the
// paired number (digits; "" when the bridge predates the user field).
func bridgeHealthFull(ctx context.Context, bridgeURL string) (state, instanceID, user string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, bridgeURL+"/health", nil)
	if err != nil {
		return "offline", "", ""
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "offline", "", ""
	}
	defer resp.Body.Close()
	var hb struct {
		Whatsapp   string `json:"whatsapp"`
		InstanceID string `json:"instanceId"`
		User       string `json:"user"`
	}
	if json.NewDecoder(resp.Body).Decode(&hb) != nil || hb.Whatsapp == "" {
		return "offline", "", ""
	}
	return hb.Whatsapp, hb.InstanceID, hb.User
}

// profileEnv reads <key>_<PROFILE>, falling back to the global <key> for the
// default profile only (so Senai never inherits Pelangi's number).
func (h *Handler) profileEnv(profile, key string) string {
	if profile != "" {
		if v := os.Getenv(key + "_" + envSuffixOf(profile)); v != "" {
			return v
		}
	}
	if profile == "" || profile == h.defaultProfile {
		return os.Getenv(key)
	}
	return ""
}

// listInstances returns the registry entries the session may see (all when
// unscoped), optionally narrowed to one profile, with live bridge state.
func (h *Handler) listInstances(ctx context.Context, sess *Session, onlyProfile string) []waInstance {
	out := []waInstance{}
	snap := h.instanceSnapshot()
	for _, id := range sortedIDs(snap) {
		ib := snap[id]
		if onlyProfile != "" && ib.Profile != onlyProfile {
			continue
		}
		if sess != nil && !sess.Allows(ib.Profile) {
			continue
		}
		out = append(out, waInstance{ID: id, Profile: ib.Profile, BridgeURL: ib.URL, CanManage: ib.Token != "", State: "unknown"})
	}
	hctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	var wg sync.WaitGroup
	for i := range out {
		wg.Add(1)
		go func(w *waInstance) {
			defer wg.Done()
			h.fillInstance(hctx, w)
		}(&out[i])
	}
	wg.Wait()
	return out
}

// fillInstance sets live state + display fields on a registry entry.
func (h *Handler) fillInstance(ctx context.Context, w *waInstance) {
	state, _, user := bridgeHealthFull(ctx, w.BridgeURL)
	w.State = state
	if user != "" && h.botNumberHook != nil {
		// A number we observe paired is one of ours: never auto-answer it.
		h.botNumberHook(user)
	}
	phone := user
	if phone == "" {
		phone = h.profileEnv(w.Profile, "RAINBOW_WA_NUMBER")
	}
	name := h.profileEnv(w.Profile, "BUSINESS_DISPLAY_NAME")
	if name == "" && w.Profile != "" {
		// Wizard-created profiles have no env; the registry knows their name.
		name = h.readProfileRegistry().nameOr(w.Profile, "")
	}
	if phone != "" || name != "" {
		w.User = map[string]any{"phone": phone, "name": name}
	}
	w.Label = w.ID
	if name != "" {
		w.Label = name
	}
	if l := h.profileEnv(w.Profile, "WA_LABEL"); l != "" {
		w.Label = l
	}
}

// findInstance returns the registry entry the session may manage, or writes
// the error response and returns ok=false.
func (h *Handler) findInstance(w http.ResponseWriter, r *http.Request, id string) (InstanceBridge, bool) {
	ib, found := h.getInstance(id)
	if !found {
		writeJSON(w, 404, map[string]any{"error": "unknown WhatsApp instance \"" + id + "\""})
		return ib, false
	}
	if sess := sessionFrom(r); sess != nil && !sess.Allows(ib.Profile) {
		writeJSON(w, 403, map[string]any{"error": "forbidden: instance belongs to another tenant"})
		return ib, false
	}
	return ib, true
}

const addInstanceHelp = "A WhatsApp number is its own bridge process. On the server run " +
	"`/home/deploy/wa-hub/deploy/new-bridge.sh <instance> <port>`, then add the instance to " +
	"PROFILE_INSTANCES / BRIDGE_INSTANCE_URLS / BRIDGE_QR_TOKEN_<INSTANCE> in run-core-prod.sh " +
	"and restart rainbow-core-go. Removal = pm2 delete <instance>-bridge + drop those env lines."

// waInstances serves /api/rainbow/whatsapp/instances (collection).
func (h *Handler) waInstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, map[string]any{"instances": h.listInstances(r.Context(), sessionFrom(r), "")})
	case http.MethodPost:
		h.waInstanceCreate(w, r)
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

var newInstanceIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// waInstanceCreate handles POST /api/rainbow/whatsapp/instances (setup wizard,
// 2026-09-23). Body {profile, instance?}. It asks WA Hub (engine-admin) to
// spawn the bridge process — POST /api/numbers already runs new-bridge.sh and
// seeds the number row — then hot-registers the instance here, persists it to
// instances.json and routes it (hub + bridge client) without a restart. The
// SPA then polls GET .../{id}/qr like any other number.
//
// Idempotent on resume: if WA Hub already has the instance (409) the row is
// adopted instead of failing, so a wizard reopened after a reload continues.
func (h *Handler) waInstanceCreate(w http.ResponseWriter, r *http.Request) {
	if sessionFrom(r).Scoped() {
		writeJSON(w, 403, map[string]any{"error": "forbidden: only unrestricted admins can add a number"})
		return
	}
	var in struct {
		Profile  string `json:"profile"`
		Instance string `json:"instance"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON body"})
		return
	}
	profile := strings.ToLower(strings.TrimSpace(in.Profile))
	inst := strings.ToLower(strings.TrimSpace(in.Instance))
	if inst == "" {
		inst = profile
	}
	if profile == "" || !newInstanceIDRe.MatchString(profile) {
		writeJSON(w, 400, map[string]any{"error": "profile is required (lowercase letters, digits, hyphens)"})
		return
	}
	if !newInstanceIDRe.MatchString(inst) || len(inst) > 40 {
		writeJSON(w, 400, map[string]any{"error": "instance must match ^[a-z0-9][a-z0-9-]*$ (max 40 chars)"})
		return
	}
	if !h.profileExists(profile) {
		writeJSON(w, 404, map[string]any{"error": "unknown profile \"" + profile + "\""})
		return
	}
	if ib, ok := h.getInstance(inst); ok {
		writeJSON(w, 409, map[string]any{"error": "instance \"" + inst + "\" already exists (profile " + ib.Profile + ")", "id": inst, "profile": ib.Profile,
			"qrUrl": "/api/rainbow/whatsapp/instances/" + inst + "/qr"})
		return
	}
	base := engineURL()
	if base == "" {
		writeJSON(w, 501, map[string]any{"error": "WA_HUB_URL is not configured on this core, so a number cannot be created from the dashboard. " + addInstanceHelp})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	type hubNumber struct {
		ID        string `json:"id"`
		Port      int    `json:"port"`
		BridgeURL string `json:"bridge_url"`
		QRToken   string `json:"qr_token"`
	}
	var created struct {
		Number hubNumber `json:"number"`
		Error  string    `json:"error"`
	}
	status, err := engineJSONInto(ctx, http.MethodPost, "/api/numbers", map[string]any{"instance": inst, "profile": profile}, &created)
	adopted := false
	switch {
	case err == nil && status < 300:
	case status == 409:
		// WA Hub already runs this bridge (previous attempt, or a number added
		// on the hub side). Adopt it.
		var row hubNumber
		if st2, err2 := engineJSONInto(ctx, http.MethodGet, "/api/numbers/"+inst, nil, &row); err2 != nil || st2 >= 300 || row.ID == "" {
			writeJSON(w, 502, map[string]any{"error": "WA Hub reports instance \"" + inst + "\" exists but it could not be read back"})
			return
		}
		created.Number = row
		adopted = true
	case err != nil && status == 0:
		writeJSON(w, 502, map[string]any{"error": "WA Hub unreachable: " + err.Error()})
		return
	default:
		msg := created.Error
		if msg == "" {
			msg = "WA Hub returned HTTP " + http.StatusText(status)
		}
		writeJSON(w, 502, map[string]any{"error": "WA Hub could not create the number: " + msg, "status": status})
		return
	}

	// Route through the engine proxy (same as env-wired instances), never the
	// bridge's raw port: the proxy owns auth + logging for every consumer.
	ib := InstanceBridge{URL: base + "/i/" + inst, Token: created.Number.QRToken, Profile: profile}
	h.AddInstance(inst, ib)
	if err := h.persistInstance(inst, ib); err != nil {
		log.Printf("[admin] instance create: persist %s: %v (active until restart)", inst, err)
	}
	log.Printf("[admin] whatsapp instance created id=%s profile=%s port=%d adopted=%v canManage=%v", inst, profile, created.Number.Port, adopted, ib.Token != "")
	writeJSON(w, 201, map[string]any{
		"ok": true, "id": inst, "profile": profile, "bridgeUrl": ib.URL,
		"port": created.Number.Port, "canManage": ib.Token != "", "adopted": adopted,
		"qrUrl":   "/api/rainbow/whatsapp/instances/" + inst + "/qr",
		"message": "Number created. Scan the QR to pair it.",
	})
}

// waInstanceAction serves /api/rainbow/whatsapp/instances/{id}[/logout|/qr|/reconnect].
func (h *Handler) waInstanceAction(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/rainbow/whatsapp/instances/"), "/")
	parts := strings.SplitN(rest, "/", 2)
	id := parts[0]
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	if id == "" {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	ib, ok := h.findInstance(w, r, id)
	if !ok {
		return
	}
	switch {
	case action == "" && r.Method == http.MethodDelete:
		writeJSON(w, 501, map[string]any{"error": "Removing a number from the dashboard is not supported. Delete it in WA Hub (wahub.wenjyue.com → Numbers). " + addInstanceHelp})
	case action == "" && r.Method == http.MethodPatch:
		// Labels come from WA_LABEL_<PROFILE>; there is no server-side store.
		writeJSON(w, 501, map[string]any{"error": "Rename via WA_LABEL_<PROFILE> in run-core-prod.sh"})
	case action == "" && r.Method == http.MethodGet:
		for _, it := range h.listInstances(r.Context(), nil, "") {
			if it.ID == id {
				writeJSON(w, 200, map[string]any{"instance": it})
				return
			}
		}
		writeJSON(w, 404, map[string]any{"error": "not found"})
	case action == "logout" && r.Method == http.MethodPost:
		h.proxyLogout(w, r, id, ib)
	case action == "qr" && r.Method == http.MethodGet:
		h.proxyQR(w, r, id, ib)
	case action == "reconnect" && r.Method == http.MethodPost:
		ctx, cancel := context.WithTimeout(r.Context(), 2500*time.Millisecond)
		defer cancel()
		state, _, user := bridgeHealthFull(ctx, ib.URL)
		writeJSON(w, 200, map[string]any{"ok": true, "id": id, "state": state, "user": user,
			"message": "The bridge reconnects on its own; nothing to trigger."})
	default:
		writeJSON(w, 404, map[string]any{"error": "not found"})
	}
}

func (h *Handler) proxyLogout(w http.ResponseWriter, r *http.Request, id string, ib InstanceBridge) {
	if ib.Token == "" {
		writeJSON(w, 501, map[string]any{"error": "no BRIDGE_QR_TOKEN_" + envSuffixOf(id) + " configured for this instance"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ib.URL+"/logout", nil)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("X-Bridge-Token", ib.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": "bridge unreachable: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode == 404 {
		// Old bridge without the /logout route.
		writeJSON(w, 501, map[string]any{"error": "bridge for \"" + id + "\" has no /logout route (redeploy rainbow-bridge)"})
		return
	}
	var out map[string]any
	if json.Unmarshal(body, &out) != nil || out == nil {
		out = map[string]any{"ok": resp.StatusCode < 300, "raw": string(body)}
	}
	out["id"] = id
	writeJSON(w, resp.StatusCode, out)
}

func (h *Handler) proxyQR(w http.ResponseWriter, r *http.Request, id string, ib InstanceBridge) {
	if ib.Token == "" {
		writeJSON(w, 501, map[string]any{"error": "no BRIDGE_QR_TOKEN_" + envSuffixOf(id) + " configured for this instance"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ib.URL+"/qr.json/"+ib.Token, nil)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": "bridge unreachable: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out map[string]any
	if resp.StatusCode != 200 || json.Unmarshal(body, &out) != nil || out == nil {
		writeJSON(w, 501, map[string]any{"error": "bridge for \"" + id + "\" has no /qr.json route (redeploy rainbow-bridge)", "status": resp.StatusCode})
		return
	}
	out["id"] = id
	// Compat: modals.js historically read qrDataUrl.
	if q, ok := out["qr"]; ok {
		out["qrDataUrl"] = q
	}
	// A paired number reported by the bridge is one of ours (bot-peer guard).
	if u, ok := out["user"].(string); ok && u != "" && h.botNumberHook != nil {
		h.botNumberHook(u)
	}
	writeJSON(w, 200, out)
}
