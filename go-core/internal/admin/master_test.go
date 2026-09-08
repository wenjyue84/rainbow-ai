package admin

// Master layer tests: inheritance (fallback), override, apply-all, scoping.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func masterProviders() []any {
	return []any{map[string]any{"id": "nvidia-kimi", "name": "Kimi", "type": "openai", "model": "kimi", "enabled": true, "priority": 1}}
}

func TestMasterInheritanceAndOverride(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	dir := isoDataDir(t)
	applied := map[string]string{}
	isoLastHandler.SetReplyModeApplier(func(pid, mode, intro string) bool { applied[pid] = mode + "|" + intro; return true })
	// Pelangi (default) has explicit values; dental-world is blank.
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"reply_mode":"normal","ai":{"providers":[{"id":"own","enabled":true,"priority":1}]},"bot_name":"Rainbow"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "settings-dental-world.json"), []byte(`{"bot_name":"Dr Koh Bot"}`), 0o644)

	// PUT master
	code, body := isoReq(t, http.MethodPut, srv.URL+"/api/rainbow/master/settings", "", map[string]any{
		"ai": map[string]any{"providers": masterProviders()}, "reply_mode": "intro-once",
		"intro_message": "Hi, I'm {bot_name}.", "botAvatar": "🌈", "staffName": "Staff",
	})
	if code != 200 {
		t.Fatalf("PUT master: %d %s", code, body)
	}
	var put struct {
		Applied         []string `json:"applied"`
		RestartRequired bool     `json:"restartRequired"`
	}
	json.Unmarshal(body, &put)
	if !put.RestartRequired {
		t.Fatalf("providers changed → restartRequired expected: %s", body)
	}
	if !contains(put.Applied, "dental-world") || contains(put.Applied, "pelangi") {
		t.Fatalf("hot-apply should hit only inheriting profiles: %v", put.Applied)
	}
	if applied["dental-world"] != "intro-once|Hi, I'm Dr Koh Bot." {
		t.Fatalf("intro not expanded with bot_name: %q", applied["dental-world"])
	}
	if _, err := os.Stat(filepath.Join(dir, "settings-master.json")); err != nil {
		t.Fatal("settings-master.json not written")
	}

	// Effective for blank profile → inherited.
	code, body = isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/settings/effective", "dental-world", nil)
	if code != 200 {
		t.Fatalf("effective: %d %s", code, body)
	}
	var eff map[string]any
	json.Unmarshal(body, &eff)
	inh, _ := eff["_inherited"].([]any)
	if len(inh) != 4 || eff["reply_mode"] != "intro-once" || eff["botAvatar"] != "🌈" || eff["intro_message"] != "Hi, I'm Dr Koh Bot." {
		t.Fatalf("dental-world effective: %s", body)
	}
	if ai, _ := eff["ai"].(map[string]any); len(ai["providers"].([]any)) != 1 {
		t.Fatalf("providers not inherited: %s", body)
	}

	// Effective for pelangi → own values win, nothing inherited for providers/reply_mode.
	code, body = isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/settings/effective", "pelangi", nil)
	json.Unmarshal(body, &eff)
	inh, _ = eff["_inherited"].([]any)
	for _, k := range inh {
		if k == "reply_mode" || k == "ai.providers" {
			t.Fatalf("pelangi must not inherit %v: %s", k, body)
		}
	}
	if eff["reply_mode"] != "normal" {
		t.Fatalf("pelangi reply_mode: %s", body)
	}

	// reply-mode GET reports inheritance.
	code, body = isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/settings/reply-mode", "dental-world", nil)
	var rm struct {
		ReplyMode string `json:"replyMode"`
		Inherited bool   `json:"inherited"`
		Effective struct {
			ReplyMode string `json:"replyMode"`
		} `json:"effective"`
	}
	json.Unmarshal(body, &rm)
	if code != 200 || !rm.Inherited || rm.ReplyMode != "" || rm.Effective.ReplyMode != "intro-once" {
		t.Fatalf("reply-mode GET: %d %s", code, body)
	}
	// Explicit "normal" on a profile is stored as-is (not collapsed to "").
	code, body = isoReq(t, http.MethodPut, srv.URL+"/api/rainbow/settings/reply-mode", "dental-world", map[string]any{"replyMode": "ai"})
	if code != 200 {
		t.Fatalf("PUT normal: %d %s", code, body)
	}
	var own map[string]any
	b, _ := os.ReadFile(filepath.Join(dir, "settings-dental-world.json"))
	json.Unmarshal(b, &own)
	if own["reply_mode"] != "normal" {
		t.Fatalf("reply_mode should be stored as \"normal\": %s", b)
	}
	// Back to inherit → key removed, master mode hot-applied.
	isoReq(t, http.MethodPut, srv.URL+"/api/rainbow/settings/reply-mode", "dental-world", map[string]any{"replyMode": "inherit"})
	b, _ = os.ReadFile(filepath.Join(dir, "settings-dental-world.json"))
	own = map[string]any{}
	json.Unmarshal(b, &own)
	if _, has := own["reply_mode"]; has {
		t.Fatalf("inherit should drop reply_mode: %s", b)
	}
	if applied["dental-world"] != "intro-once|Hi, I'm Dr Koh Bot." {
		t.Fatalf("inherit should hot-apply master mode: %q", applied["dental-world"])
	}
}

func TestMasterApplyAllWritesEveryProfile(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	dir := isoDataDir(t)
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"reply_mode":"normal","bot_name":"Rainbow"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "settings-master.json"), []byte(`{"reply_mode":"silent","intro_message":"","botAvatar":"🤖","ai":{"providers":[{"id":"p1","enabled":true}]}}`), 0o644)
	code, body := isoReq(t, http.MethodPost, srv.URL+"/api/rainbow/master/settings/apply-all", "", map[string]any{"keys": []string{"reply_mode", "botAvatar", "ai.providers"}})
	if code != 200 {
		t.Fatalf("apply-all: %d %s", code, body)
	}
	for _, pid := range []string{"pelangi", "dental-world", "senai-app", "jayson-pa"} {
		name := "settings-" + pid + ".json"
		if pid == "pelangi" {
			name = "settings.json"
		}
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("%s not written: %v", name, err)
		}
		var doc map[string]any
		json.Unmarshal(b, &doc)
		if doc["reply_mode"] != "silent" || doc["botAvatar"] != "🤖" || providersOf(doc) == nil {
			t.Fatalf("%s: %s", name, b)
		}
		if pid == "pelangi" && doc["bot_name"] != "Rainbow" {
			t.Fatalf("apply-all must not clobber unrelated keys: %s", b)
		}
	}
	code, body = isoReq(t, http.MethodPost, srv.URL+"/api/rainbow/master/settings/apply-all", "", map[string]any{"keys": []string{"bogus"}})
	if code != 400 {
		t.Fatalf("unknown key should 400: %d %s", code, body)
	}
}

func TestMasterScopedSessionForbidden(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	tok := mintSession(isoKey, Session{Username: "drkoh", Role: "operator", Tenants: []string{"dental-world"},
		Exp: time.Now().Add(time.Hour).Unix()})
	for _, ep := range []string{"/api/rainbow/master/settings", "/api/rainbow/master/overview"} {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+ep, nil)
		req.Header.Set("X-Admin-Key", tok)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("%s scoped → want 403, got %d", ep, resp.StatusCode)
		}
	}
	// Unscoped raw key is fine and the overview lists every served profile.
	code, body := isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/master/overview", "", nil)
	if code != 200 {
		t.Fatalf("overview: %d %s", code, body)
	}
	var ov struct {
		Profiles []struct {
			ID string `json:"id"`
		} `json:"profiles"`
	}
	json.Unmarshal(body, &ov)
	if len(ov.Profiles) != 4 || ov.Profiles[0].ID != "pelangi" {
		t.Fatalf("overview profiles: %s", body)
	}
}

func TestMasterUnnamedBotIntro(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	dir := isoDataDir(t)
	applied := map[string]string{}
	isoLastHandler.SetReplyModeApplier(func(pid, mode, intro string) bool { applied[pid] = mode + "|" + intro; return true })
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"reply_mode":"normal","bot_name":"Rainbow"}`), 0o644)
	// dental-world: no bot_name at all.
	os.WriteFile(filepath.Join(dir, "settings-dental-world.json"), []byte(`{}`), 0o644)
	os.WriteFile(filepath.Join(dir, "profiles.json"), []byte(`{"profiles":[{"id":"dental-world","name":"Dental World"}]}`), 0o644)

	code, body := isoReq(t, http.MethodPut, srv.URL+"/api/rainbow/master/settings", "", map[string]any{
		"reply_mode": "intro-once", "intro_message": "Hi, I'm {bot_name}.",
		"intro_message_unnamed": "Hello from {business}'s AI helper.",
	})
	if code != 200 {
		t.Fatalf("PUT master: %d %s", code, body)
	}
	if applied["dental-world"] != "intro-once|Hello from Dental World's AI helper." {
		t.Fatalf("hot-apply unnamed intro: %q", applied["dental-world"])
	}
	// effective + reply-mode GET agree.
	_, body = isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/settings/effective", "dental-world", nil)
	var eff map[string]any
	json.Unmarshal(body, &eff)
	if eff["intro_message"] != "Hello from Dental World's AI helper." {
		t.Fatalf("effective unnamed intro: %s", body)
	}
	_, body = isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/settings/reply-mode", "dental-world", nil)
	var rm struct {
		Effective struct {
			IntroMessage string `json:"introMessage"`
		} `json:"effective"`
	}
	json.Unmarshal(body, &rm)
	if rm.Effective.IntroMessage != "Hello from Dental World's AI helper." {
		t.Fatalf("reply-mode GET unnamed intro: %s", body)
	}
	// apply-all writes the unnamed variant into the profile file.
	isoReq(t, http.MethodPost, srv.URL+"/api/rainbow/master/settings/apply-all", "", map[string]any{"keys": []string{"reply_mode"}})
	var own map[string]any
	b, _ := os.ReadFile(filepath.Join(dir, "settings-dental-world.json"))
	json.Unmarshal(b, &own)
	if own["intro_message"] != "Hello from Dental World's AI helper." {
		t.Fatalf("apply-all unnamed intro: %s", b)
	}
	// Default template when master has no intro_message_unnamed.
	isoReq(t, http.MethodPut, srv.URL+"/api/rainbow/master/settings", "", map[string]any{"reply_mode": "intro-once", "intro_message": "Hi, I'm {bot_name}.", "intro_message_unnamed": ""})
	os.WriteFile(filepath.Join(dir, "settings-dental-world.json"), []byte(`{}`), 0o644)
	_, body = isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/settings/effective", "dental-world", nil)
	json.Unmarshal(body, &eff)
	if eff["intro_message"] != "Hi, I'm the AI assistant of Dental World. A team member will reply to you shortly." {
		t.Fatalf("default unnamed intro: %s", body)
	}
	_ = time.Second
}
