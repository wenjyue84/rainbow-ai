package router

import (
	"context"
	"path/filepath"
	"testing"

	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/store"
)

// engineWithSender builds an engine for the pelangi profile with a given sender,
// so the hub test can tell which engine handled a message.
func engineWithSender(t *testing.T, send Sender) *Engine {
	t.Helper()
	prof, err := config.Load(filepath.Join("..", "..", "..", "src", "assistant", "data"), "pelangi")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return NewEngine(prof, conversation.NewManager(st), send, Options{})
}

func TestHubRoutesByInstance(t *testing.T) {
	sendA := &mockSender{}
	sendB := &mockSender{}
	engA := engineWithSender(t, sendA)
	engB := engineWithSender(t, sendB)

	hub := NewHub(
		map[string]*Engine{"profA": engA, "profB": engB},
		map[string]string{"lineB": "profB"},
		"profA", // default
	)

	// instanceId "lineB" → profB engine (sendB).
	hub.Process(context.Background(), contract.IncomingMessage{From: "601", Text: "hi", MessageID: "h1", InstanceID: "lineB", MessageType: contract.MsgText})
	if len(sendB.texts) == 0 {
		t.Error("message for lineB did not reach engine B")
	}
	if len(sendA.texts) != 0 {
		t.Error("engine A wrongly handled lineB message")
	}

	// Unmapped instance → default (profA / sendA).
	hub.Process(context.Background(), contract.IncomingMessage{From: "602", Text: "hi", MessageID: "h2", InstanceID: "unknown", MessageType: contract.MsgText})
	if len(sendA.texts) == 0 {
		t.Error("unmapped instance did not fall back to default engine A")
	}
}
