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

func TestEngineSkipsIgnoredNumber(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	eng.SetIgnoredNumbers([]config.IgnoredNumber{
		{Phone: "+60 17-670 1102", Label: "Maya"}, // raw input → normalised
		{Phone: "60167620815", Label: "Alston"},
	})
	if got := eng.IgnoredNumbers(); len(got) != 2 || got[0].Phone != "60176701102" {
		t.Fatalf("normalised list = %+v", got)
	}

	cases := []struct {
		name, from, push, wantReason string
		skip                         bool
	}{
		{"jid", "60176701102@s.whatsapp.net", "whoever", "ignored_number", true},
		{"bare", "60176701102", "", "ignored_number", true},
		{"formatted", "+60 17-670 1102", "", "ignored_number", true},
		{"alston", "60167620815", "Alston", "ignored_number", true},
		{"lid by name", "123456789012345@lid", "maya", "ignored_number_by_name", true},
		{"lid unknown name", "123456789012345@lid", "Guest", "", false},
		{"unrelated", "60199990000", "Maya", "", false}, // name match only counts for @lid
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			before := len(send.texts)
			res, err := eng.Process(context.Background(), contract.IncomingMessage{
				From: c.from, Text: "hello there", PushName: c.push, MessageID: "ign" + string(rune('a'+i)), MessageType: contract.MsgText,
			})
			if err != nil {
				t.Fatalf("Process: %v", err)
			}
			if c.skip {
				if !res.Skipped || res.SkipReason != c.wantReason {
					t.Errorf("want skip %q, got %+v", c.wantReason, res)
				}
				if len(send.texts) != before {
					t.Error("ignored number received a reply")
				}
				// Stored for Live Chat visibility.
				if hist, _ := eng.conv.History(c.from, eng.prof.ID, 5); len(hist) == 0 {
					t.Error("ignored message not stored in conversation")
				}
			} else if res.Skipped && (res.SkipReason == "ignored_number" || res.SkipReason == "ignored_number_by_name") {
				t.Errorf("unrelated sender was ignored: %+v", res)
			}
		})
	}

	// Hot-swap to empty → no longer skipped.
	eng.SetIgnoredNumbers(nil)
	res, _ := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60176701102", Text: "hi", MessageID: "ign-z", MessageType: contract.MsgText,
	})
	if res.Skipped && res.SkipReason == "ignored_number" {
		t.Errorf("still ignored after clearing list: %+v", res)
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
	hist, _ := eng.conv.History(phone, eng.prof.ID, 10)
	if len(hist) < 2 {
		t.Errorf("expected >=2 history msgs, got %d", len(hist))
	}
}

// A message typed on the bot's own phone / WhatsApp Web (bridge fromMe relay)
// is stored as a staff turn (source phone-manual) and never answered.
func TestFromMeLoggedAsStaffNoReply(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60155550001", Text: "Vg", PushName: "Jayson", MessageID: "fm1", MessageType: contract.MsgText, FromMe: true,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if !res.Skipped || res.SkipReason != "from-me" {
		t.Fatalf("want skip from-me, got %+v", res)
	}
	if len(send.texts) != 0 || send.typing != 0 {
		t.Errorf("fromMe must not send/type (texts=%d typing=%d)", len(send.texts), send.typing)
	}
	hist, _ := eng.conv.History("60155550001", eng.prof.ID, 5)
	if len(hist) != 1 || hist[0].Role != "staff" || hist[0].Content != "Vg" {
		t.Fatalf("history = %+v, want one staff row", hist)
	}
	var source string
	if err := eng.conv.Store().DB.QueryRow(`SELECT source FROM rainbow_messages WHERE phone = ? AND role = 'staff'`, "60155550001").Scan(&source); err != nil {
		t.Fatalf("source query: %v", err)
	}
	if source != "phone-manual" {
		t.Errorf("source = %q, want phone-manual", source)
	}
	// Empty fromMe (e.g. reaction / protocol message) is dropped silently.
	res, _ = eng.Process(context.Background(), contract.IncomingMessage{
		From: "60155550001", MessageID: "fm2", MessageType: contract.MsgText, FromMe: true,
	})
	if res.SkipReason != "from-me-empty" {
		t.Errorf("empty fromMe skip = %+v", res)
	}
}

// intro-once: first message from a contact gets the intro, every later one is
// left for a human (no send, skip reason set).
func TestIntroOnceMode(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	eng.SetReplyMode("intro-once", "Hi, I'm Jayson, Jay's AI PA.")
	eng.prof.IntroMessage = "Hi, I'm Jayson, Jay's AI PA."
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60155550002", Text: "hello?", PushName: "New", MessageID: "io1", MessageType: contract.MsgText,
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.Intent != "intro" || res.Action != "intro-once" || len(send.texts) != 1 || send.last() != eng.prof.IntroMessage {
		t.Fatalf("first message: res=%+v sends=%v", res, send.texts)
	}
	res, _ = eng.Process(context.Background(), contract.IncomingMessage{
		From: "60155550002", Text: "are you there", MessageID: "io2", MessageType: contract.MsgText,
	})
	if !res.Skipped || res.SkipReason != "intro-once: awaiting manual reply" {
		t.Errorf("second message: %+v", res)
	}
	if len(send.texts) != 1 {
		t.Errorf("second message must not be answered (sends=%d)", len(send.texts))
	}
	hist, _ := eng.conv.History("60155550002", eng.prof.ID, 10)
	if len(hist) != 3 { // user, assistant(intro), user
		t.Errorf("history rows = %d, want 3: %+v", len(hist), hist)
	}
}

// 2026-09-08: "silent" reply mode — inbound is logged, nothing is sent, no
// LLM/classify path runs. Hot-swappable back to normal without a restart.
func TestSilentMode(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	eng.SetReplyMode("silent", "")
	for i, text := range []string{"hello?", "anyone there", "bilik kosong ada?"} {
		res, err := eng.Process(context.Background(), contract.IncomingMessage{
			From: "60155550003", Text: text, PushName: "Tenant", MessageID: "sil" + string(rune('a'+i)), MessageType: contract.MsgText,
		})
		if err != nil {
			t.Fatalf("Process: %v", err)
		}
		if !res.Skipped || res.SkipReason != "silent: manual reply only" {
			t.Fatalf("msg %d: %+v", i, res)
		}
	}
	if len(send.texts) != 0 {
		t.Fatalf("silent mode must never send (sends=%v)", send.texts)
	}
	hist, _ := eng.conv.History("60155550003", eng.prof.ID, 10)
	if len(hist) != 3 {
		t.Errorf("inbound must still be logged: rows=%d want 3", len(hist))
	}
	// flip back to normal: the pipeline answers again
	eng.SetReplyMode("", "")
	res, _ := eng.Process(context.Background(), contract.IncomingMessage{
		From: "60155550003", Text: "hello", MessageID: "sild", MessageType: contract.MsgText,
	})
	if res.Skipped {
		t.Fatalf("after reset, expected a reply, got %+v", res)
	}
}

// Regression: the pushName on an own-device message is OUR name. With a staff
// label of the same name on the exception list, the fromMe branch must still
// win (before ignoredReason) and the turn must be stored as staff.
func TestFromMeBeatsIgnoredByName(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	eng.SetIgnoredNumbers([]config.IgnoredNumber{{Phone: "60100000001", Label: "Jay"}})
	res, err := eng.Process(context.Background(), contract.IncomingMessage{
		From: "156697788182764@lid", Text: "Vg", PushName: "Jay", MessageID: "fmlid1", MessageType: contract.MsgText,
		FromMe: true, PhoneNumber: "60123456789",
	})
	if err != nil {
		t.Fatalf("Process: %v", err)
	}
	if res.SkipReason != "from-me" {
		t.Fatalf("skip = %+v, want from-me", res)
	}
	hist, _ := eng.conv.History("156697788182764@lid", eng.prof.ID, 5)
	if len(hist) != 1 || hist[0].Role != "staff" {
		t.Fatalf("history = %+v, want one staff row", hist)
	}
	if got := eng.conv.ContactPhone("156697788182764@lid"); got != "60123456789" {
		t.Errorf("contact phone = %q, want 60123456789", got)
	}
	if len(send.texts) != 0 {
		t.Errorf("fromMe must not be answered")
	}
}
