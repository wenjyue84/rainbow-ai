package router

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"rainbow-core/internal/bridge"
	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/store"
)

// TestFullLoopThroughBridgeClient drives the engine with the REAL bridge.Client
// pointed at a mock Node bridge, proving the inbound→classify→route→/send contract.
func TestFullLoopThroughBridgeClient(t *testing.T) {
	var mu sync.Mutex
	var sends []contract.SendRequest
	mockBridge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req contract.SendRequest
		json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		sends = append(sends, req)
		mu.Unlock()
		json.NewEncoder(w).Encode(contract.SendResult{OK: true, Sent: true})
	}))
	defer mockBridge.Close()

	prof, err := config.Load("../../../src/assistant/data", "pelangi")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()

	eng := NewEngine(prof, conversation.NewManager(st), bridge.New(mockBridge.URL), Options{TypingIndicator: true})

	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60123456789", Text: "hi", PushName: "Alice", MessageID: "x1", MessageType: contract.MsgText, InstanceID: "default",
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Intent != "greeting" {
		t.Errorf("intent = %q", res.Intent)
	}

	mu.Lock()
	defer mu.Unlock()
	// Expect: typing, send_text (reply), paused.
	var hasText, hasTyping, hasPaused bool
	var replyText string
	for _, s := range sends {
		switch s.Op {
		case contract.OpText:
			hasText = true
			replyText = s.Text
		case contract.OpTyping:
			hasTyping = true
		case contract.OpPaused:
			hasPaused = true
		}
	}
	if !hasText {
		t.Error("no send_text reached the bridge")
	}
	if replyText == "" {
		t.Error("empty reply text")
	}
	if !hasTyping || !hasPaused {
		t.Errorf("missing presence ops (typing=%v paused=%v)", hasTyping, hasPaused)
	}
	t.Logf("reply delivered via bridge: %q", replyText)
}
