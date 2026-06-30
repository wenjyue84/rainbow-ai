package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"rainbow-core/internal/contract"
)

// mockBridge emulates the Node bridge's POST /send, recording requests.
type mockBridge struct {
	mu   sync.Mutex
	reqs []contract.SendRequest
	srv  *httptest.Server
}

func newMockBridge() *mockBridge {
	mb := &mockBridge{}
	mb.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/send" {
			http.Error(w, "not found", 404)
			return
		}
		var req contract.SendRequest
		json.NewDecoder(r.Body).Decode(&req)
		mb.mu.Lock()
		mb.reqs = append(mb.reqs, req)
		mb.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(contract.SendResult{OK: true, Sent: true})
	}))
	return mb
}

func (mb *mockBridge) last() contract.SendRequest {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	if len(mb.reqs) == 0 {
		return contract.SendRequest{}
	}
	return mb.reqs[len(mb.reqs)-1]
}

func TestSendText(t *testing.T) {
	mb := newMockBridge()
	defer mb.srv.Close()
	c := New(mb.srv.URL)
	res, err := c.SendText(context.Background(), "60123", "hello world", "inst1")
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}
	if !res.OK || !res.Sent {
		t.Errorf("result = %+v", res)
	}
	got := mb.last()
	if got.Op != contract.OpText || got.Phone != "60123" || got.Text != "hello world" || got.InstanceID != "inst1" {
		t.Errorf("send req = %+v", got)
	}
}

func TestTypingPaused(t *testing.T) {
	mb := newMockBridge()
	defer mb.srv.Close()
	c := New(mb.srv.URL)
	c.Typing(context.Background(), "60123", "inst1")
	c.Paused(context.Background(), "60123", "inst1")
	mb.mu.Lock()
	defer mb.mu.Unlock()
	if len(mb.reqs) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(mb.reqs))
	}
	if mb.reqs[0].Op != contract.OpTyping || mb.reqs[1].Op != contract.OpPaused {
		t.Errorf("ops = %s, %s", mb.reqs[0].Op, mb.reqs[1].Op)
	}
}

func TestSendMedia(t *testing.T) {
	mb := newMockBridge()
	defer mb.srv.Close()
	c := New(mb.srv.URL)
	_, err := c.SendMedia(context.Background(), "60123", "http://x/img.jpg", "image/jpeg", "img.jpg", "a caption", "inst1")
	if err != nil {
		t.Fatalf("SendMedia: %v", err)
	}
	got := mb.last()
	if got.Op != contract.OpMedia || got.MediaURL != "http://x/img.jpg" || got.MimeType != "image/jpeg" || got.Caption != "a caption" {
		t.Errorf("media req = %+v", got)
	}
}
