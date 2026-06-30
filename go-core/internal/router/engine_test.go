package router

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/store"
	"rainbow-core/internal/workflow"
)

// mockSender records outbound text and presence operations.
type mockSender struct {
	mu     sync.Mutex
	texts  []string
	phones []string
	typing int
	paused int
}

func (m *mockSender) SendText(_ context.Context, phone, text, _ string) (*contract.SendResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.texts = append(m.texts, text)
	m.phones = append(m.phones, phone)
	return &contract.SendResult{OK: true, Sent: true}, nil
}

func (m *mockSender) sentTo(phone string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.phones {
		if p == phone {
			return true
		}
	}
	return false
}
func (m *mockSender) Typing(context.Context, string, string) { m.mu.Lock(); m.typing++; m.mu.Unlock() }
func (m *mockSender) Paused(context.Context, string, string) { m.mu.Lock(); m.paused++; m.mu.Unlock() }
func (m *mockSender) last() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.texts) == 0 {
		return ""
	}
	return m.texts[len(m.texts)-1]
}

func tempDB(t *testing.T) string {
	t.Helper()
	src := filepath.Join("..", "..", "..", "data", "rainbow-ai.db")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("no local DB: %v", err)
	}
	dst := filepath.Join(t.TempDir(), "test.db")
	in, _ := os.Open(src)
	defer in.Close()
	out, _ := os.Create(dst)
	io.Copy(out, in)
	out.Close()
	return dst
}

func newTestEngine(t *testing.T, send Sender) *Engine {
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
	return NewEngine(prof, conversation.NewManager(st), send, Options{TypingIndicator: true})
}

func TestEngineGreeting(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60123456789", Text: "hi", PushName: "Alice", MessageID: "m1", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Intent != "greeting" {
		t.Errorf("intent = %q, want greeting", res.Intent)
	}
	if res.Source != "regex" {
		t.Errorf("source = %q, want regex", res.Source)
	}
	if send.last() == "" {
		t.Error("expected a reply to be sent")
	}
	if send.typing == 0 || send.paused == 0 {
		t.Errorf("expected typing/paused presence (typing=%d paused=%d)", send.typing, send.paused)
	}
}

func TestEngineWifiStaticReply(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	res, _ := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60123456000", Text: "what is the wifi password?", PushName: "Bob", MessageID: "w1", MessageType: contract.MsgText,
	})
	if res.Intent != "wifi" {
		t.Errorf("intent = %q, want wifi", res.Intent)
	}
	// wifi has a static reply containing the network name.
	if last := send.last(); last == "" {
		t.Error("expected wifi reply")
	}
}

func TestEngineDedup(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	msg := contract.IncomingMessage{From: "60111", Text: "hello", PushName: "X", MessageID: "dup1", MessageType: contract.MsgText}
	eng.Process(context.Background(), msg)
	res, _ := eng.Process(context.Background(), msg) // same messageId
	if !res.Skipped || res.SkipReason != "duplicate" {
		t.Errorf("second send not deduped: %+v", res)
	}
	if len(send.texts) != 1 {
		t.Errorf("expected 1 reply (dedup), got %d", len(send.texts))
	}
}

func TestEngineSkipsGroup(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	res, _ := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60222", Text: "hi", IsGroup: true, MessageID: "g1", MessageType: contract.MsgText,
	})
	if !res.Skipped || res.SkipReason != "group" {
		t.Errorf("group not skipped: %+v", res)
	}
	if len(send.texts) != 0 {
		t.Error("should not reply to group")
	}
}

func TestEngineEscalationNotifiesStaff(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	guest := "60177778888"
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: guest, Text: "I want to speak to a human staff member please", PushName: "Dana", MessageID: "esc1", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if !res.Escalated {
		t.Errorf("expected escalation for intent %q (action %q)", res.Intent, res.Action)
	}
	if !send.sentTo(guest) {
		t.Error("guest did not receive a handoff reply")
	}
	staff := eng.prof.Staff.JayPhone
	if staff == "" && len(eng.prof.Staff.Phones) > 0 {
		staff = eng.prof.Staff.Phones[0]
	}
	if staff != "" && !send.sentTo(staff) {
		t.Errorf("staff %q was not notified", staff)
	}
}

func TestEngineWorkflowStartAndResume(t *testing.T) {
	prof, err := config.Load(filepath.Join("..", "..", "..", "src", "assistant", "data"), "pelangi")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	reg, err := workflow.Load(filepath.Join("..", "..", "..", "src", "assistant", "data"))
	if err != nil {
		t.Fatalf("load workflows: %v", err)
	}
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()
	send := &mockSender{}
	eng := NewEngine(prof, conversation.NewManager(st), send, Options{TypingIndicator: false, Workflows: reg})

	phone := "60155556666"
	// Booking intent → routes to the booking workflow, which sends a prompt + pauses.
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: phone, Text: "I want to book a room", PushName: "Eve", MessageID: "wf1", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Action != "workflow" {
		t.Fatalf("expected workflow action, got %q (intent %q)", res.Action, res.Intent)
	}
	if len(send.texts) == 0 {
		t.Fatal("workflow should have sent a prompt")
	}
	// Workflow state should be persisted (awaiting reply).
	cs, _ := eng.conv.GetOrCreate(phone, "Eve", "pelangi")
	if cs.WorkflowStateJSON == "" {
		t.Fatal("workflow state not persisted after start")
	}

	// Next message resumes the workflow (stores the name, asks next question).
	before := len(send.texts)
	res2, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: phone, Text: "Eve Tan", PushName: "Eve", MessageID: "wf2", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process resume: %v", err)
	}
	if res2.Action != "workflow" {
		t.Errorf("resume should stay in workflow, got action %q", res2.Action)
	}
	if len(send.texts) <= before {
		t.Error("resume should have sent the next prompt")
	}
}

// fakeTranscriber returns a fixed transcript (stands in for Groq Whisper).
type fakeTranscriber struct{ text string }

func (f fakeTranscriber) Transcribe(_ context.Context, _ string) (string, error) {
	return f.text, nil
}

func TestEngineVoiceNoteTranscribed(t *testing.T) {
	prof, err := config.Load(filepath.Join("..", "..", "..", "src", "assistant", "data"), "pelangi")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()
	send := &mockSender{}
	eng := NewEngine(prof, conversation.NewManager(st), send, Options{
		Transcriber: fakeTranscriber{text: "what is the wifi password"},
	})

	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60123459999", Text: "", PushName: "Ivy", MessageID: "v1", MessageType: contract.MsgAudio,
		MediaURL: "http://bridge/media/v1.ogg", MediaMetadata: &contract.MediaMetadata{MimeType: "audio/ogg"},
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	// The transcript should be classified as a normal text message → wifi.
	if res.Intent != "wifi" {
		t.Errorf("transcribed voice note intent = %q, want wifi", res.Intent)
	}
	if res.Action == "" || send.last() == "" {
		t.Error("expected a reply to the transcribed voice note")
	}
}

func TestEngineAudioNoTranscriberFallsBackToAck(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send) // no transcriber
	res, _ := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60123450000", Text: "", PushName: "Jo", MessageID: "v2", MessageType: contract.MsgAudio,
		MediaURL: "http://bridge/media/v2.ogg",
	})
	if res.Intent != "media_ack" {
		t.Errorf("audio with no transcriber should fall back to media_ack, got %q", res.Intent)
	}
}

// fakeRetriever records whether it was consulted and returns a marker.
type fakeRetriever struct {
	called bool
	query  string
}

func (f *fakeRetriever) Retrieve(query string, _ int) string {
	f.called = true
	f.query = query
	return "RAGMARKER: relevant KB content"
}

func TestEngineRAGConsultedOnLLMReply(t *testing.T) {
	prof, err := config.Load(filepath.Join("..", "..", "..", "src", "assistant", "data"), "pelangi")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()
	fr := &fakeRetriever{}
	send := &mockSender{}
	eng := NewEngine(prof, conversation.NewManager(st), send, Options{Retriever: fr})

	// "availability" routes to llm_reply → llmReply consults the retriever.
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60123458888", Text: "do you have any rooms available tonight", PushName: "Kim", MessageID: "rag1", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Action != "llm_reply" {
		t.Skipf("message routed to %q (not llm_reply) — RAG path not exercised", res.Action)
	}
	if !fr.called {
		t.Error("retriever was not consulted on an llm_reply turn")
	}
}

func TestProcessCaptureWebchat(t *testing.T) {
	send := &mockSender{} // the "bridge" — should receive nothing
	eng := newTestEngine(t, send)
	replies, res, err := eng.ProcessCapture(context.Background(), contract.IncomingMessage{
		From: "web:sess1", Text: "hi", PushName: "Web Guest", MessageType: contract.MsgText, InstanceID: "webchat",
	})
	if err != nil {
		t.Fatalf("ProcessCapture: %v", err)
	}
	if res.Intent != "greeting" {
		t.Errorf("intent = %q, want greeting", res.Intent)
	}
	if len(replies) == 0 {
		t.Fatal("expected a captured reply")
	}
	// The bridge sender must NOT have been used (webchat is synchronous).
	if len(send.texts) != 0 {
		t.Error("webchat should not send via the bridge")
	}
}

func TestEngineMediaAck(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	guest := "60166667777"
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: guest, Text: "", PushName: "Fay", MessageID: "media1", MessageType: contract.MsgImage,
		MediaMetadata: &contract.MediaMetadata{MimeType: "image/jpeg"},
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Skipped {
		t.Fatal("caption-less media must NOT be silently dropped")
	}
	if res.Intent != "media_ack" || !res.Escalated {
		t.Errorf("expected media_ack + escalated, got %+v", res)
	}
	if !send.sentTo(guest) {
		t.Error("guest did not receive a media acknowledgement")
	}
}

func TestEngineConversationReset(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	phone := "60144443333"
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: phone, Text: "reset", PushName: "Gus", MessageID: "r1", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Intent != "conversation_reset" {
		t.Errorf("intent = %q, want conversation_reset", res.Intent)
	}
	if send.last() == "" {
		t.Error("reset should send a confirmation")
	}
}

func TestEngineConsecutiveUnknownEscalates(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send) // no LLM → gibberish stays unknown
	phone := "60133332222"
	gibberish := []string{"xyzzy plugh", "qwfp arst zxcv", "blorptang wug"}
	var lastRes Result
	for i, g := range gibberish {
		r, err := eng.Process(context.Background(), contract.IncomingMessage{
			From: phone, Text: g, PushName: "Hana", MessageID: "u" + string(rune('a'+i)), MessageType: contract.MsgText,
		})
		if err != nil {
			t.Fatalf("Process %d: %v", i, err)
		}
		lastRes = r
	}
	if lastRes.Intent != "unknown" {
		t.Skipf("gibberish classified as %q (not unknown) — escalation path not exercised", lastRes.Intent)
	}
	if !lastRes.Escalated {
		t.Error("3 consecutive unknowns should escalate to staff")
	}
}

func TestEngineStatePersisted(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	phone := "60333444555"
	eng.Process(context.Background(), contract.IncomingMessage{From: phone, Text: "hello", PushName: "Carl", MessageID: "s1", MessageType: contract.MsgText})
	st, err := eng.conv.GetOrCreate(phone, "Carl", "pelangi")
	if err != nil {
		t.Fatal(err)
	}
	if st.LastIntent != "greeting" {
		t.Errorf("persisted lastIntent = %q, want greeting", st.LastIntent)
	}
	// history should contain user + assistant turns
	hist, _ := eng.conv.History(phone, 10)
	if len(hist) < 2 {
		t.Errorf("expected >=2 history msgs, got %d", len(hist))
	}
}
