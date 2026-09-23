package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeHub is an httptest WA Hub (engine-admin): POST /api/numbers spawns a
// "bridge" that the same server answers on /i/<id>/health and /i/<id>/qr.json/<tok>.
type fakeHub struct {
	*httptest.Server
	mu       sync.Mutex
	numbers  map[string]string // id → qr token
	creates  int
	lastBody map[string]any
	lastKey  string
}

func newFakeHub(t *testing.T) *fakeHub {
	fh := &fakeHub{numbers: map[string]string{}}
	fh.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fh.mu.Lock()
		defer fh.mu.Unlock()
		fh.lastKey = r.Header.Get("x-admin-key")
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/numbers":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			fh.lastBody = body
			id, _ := body["instance"].(string)
			if _, dup := fh.numbers[id]; dup {
				w.WriteHeader(409)
				w.Write([]byte(`{"error":"instance already exists"}`))
				return
			}
			fh.creates++
			fh.numbers[id] = "tok-" + id
			json.NewEncoder(w).Encode(map[string]any{
				"number": map[string]any{"id": id, "port": 8799, "bridge_url": "http://127.0.0.1:8799", "qr_token": "tok-" + id},
				"qrUrl":  "/api/numbers/" + id + "/qr",
			})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/numbers/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/numbers/")
			tok, ok := fh.numbers[id]
			if !ok {
				w.WriteHeader(404)
				w.Write([]byte(`{"error":"not found"}`))
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"id": id, "port": 8799, "bridge_url": "http://127.0.0.1:8799", "qr_token": tok})
		case strings.HasPrefix(r.URL.Path, "/i/"):
			rest := strings.TrimPrefix(r.URL.Path, "/i/")
			id, action, _ := strings.Cut(rest, "/")
			tok, ok := fh.numbers[id]
			if !ok {
				w.WriteHeader(404)
				return
			}
			switch {
			case action == "health":
				w.Write([]byte(`{"status":"ok","whatsapp":"connecting","instanceId":"` + id + `","user":""}`))
			case action == "qr.json/"+tok:
				w.Write([]byte(`{"state":"connecting","qr":"data:image/png;base64,QQ==","user":null,"instanceId":"` + id + `"}`))
			default:
				w.WriteHeader(404)
			}
		default:
			w.WriteHeader(404)
			w.Write([]byte(`{"error":"not found"}`))
		}
	}))
	t.Cleanup(fh.Close)
	return fh
}

func TestWAInstanceCreateViaHubPersistsAndRoutes(t *testing.T) {
	hub := newFakeHub(t)
	t.Setenv("WA_HUB_URL", hub.URL)
	t.Setenv("WA_HUB_KEY", "hubkey")
	dir := t.TempDir()
	h := New(nil, "", "", dir)
	h.SetProfiles([]string{"pelangi", "demo-biz"}, "pelangi")
	h.SetInstanceBridges(map[string]InstanceBridge{})
	var linked []string
	h.SetInstanceLinker(func(inst, prof, url string) { linked = append(linked, inst+"→"+prof+"@"+url) })

	rec := httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"profile":"demo-biz"}`)))
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out["id"] != "demo-biz" || out["canManage"] != true || out["qrUrl"] != "/api/rainbow/whatsapp/instances/demo-biz/qr" {
		t.Fatalf("create body: %v", out)
	}
	if hub.creates != 1 || hub.lastBody["profile"] != "demo-biz" || hub.lastKey != "hubkey" {
		t.Fatalf("hub call: creates=%d body=%v key=%q", hub.creates, hub.lastBody, hub.lastKey)
	}
	// Hot map + linker + persisted file.
	ib, ok := h.getInstance("demo-biz")
	if !ok || ib.Profile != "demo-biz" || ib.URL != hub.URL+"/i/demo-biz" || ib.Token != "tok-demo-biz" {
		t.Fatalf("registry: %+v ok=%v", ib, ok)
	}
	if len(linked) != 1 || linked[0] != "demo-biz→demo-biz@"+hub.URL+"/i/demo-biz" {
		t.Fatalf("linker: %v", linked)
	}
	b, err := os.ReadFile(filepath.Join(dir, instanceStoreFile))
	if err != nil {
		t.Fatalf("instances.json not written: %v", err)
	}
	if !strings.Contains(string(b), `"id": "demo-biz"`) || !strings.Contains(string(b), `"token": "tok-demo-biz"`) {
		t.Fatalf("instances.json content: %s", b)
	}
	if got := StoredInstances(dir); got["demo-biz"].Profile != "demo-biz" {
		t.Fatalf("StoredInstances: %+v", got)
	}
	// QR proxy works for the new instance through the hub proxy path.
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, httptest.NewRequest("GET", "/api/rainbow/whatsapp/instances/demo-biz/qr", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "QQ==") {
		t.Fatalf("qr: %d %s", rec.Code, rec.Body)
	}
	// Second create → 409 from the core (already registered).
	rec = httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"profile":"demo-biz"}`)))
	if rec.Code != 409 {
		t.Fatalf("dup create: %d %s", rec.Code, rec.Body)
	}
	// Unknown profile → 404; scoped session → 403.
	rec = httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"profile":"nope"}`)))
	if rec.Code != 404 {
		t.Fatalf("unknown profile: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.waInstances(rec, withSession(httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"profile":"pelangi"}`)),
		&Session{Username: "x", Role: "staff", Tenants: []string{"pelangi"}}))
	if rec.Code != 403 {
		t.Fatalf("scoped: %d", rec.Code)
	}
}

func TestWAInstanceCreateAdoptsExistingHubNumber(t *testing.T) {
	hub := newFakeHub(t)
	hub.numbers["demo-biz"] = "tok-demo-biz" // exists on the hub, unknown to core
	t.Setenv("WA_HUB_URL", hub.URL)
	h := New(nil, "", "", t.TempDir())
	h.SetProfiles([]string{"pelangi", "demo-biz"}, "pelangi")

	rec := httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"profile":"demo-biz","instance":"demo-biz"}`)))
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), `"adopted":true`) {
		t.Fatalf("adopt: %d %s", rec.Code, rec.Body)
	}
	if ib, ok := h.getInstance("demo-biz"); !ok || ib.Token != "tok-demo-biz" {
		t.Fatalf("adopted registry: %+v", ib)
	}
}

func TestWAInstanceCreateWithoutHubIs501(t *testing.T) {
	t.Setenv("WA_HUB_URL", "")
	t.Setenv("BAILEYS_ENGINE_URL", "")
	h := New(nil, "", "", t.TempDir())
	h.SetProfiles([]string{"pelangi"}, "pelangi")
	rec := httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"profile":"pelangi"}`)))
	if rec.Code != 501 || !strings.Contains(rec.Body.String(), "new-bridge.sh") {
		t.Fatalf("no hub: %d %s", rec.Code, rec.Body)
	}
}

func TestProfileCreateCallsActivator(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"bot_name":"Rainbow","ai":{"providers":[]}}`), 0o644)
	h := New(nil, "", "", dir)
	h.SetProfiles([]string{"pelangi"}, "pelangi")
	var activated []string
	h.SetProfileActivator(func(pid string) error { activated = append(activated, pid); return nil })

	rec := httptest.NewRecorder()
	h.profilesCreate(rec, httptest.NewRequest("POST", "/api/rainbow/profiles/blank", strings.NewReader(`{"newProfileId":"new-biz","displayName":"New Biz"}`)))
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out["active"] != true || !strings.Contains(out["message"].(string), "active") {
		t.Fatalf("body: %v", out)
	}
	if len(activated) != 1 || activated[0] != "new-biz" {
		t.Fatalf("activator: %v", activated)
	}
	if !h.servesProfile("new-biz") {
		t.Fatalf("profile not added to served ids: %v", h.profileIDs)
	}
	// reqProfile now accepts it (no restart).
	req := httptest.NewRequest("GET", "/api/rainbow/settings", nil)
	req.Header.Set("x-profile-id", "new-biz")
	if p, err := h.reqProfile(req); err != nil || p != "new-biz" {
		t.Fatalf("reqProfile: %q %v", p, err)
	}

	// setup/status reflects the new profile.
	rec = httptest.NewRecorder()
	h.setupStatus(rec, httptest.NewRequest("GET", "/api/rainbow/setup/status?profile=new-biz", nil))
	if rec.Code != 200 {
		t.Fatalf("status: %d %s", rec.Code, rec.Body)
	}
	var st map[string]any
	json.Unmarshal(rec.Body.Bytes(), &st)
	if st["exists"] != true || st["profileActive"] != true || st["businessName"] != "New Biz" || st["botName"] != "New" || st["instance"] != nil || st["hasLogin"] != false {
		t.Fatalf("status body: %v", st)
	}
	// Unknown profile → exists=false, still 200 (wizard step 1 not done).
	rec = httptest.NewRecorder()
	h.setupStatus(rec, httptest.NewRequest("GET", "/api/rainbow/setup/status?profile=ghost", nil))
	json.Unmarshal(rec.Body.Bytes(), &st)
	if rec.Code != 200 || st["exists"] != false {
		t.Fatalf("ghost status: %d %v", rec.Code, st)
	}
}

func TestReplyModePutSetsBotName(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "settings-demo.json"), []byte(`{"bot_name":"Old","businessName":"Demo"}`), 0o644)
	h := New(nil, "", "", dir)
	h.SetProfiles([]string{"pelangi", "demo"}, "pelangi")
	req := httptest.NewRequest("PUT", "/api/rainbow/settings/reply-mode", strings.NewReader(`{"replyMode":"silent","botName":"Kancil"}`))
	req.Header.Set("x-profile-id", "demo")
	rec := httptest.NewRecorder()
	h.replyMode(rec, req)
	if rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "settings-demo.json"))
	var doc map[string]any
	json.Unmarshal(b, &doc)
	if doc["bot_name"] != "Kancil" || doc["reply_mode"] != "silent" || doc["businessName"] != "Demo" {
		t.Fatalf("settings after put: %s", b)
	}
}
