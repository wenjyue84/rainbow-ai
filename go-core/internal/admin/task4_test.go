package admin

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"rainbow-core/internal/config"
	"rainbow-core/internal/store"
)

// ── Exception-list courtesy notice ──────────────────────────────────────────

type fakeSend struct {
	mu    sync.Mutex
	gated bool
	sent  []string
	calls int
}

func (f *fakeSend) fn(_ context.Context, _, phone, _ string) (bool, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.gated {
		return false, "quiet_hours", &bridgeErr{reason: "quiet_hours", msg: "quiet hours"}
	}
	f.sent = append(f.sent, phone)
	return true, "", nil
}

func TestIgnoredNotifyQueuedThroughQuietHours(t *testing.T) {
	srv, dataDir, h := newDataServer(t)
	h.SetBridge("http://bridge.invalid")
	fs := &fakeSend{gated: true}
	n := newIgnoredNotifier(h)
	n.sendFn = fs.fn
	var sleeps []time.Duration
	var smu sync.Mutex
	n.sleep = func(ctx context.Context, d time.Duration) {
		smu.Lock()
		sleeps = append(sleeps, d)
		smu.Unlock()
		select {
		case <-ctx.Done():
		case <-time.After(2 * time.Millisecond):
		case <-n.wake:
		}
	}
	h.ignoredNotifier = n

	// Adding two numbers queues two notices (diff vs previous empty list).
	code, body := doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "", map[string]any{
		"ignoredNumbers": []map[string]string{{"phone": "60176701102", "label": "Maya"}, {"phone": "60167620815", "label": "Alston"}},
	})
	if code != 200 {
		t.Fatalf("PUT status %d %v", code, body)
	}
	if q, _ := body["notifyQueued"].([]any); len(q) != 2 {
		t.Fatalf("expected 2 queued, got %v", body["notifyQueued"])
	}
	// Durable: queue file written.
	if _, err := os.Stat(filepath.Join(dataDir, ignoredNotifyQueueFile)); err != nil {
		t.Fatalf("queue file missing: %v", err)
	}
	// Re-PUT with the same list queues nothing new.
	_, body = doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "", map[string]any{
		"ignoredNumbers": []map[string]string{{"phone": "60176701102", "label": "Maya"}, {"phone": "60167620815", "label": "Alston"}},
	})
	if q, _ := body["notifyQueued"].([]any); len(q) != 0 {
		t.Fatalf("re-PUT should queue 0, got %v", body["notifyQueued"])
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)

	// Gate closed: nothing sent, both still queued, worker keeps retrying.
	time.Sleep(30 * time.Millisecond)
	fs.mu.Lock()
	if len(fs.sent) != 0 || fs.calls == 0 {
		t.Fatalf("gated: sent=%v calls=%d", fs.sent, fs.calls)
	}
	fs.gated = false
	fs.mu.Unlock()
	if n.count() != 2 {
		t.Fatalf("expected 2 still queued during quiet hours, got %d", n.count())
	}

	// Gate opens: both go out one by one, with a ≥30s random gap after each.
	deadline := time.Now().Add(2 * time.Second)
	for n.count() > 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	fs.mu.Lock()
	sent := append([]string(nil), fs.sent...)
	fs.mu.Unlock()
	if len(sent) != 2 {
		t.Fatalf("expected 2 sent after gate opened, got %v", sent)
	}
	smu.Lock()
	gaps := 0
	for _, d := range sleeps {
		if d >= ignoredNotifyMinGap && d <= ignoredNotifyMaxGap {
			gaps++
		}
	}
	smu.Unlock()
	if gaps < 2 {
		t.Fatalf("expected a 30–90s gap after each send, saw %d (sleeps=%v)", gaps, sleeps)
	}
	if _, err := os.Stat(filepath.Join(dataDir, ignoredNotifyQueueFile)); !os.IsNotExist(err) {
		t.Fatalf("queue file should be removed when drained: %v", err)
	}
}

func TestIgnoredNotifyDropsRemovedNumber(t *testing.T) {
	srv, _, h := newDataServer(t)
	h.SetBridge("http://bridge.invalid")
	fs := &fakeSend{}
	n := newIgnoredNotifier(h)
	n.sendFn = fs.fn
	n.sleep = func(ctx context.Context, d time.Duration) {
		select {
		case <-ctx.Done():
		case <-time.After(time.Millisecond):
		}
	}
	h.ignoredNotifier = n
	doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "", map[string]any{
		"ignoredNumbers": []map[string]string{{"phone": "60111111111", "label": "Temp"}},
	})
	// Removed again before the worker ran → must not be messaged.
	doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "", map[string]any{"ignoredNumbers": []map[string]string{}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)
	deadline := time.Now().Add(time.Second)
	for n.count() > 0 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if len(fs.sent) != 0 {
		t.Fatalf("removed number was messaged: %v", fs.sent)
	}
}

func TestIgnoredNotifyMessageUsesBusinessName(t *testing.T) {
	_, dataDir, h := newDataServer(t)
	os.WriteFile(filepath.Join(dataDir, "settings-senai-app.json"), []byte(`{"businessName":"Senai Rooms"}`), 0o644)
	n := newIgnoredNotifier(h)
	msg := n.message(ignoredNotifyItem{Profile: "senai-app", Phone: "60123", Label: "Ali"})
	if !strings.Contains(msg, "Hi Ali") || !strings.Contains(msg, "Senai Rooms") || !strings.Contains(msg, "no longer auto-reply") {
		t.Fatalf("unexpected message: %q", msg)
	}
	if got := n.message(ignoredNotifyItem{Profile: "dental-world"}); !strings.Contains(got, "Dental World") {
		t.Fatalf("fallback name: %q", got)
	}
	_ = config.IgnoredNumber{}
}

// ── Profile creation (wizard) ───────────────────────────────────────────────

func TestProfilesBlankCreatesFilesAndRegistry(t *testing.T) {
	srv, dataDir, _ := newDataServer(t)
	code, body := doJSON(t, "POST", srv.URL+"/api/rainbow/profiles/blank", "", map[string]any{"newProfileId": "new-biz", "displayName": "New Biz"})
	if code != 201 {
		t.Fatalf("status %d %v", code, body)
	}
	for _, f := range []string{"intents-new-biz.json", "intent-keywords-new-biz.json", "knowledge-new-biz.json", "routing-new-biz.json", "settings-new-biz.json"} {
		if _, err := os.Stat(filepath.Join(dataDir, f)); err != nil {
			t.Errorf("missing %s", f)
		}
	}
	var settings map[string]any
	b, _ := os.ReadFile(filepath.Join(dataDir, "settings-new-biz.json"))
	json.Unmarshal(b, &settings)
	if settings["businessName"] != "New Biz" {
		t.Errorf("businessName not written: %v", settings)
	}
	if ids := ExtraProfileIDs(dataDir); len(ids) != 1 || ids[0] != "new-biz" {
		t.Errorf("registry ids = %v", ids)
	}
	// The scaffold must load through config.Load.
	if _, err := config.Load(dataDir, "new-biz"); err != nil {
		// intents.json/knowledge.json shared files absent in this temp dir is fine
		// only if the profile-specific ones exist — they do, so Load must succeed.
		t.Fatalf("config.Load(new-biz): %v", err)
	}
	// Duplicate → 409; bad id → 400; unknown source → 404.
	if code, _ = doJSON(t, "POST", srv.URL+"/api/rainbow/profiles/blank", "", map[string]any{"newProfileId": "new-biz", "displayName": "x"}); code != 409 {
		t.Errorf("dup status %d", code)
	}
	if code, _ = doJSON(t, "POST", srv.URL+"/api/rainbow/profiles/blank", "", map[string]any{"newProfileId": "Bad_ID", "displayName": "x"}); code != 400 {
		t.Errorf("bad id status %d", code)
	}
	if code, _ = doJSON(t, "POST", srv.URL+"/api/rainbow/profiles/nope/clone", "", map[string]any{"newProfileId": "other", "displayName": "x"}); code != 404 {
		t.Errorf("unknown source status %d", code)
	}
	// /profiles now reports the display name for the new id once served.
	// (Registry name lookup — simulate the post-restart hub list.)
	_, body = doJSON(t, "GET", srv.URL+"/api/rainbow/profiles", "", nil)
	if body["profiles"] == nil {
		t.Errorf("profiles list missing")
	}
}

func TestProfilesCloneStripsWhatsAppFields(t *testing.T) {
	srv, dataDir, _ := newDataServer(t)
	os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte(`{"bot_name":"Rainbow","whatsappInstanceId":"pelangi","ignoredNumbers":[{"phone":"60176701102"}],"ai":{"providers":[]}}`), 0o644)
	os.WriteFile(filepath.Join(dataDir, "routing.json"), []byte(`{"greeting":{"action":"static"}}`), 0o644)
	code, body := doJSON(t, "POST", srv.URL+"/api/rainbow/profiles/pelangi/clone", "", map[string]any{"newProfileId": "pelangi-two", "displayName": "Pelangi Two"})
	if code != 201 {
		t.Fatalf("status %d %v", code, body)
	}
	var settings map[string]any
	b, _ := os.ReadFile(filepath.Join(dataDir, "settings-pelangi-two.json"))
	json.Unmarshal(b, &settings)
	if _, has := settings["whatsappInstanceId"]; has {
		t.Errorf("whatsappInstanceId not stripped")
	}
	if _, has := settings["ignoredNumbers"]; has {
		t.Errorf("ignoredNumbers not stripped")
	}
	if settings["bot_name"] != "Rainbow" || settings["businessName"] != "Pelangi Two" {
		t.Errorf("settings = %v", settings)
	}
	rb, _ := os.ReadFile(filepath.Join(dataDir, "routing-pelangi-two.json"))
	if !strings.Contains(string(rb), "greeting") {
		t.Errorf("routing not cloned: %s", rb)
	}
	// /profiles/active still resolves (subtree route must not shadow it).
	if code, _ = doJSON(t, "GET", srv.URL+"/api/rainbow/profiles/active", "", nil); code != 200 {
		t.Errorf("/profiles/active status %d", code)
	}
}

// ── Recent activity SSE ─────────────────────────────────────────────────────

func TestActivityStreamSeedsFromMessages(t *testing.T) {
	srv, _, h := newDataServer(t)
	st := h.st
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('60ACT1','user','need a room tonight',?, 'pelangi')`, store.NowISO())
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('60ACT1','assistant','Sure, RM35 per night',?, 'pelangi')`, store.NowISO())
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('60OTHER','user','senai msg',?, 'senai-app')`, store.NowISO())

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/rainbow/activity/stream?profile=pelangi", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type %q", ct)
	}
	sc := bufio.NewScanner(resp.Body)
	var data string
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "data: ") {
			data = strings.TrimPrefix(line, "data: ")
			break
		}
	}
	var init struct {
		Profile string          `json:"profile"`
		Events  []activityEvent `json:"events"`
	}
	if err := json.Unmarshal([]byte(data), &init); err != nil {
		t.Fatalf("init json: %v (%s)", err, data)
	}
	if init.Profile != "pelangi" {
		t.Errorf("profile = %q", init.Profile)
	}
	seen := map[string]bool{}
	for _, e := range init.Events {
		seen[e.Phone+"/"+e.Type] = true
		if e.Phone == "60OTHER" {
			t.Errorf("other profile's message leaked into pelangi feed: %+v", e)
		}
	}
	if !seen["60ACT1/message_received"] || !seen["60ACT1/response_sent"] {
		t.Errorf("expected inbound + reply events, got %v", seen)
	}
	cancel()
}
