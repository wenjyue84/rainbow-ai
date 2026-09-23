package router

import (
	"context"
	"path/filepath"
	"sync"
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

// Setup wizard (2026-09-23): a profile added live via AddEngine + an instance
// mapped via MapInstance serve traffic immediately, and concurrent readers
// never race the writers (run with -race).
func TestHubHotAddEngineAndMapInstance(t *testing.T) {
	sendA := &mockSender{}
	sendB := &mockSender{}
	engA := engineWithSender(t, sendA)
	hub := NewHub(map[string]*Engine{"profA": engA}, nil, "profA")

	if hub.HasProfile("profB") {
		t.Fatal("profB should not exist yet")
	}
	// Before the hot add, lineB falls back to the default engine.
	hub.Process(context.Background(), contract.IncomingMessage{From: "601", Text: "hi", MessageID: "x1", InstanceID: "lineB", MessageType: contract.MsgText})
	if len(sendA.texts) == 0 {
		t.Fatal("unmapped instance did not reach default engine")
	}

	// Hot add while readers hammer the hub.
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				hub.Profiles()
				hub.Engine("profB")
				hub.InstanceProfile("lineB")
			}
		}()
	}
	engB := engineWithSender(t, sendB)
	hub.AddEngine("profB", engB)
	hub.MapInstance("lineB", "profB")
	hub.AddBotNumber("60100000001")
	close(stop)
	wg.Wait()

	if !hub.HasProfile("profB") || hub.InstanceProfile("lineB") != "profB" {
		t.Fatalf("hot add not visible: has=%v inst=%q", hub.HasProfile("profB"), hub.InstanceProfile("lineB"))
	}
	if got := hub.Profiles(); len(got) != 2 || got[0] != "profA" || got[1] != "profB" {
		t.Fatalf("Profiles after add: %v", got)
	}
	before := len(sendA.texts)
	hub.Process(context.Background(), contract.IncomingMessage{From: "602", Text: "hi", MessageID: "x2", InstanceID: "lineB", MessageType: contract.MsgText})
	if len(sendB.texts) == 0 || len(sendA.texts) != before {
		t.Fatalf("lineB not routed to hot-added engine: A=%d B=%d", len(sendA.texts), len(sendB.texts))
	}
	// Hot-added bot number is guarded.
	res, _ := hub.Process(context.Background(), contract.IncomingMessage{From: "60100000001", Text: "bot", MessageID: "x3", MessageType: contract.MsgText})
	if !res.Skipped {
		t.Fatalf("hot-added bot number answered: %+v", res)
	}
	// Hot-apply setters reach the new engine (not the default).
	if !hub.SetReplyMode("profB", "silent", "") || hub.SetReplyMode("profC", "silent", "") {
		t.Fatal("SetReplyMode should hit profB only")
	}
}

// A message from one of OUR OWN numbers (another assistant) is stored but
// never answered — otherwise two auto-replying bots loop forever.
func TestHubBotPeerNotAnswered(t *testing.T) {
	send := &mockSender{}
	eng := engineWithSender(t, send)
	hub := NewHub(map[string]*Engine{"pelangi": eng}, nil, "pelangi")
	hub.SetBotNumbers([]string{"+60 17-726 7984", "60103341058"})
	res, _ := hub.Process(context.Background(), contract.IncomingMessage{
		From: "178310667575453@lid", PhoneNumber: "60177267984", Text: "hi from rachel", PushName: "Rachel", MessageID: "bp1", MessageType: contract.MsgText,
	})
	if !res.Skipped || res.SkipReason == "" || len(send.texts) != 0 {
		t.Fatalf("bot peer answered: res=%+v sends=%v", res, send.texts)
	}
	if hist, _ := eng.conv.History("178310667575453@lid", "pelangi", 5); len(hist) != 1 || hist[0].Role != "user" {
		t.Errorf("bot-peer message not stored for live chat: %+v", hist)
	}
	// Bare-number sender that is one of ours → same
	res, _ = hub.Process(context.Background(), contract.IncomingMessage{From: "60103341058", Text: "hi from ramli", MessageID: "bp2", MessageType: contract.MsgText})
	if !res.Skipped || len(send.texts) != 0 {
		t.Errorf("bare bot number answered: %+v", res)
	}
	// A real guest is still answered
	res, _ = hub.Process(context.Background(), contract.IncomingMessage{From: "60199990001", Text: "hi", MessageID: "bp3", MessageType: contract.MsgText})
	if res.Skipped || len(send.texts) == 0 {
		t.Errorf("guest not answered: %+v", res)
	}
}
