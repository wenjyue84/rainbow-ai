package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeBridge is an httptest bridge recording admin calls.
type fakeBridge struct {
	*httptest.Server
	id      string
	state   string
	token   string
	logouts int
	lastTok string
	qrCalls int
}

func newFakeBridge(t *testing.T, id, state, token string) *fakeBridge {
	fb := &fakeBridge{id: id, state: state, token: token}
	fb.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/health":
			w.Write([]byte(`{"status":"ok","whatsapp":"` + fb.state + `","instanceId":"` + id + `","user":"6075710390"}`))
		case r.Method == "POST" && r.URL.Path == "/logout":
			fb.lastTok = r.Header.Get("X-Bridge-Token")
			if fb.lastTok != token {
				w.WriteHeader(401)
				w.Write([]byte(`{"error":"unauthorized"}`))
				return
			}
			fb.logouts++
			fb.state = "close"
			w.Write([]byte(`{"ok":true,"unlinked":true,"state":"close"}`))
		case strings.HasPrefix(r.URL.Path, "/qr.json/"):
			fb.qrCalls++
			if strings.TrimPrefix(r.URL.Path, "/qr.json/") != token {
				w.WriteHeader(404)
				return
			}
			w.Write([]byte(`{"state":"` + fb.state + `","qr":"data:image/png;base64,QQ==","user":null,"instanceId":"` + id + `"}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(fb.Close)
	return fb
}

func newInstHandler(t *testing.T, pel, jay *fakeBridge) *Handler {
	h := New(nil, "", "", t.TempDir())
	h.SetProfiles([]string{"pelangi", "jayson-pa"}, "pelangi")
	h.SetBridge(pel.URL)
	h.SetInstanceBridges(map[string]InstanceBridge{
		"pelangi": {URL: pel.URL, Token: pel.token, Profile: "pelangi"},
		"jayson":  {URL: jay.URL, Token: jay.token, Profile: "jayson-pa"},
	})
	return h
}

func withSession(r *http.Request, s *Session) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxSessionKey, s))
}

func TestWAInstancesListAndLogoutTargetsRightBridge(t *testing.T) {
	pel := newFakeBridge(t, "pelangi", "open", "tokP")
	jay := newFakeBridge(t, "jayson", "open", "tokJ")
	t.Setenv("BUSINESS_DISPLAY_NAME_JAYSON_PA", "Jayson - Jay's PA")
	h := newInstHandler(t, pel, jay)

	rec := httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("GET", "/api/rainbow/whatsapp/instances", nil))
	if rec.Code != 200 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	var out struct{ Instances []waInstance }
	json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Instances) != 2 {
		t.Fatalf("want 2 instances, got %+v", out.Instances)
	}
	var jinst waInstance
	for _, it := range out.Instances {
		if it.ID == "jayson" {
			jinst = it
		}
	}
	if jinst.Profile != "jayson-pa" || jinst.State != "open" || jinst.Label != "Jayson - Jay's PA" || jinst.User["phone"] != "6075710390" || !jinst.CanManage {
		t.Fatalf("jayson instance: %+v", jinst)
	}

	// Logout jayson → only jayson bridge hit, with its own token.
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances/jayson/logout", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"unlinked":true`) {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body)
	}
	if jay.logouts != 1 || jay.lastTok != "tokJ" || pel.logouts != 0 {
		t.Fatalf("logout routing: jay=%d(tok %q) pel=%d", jay.logouts, jay.lastTok, pel.logouts)
	}

	// QR proxies the bridge JSON (and keeps the legacy qrDataUrl alias).
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, httptest.NewRequest("GET", "/api/rainbow/whatsapp/instances/jayson/qr", nil))
	if rec.Code != 200 || jay.qrCalls != 1 {
		t.Fatalf("qr: %d %s calls=%d", rec.Code, rec.Body, jay.qrCalls)
	}
	var qr map[string]any
	json.Unmarshal(rec.Body.Bytes(), &qr)
	if qr["state"] != "close" || qr["qr"] != "data:image/png;base64,QQ==" || qr["qrDataUrl"] != qr["qr"] || qr["id"] != "jayson" {
		t.Fatalf("qr body: %v", qr)
	}

	// Unknown id → 404; add/remove → 501 with guidance.
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances/nope/logout", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.waInstances(rec, httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances", strings.NewReader(`{"id":"60123"}`)))
	if rec.Code != 501 || !strings.Contains(rec.Body.String(), "new-bridge.sh") {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, httptest.NewRequest("DELETE", "/api/rainbow/whatsapp/instances/jayson", nil))
	if rec.Code != 501 {
		t.Fatalf("delete: %d", rec.Code)
	}
}

func TestWAInstancesScopedUserDeniedOtherTenant(t *testing.T) {
	pel := newFakeBridge(t, "pelangi", "open", "tokP")
	jay := newFakeBridge(t, "jayson", "open", "tokJ")
	h := newInstHandler(t, pel, jay)
	sess := &Session{Username: "jaystaff", Role: "staff", Tenants: []string{"jayson-pa"}}

	// List shows only own tenant's instance.
	rec := httptest.NewRecorder()
	h.waInstances(rec, withSession(httptest.NewRequest("GET", "/api/rainbow/whatsapp/instances", nil), sess))
	var out struct{ Instances []waInstance }
	json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Instances) != 1 || out.Instances[0].ID != "jayson" {
		t.Fatalf("scoped list: %+v", out.Instances)
	}

	// Logout on pelangi → 403, bridge untouched.
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, withSession(httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances/pelangi/logout", nil), sess))
	if rec.Code != 403 || pel.logouts != 0 {
		t.Fatalf("scoped logout: %d logouts=%d", rec.Code, pel.logouts)
	}
	// Own instance still works.
	rec = httptest.NewRecorder()
	h.waInstanceAction(rec, withSession(httptest.NewRequest("POST", "/api/rainbow/whatsapp/instances/jayson/logout", nil), sess))
	if rec.Code != 200 || jay.logouts != 1 {
		t.Fatalf("own logout: %d logouts=%d", rec.Code, jay.logouts)
	}
}

func TestStatusInstancesFollowProfileHeader(t *testing.T) {
	pel := newFakeBridge(t, "pelangi", "open", "tokP")
	jay := newFakeBridge(t, "jayson", "connecting", "tokJ")
	h := newInstHandler(t, pel, jay)

	req := httptest.NewRequest("GET", "/api/rainbow/status", nil)
	req.Header.Set("x-profile-id", "jayson-pa")
	rec := httptest.NewRecorder()
	h.status(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d %s", rec.Code, rec.Body)
	}
	var st struct {
		WhatsappInstances []waInstance `json:"whatsappInstances"`
		Whatsapp          struct{ State string }
	}
	json.Unmarshal(rec.Body.Bytes(), &st)
	if len(st.WhatsappInstances) != 1 || st.WhatsappInstances[0].ID != "jayson" || st.Whatsapp.State != "connecting" {
		t.Fatalf("status instances: %+v wa=%+v", st.WhatsappInstances, st.Whatsapp)
	}
	if h.bridgeForProfile("jayson-pa") != jay.URL || h.bridgeForProfile("pelangi") != pel.URL || h.bridgeForProfile("") != pel.URL {
		t.Fatalf("bridgeForProfile wrong")
	}
}
