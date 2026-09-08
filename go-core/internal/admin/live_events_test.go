package admin

// Tests for the live-chat extras (live_events.go): pin/star/react storage,
// per-profile isolation of message metadata, media URL mapping, and the SSE
// new_message push. Reuses the isolation harness (fresh DB per test).

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"rainbow-core/internal/events"
)

func TestMessageMetaPinStarReactRoundTrip(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	base := srv.URL + "/api/rainbow/conversations/60100000001"

	// pin toggles on, then off
	code, body := isoReq(t, http.MethodPost, base+"/messages/0/pin", "", nil)
	if code != 200 || !strings.Contains(string(body), `"pinned":true`) {
		t.Fatalf("pin on: code=%d body=%s", code, body)
	}
	code, body = isoReq(t, http.MethodGet, base+"/message-metadata", "", nil)
	if code != 200 {
		t.Fatalf("metadata: code=%d body=%s", code, body)
	}
	var meta struct {
		Pinned    []string          `json:"pinned"`
		Starred   []string          `json:"starred"`
		Reactions map[string]string `json:"reactions"`
	}
	if err := json.Unmarshal(body, &meta); err != nil {
		t.Fatal(err)
	}
	if len(meta.Pinned) != 1 || meta.Pinned[0] != "0" {
		t.Fatalf("pinned = %v, want [0]", meta.Pinned)
	}
	code, body = isoReq(t, http.MethodPost, base+"/messages/0/pin", "", nil)
	if code != 200 || !strings.Contains(string(body), `"pinned":false`) {
		t.Fatalf("pin off: code=%d body=%s", code, body)
	}

	// star + react persist and come back keyed by index
	isoReq(t, http.MethodPost, base+"/messages/0/star", "", nil)
	code, body = isoReq(t, http.MethodPost, base+"/messages/0/react", "", map[string]any{"emoji": "👍"})
	if code != 200 {
		t.Fatalf("react: code=%d body=%s", code, body)
	}
	_, body = isoReq(t, http.MethodGet, base+"/message-metadata", "", nil)
	meta.Pinned, meta.Starred, meta.Reactions = nil, nil, nil
	_ = json.Unmarshal(body, &meta)
	if len(meta.Pinned) != 0 || len(meta.Starred) != 1 || meta.Reactions["0"] != "👍" {
		t.Fatalf("after star+react: %+v", meta)
	}

	// clearing the reaction removes it
	code, body = isoReq(t, http.MethodPost, base+"/messages/0/react", "", map[string]any{"emoji": ""})
	if code != 200 {
		t.Fatalf("react clear: code=%d body=%s", code, body)
	}
	_, body = isoReq(t, http.MethodGet, base+"/message-metadata", "", nil)
	meta.Pinned, meta.Starred, meta.Reactions = nil, nil, nil
	_ = json.Unmarshal(body, &meta)
	if len(meta.Reactions) != 0 {
		t.Fatalf("reaction not cleared: %+v (clear resp=%s)", meta.Reactions, body)
	}

	// out-of-range index and unknown action
	if code, _ := isoReq(t, http.MethodPost, base+"/messages/99/pin", "", nil); code != 404 {
		t.Fatalf("idx 99: code=%d, want 404", code)
	}
	if code, _ := isoReq(t, http.MethodPost, base+"/messages/0/bogus", "", nil); code != 404 {
		t.Fatalf("bogus action: code=%d, want 404", code)
	}
}

func TestMessageMetaIsolatedPerProfile(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	shared := "/api/rainbow/conversations/60900000009"
	// pelangi (default) stars its own copy of the shared guest's message
	if code, _ := isoReq(t, http.MethodPost, srv.URL+shared+"/messages/0/star", "", nil); code != 200 {
		t.Fatalf("pelangi star: code=%d", code)
	}
	// dental-world sees no stars on the same phone
	_, body := isoReq(t, http.MethodGet, srv.URL+shared+"/message-metadata", "dental-world", nil)
	if !strings.Contains(string(body), `"starred":[]`) {
		t.Fatalf("dental-world leaked pelangi's star: %s", body)
	}
	// senai-app does not own the shared phone at all → 404, no probing
	if code, _ := isoReq(t, http.MethodGet, srv.URL+shared+"/message-metadata", "senai-app", nil); code != 404 {
		t.Fatalf("senai metadata: code=%d, want 404", code)
	}
	if code, _ := isoReq(t, http.MethodPost, srv.URL+shared+"/messages/0/pin", "senai-app", nil); code != 404 {
		t.Fatalf("senai pin: code=%d, want 404", code)
	}
}

func TestMessageActionByMessageID(t *testing.T) {
	srv, st, _ := newIsoServer(t)
	base := srv.URL + "/api/rainbow/conversations/60100000001"
	var id int64
	if err := st.DB.QueryRow(`SELECT id FROM rainbow_messages WHERE phone='60100000001'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	// id wins over a bogus idx
	code, body := isoReq(t, http.MethodPost, base+"/messages/999/star", "", map[string]any{"messageId": id})
	if code != 200 || !strings.Contains(string(body), `"starred":true`) {
		t.Fatalf("star by id: code=%d body=%s", code, body)
	}
	_, body = isoReq(t, http.MethodGet, base+"/message-metadata", "", nil)
	if !strings.Contains(string(body), `"byId":{"`+strconv.FormatInt(id, 10)+`":{"starred":true}}`) {
		t.Fatalf("byId missing: %s", body)
	}
	// an id belonging to another profile's row on the same phone is rejected
	var foreign int64
	_ = st.DB.QueryRow(`SELECT id FROM rainbow_messages WHERE phone='60200000001'`).Scan(&foreign)
	if code, _ := isoReq(t, http.MethodPost, base+"/messages/0/pin", "", map[string]any{"messageId": foreign}); code != 404 {
		t.Fatalf("foreign id: code=%d, want 404", code)
	}
	// media not referenced by any visible row → 404 (no bridge enumeration)
	if code, _ := isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/media/ABC123.jpg", "", nil); code != 404 {
		t.Fatalf("unowned media: code=%d, want 404", code)
	}
}

func TestPublicMediaURL(t *testing.T) {
	cases := map[string]string{
		"":                                          "",
		"http://127.0.0.1:8789/media/3EB0AB.jpg":    "/api/rainbow/media/3EB0AB.jpg",
		"http://127.0.0.1:8789/media/../etc/passwd": "", // traversal rejected
		"https://x/media/voice note.ogg":            "", // space rejected
		"http://bridge/nomedia/x.jpg":               "",
	}
	for in, want := range cases {
		if got := publicMediaURL(in); got != want {
			t.Errorf("publicMediaURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMimeByExt(t *testing.T) {
	if mimeByExt("3EB0AB.jpg") != "image/jpeg" || mimeByExt("v.OPUS") != "audio/ogg" || mimeByExt("x.bin") != "" {
		t.Fatal("mimeByExt mapping wrong")
	}
}

func TestConversationEventsPushesNewMessage(t *testing.T) {
	srv, _, _ := newIsoServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/rainbow/conversations/events?profile=dental-world", nil)
	req.Header.Set("X-Admin-Key", isoKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("status=%d ct=%s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	rd := bufio.NewReader(resp.Body)
	line, _ := rd.ReadString('\n')
	if !strings.HasPrefix(line, "event: init") {
		t.Fatalf("first line = %q", line)
	}
	// wait until the handler has subscribed, then publish one foreign + one own event
	deadline := time.Now().Add(2 * time.Second)
	for events.Default.Subscribers() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	events.Publish(events.Event{Type: "new_message", ProfileID: "pelangi", Phone: "60100000001", Role: "user"})
	events.Publish(events.Event{Type: "new_message", ProfileID: "dental-world", Phone: "60200000001", Role: "assistant"})

	var got []string
	for len(got) < 2 {
		l, err := rd.ReadString('\n')
		if err != nil {
			break
		}
		l = strings.TrimSpace(l)
		if l == "" || strings.HasPrefix(l, ":") || strings.HasPrefix(l, "data: {\"profile\"") {
			continue
		}
		got = append(got, l)
	}
	if len(got) < 2 || got[0] != "event: new_message" || !strings.Contains(got[1], `"phone":"60200000001"`) {
		t.Fatalf("stream = %v (pelangi event must be filtered out, dental-world delivered)", got)
	}
}

func TestMediaProxyOwnership(t *testing.T) {
	srv, st, _ := newIsoServer(t)
	// dental-world owns a message referencing media X; pelangi does not.
	if _, err := st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id, message_type, media_url)
		VALUES ('60200000001','user','[image]',?, 'dental-world','image','http://127.0.0.1:1/media/OWNED123.jpg')`, "2026-01-01T00:00:00.000Z"); err != nil {
		t.Fatal(err)
	}
	// No bridge configured in the harness → owner gets 404 "no bridge", never 200;
	// point at a dead bridge so ownership is what decides.
	if code, _ := isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/media/OWNED123.jpg", "", nil); code != 404 {
		t.Fatalf("pelangi (foreign) media: code=%d, want 404", code)
	}
	if code, _ := isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/media/OWNED123.jpg", "dental-world", nil); code != 404 && code != 502 {
		t.Fatalf("owner media: code=%d, want 404(no bridge)/502(dead bridge)", code)
	}
	// log exposes the proxied URL only to the owner
	_, body := isoReq(t, http.MethodGet, srv.URL+"/api/rainbow/conversations/60200000001", "dental-world", nil)
	if !strings.Contains(string(body), `"mediaUrl":"/api/rainbow/media/OWNED123.jpg"`) {
		t.Fatalf("owner log lacks mediaUrl: %s", body)
	}
}
