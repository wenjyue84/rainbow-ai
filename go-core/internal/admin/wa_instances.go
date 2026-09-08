package admin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
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
// + BRIDGE_QR_TOKEN_<INSTANCE>), and proxies the bridge's admin routes so the
// dashboard can log a number out and re-pair it by QR without SSH:
//
//	GET    /api/rainbow/whatsapp/instances                → list with live state
//	POST   /api/rainbow/whatsapp/instances/{id}/logout    → bridge POST /logout
//	GET    /api/rainbow/whatsapp/instances/{id}/qr        → bridge GET /qr.json/<token>
//	POST   /api/rainbow/whatsapp/instances/{id}/reconnect → current health (bridge auto-reconnects)
//	POST   /api/rainbow/whatsapp/instances, DELETE .../{id} → 501 (a number is a process; see new-bridge.sh)
//
// Every route is tenant-scoped: a scoped user only sees / acts on instances
// whose profile their session allows.

// InstanceBridge describes one WhatsApp number's bridge.
type InstanceBridge struct {
	URL     string // bridge base URL, e.g. http://127.0.0.1:8791
	Token   string // BRIDGE_QR_TOKEN of that bridge ("" = logout/QR unavailable)
	Profile string // profile the instance's messages route to
}

// SetInstanceBridges installs the instance → bridge registry (from main).
func (h *Handler) SetInstanceBridges(m map[string]InstanceBridge) {
	h.instances = map[string]InstanceBridge{}
	for id, ib := range m {
		ib.URL = strings.TrimRight(ib.URL, "/")
		h.instances[id] = ib
	}
}

// instanceForProfile returns the first (sorted) instance id routed to a
// profile, "" when none is linked. Empty profile = the default profile.
func (h *Handler) instanceForProfile(profileID string) string {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	for _, id := range h.instanceIDsSorted() {
		if h.instances[id].Profile == profileID {
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
	if len(h.instances) == 0 {
		return requested, true
	}
	if requested != "" {
		if ib, ok := h.instances[requested]; ok && ib.Profile == profileID {
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
		for _, id := range h.instanceIDsSorted() {
			if ib := h.instances[id]; ib.Profile == profileID && ib.URL != "" {
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

func (h *Handler) instanceIDsSorted() []string {
	ids := make([]string, 0, len(h.instances))
	for id := range h.instances {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

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
	for _, id := range h.instanceIDsSorted() {
		ib := h.instances[id]
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
	phone := user
	if phone == "" {
		phone = h.profileEnv(w.Profile, "RAINBOW_WA_NUMBER")
	}
	name := h.profileEnv(w.Profile, "BUSINESS_DISPLAY_NAME")
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
	ib, found := h.instances[id]
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
	"`/home/deploy/rainbow-go/new-bridge.sh <instance> <port>`, then add the instance to " +
	"PROFILE_INSTANCES / BRIDGE_INSTANCE_URLS / BRIDGE_QR_TOKEN_<INSTANCE> in run-core-prod.sh " +
	"and restart rainbow-core-go. Removal = pm2 delete <instance>-bridge + drop those env lines."

// waInstances serves /api/rainbow/whatsapp/instances (collection).
func (h *Handler) waInstances(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, map[string]any{"instances": h.listInstances(r.Context(), sessionFrom(r), "")})
	case http.MethodPost:
		writeJSON(w, 501, map[string]any{"error": "Adding a number from the dashboard is not supported. " + addInstanceHelp})
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
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
		writeJSON(w, 501, map[string]any{"error": "Removing a number from the dashboard is not supported. " + addInstanceHelp})
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
	writeJSON(w, 200, out)
}
