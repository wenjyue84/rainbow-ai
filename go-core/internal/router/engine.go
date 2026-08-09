// Package router is the Go port of assistant/message-router.ts + the pipeline
// stages: it orchestrates inbound message handling — dedup, conversation state,
// tiered classification, routing, action dispatch, and outbound send via the
// dumb Node bridge.
package router

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"rainbow-core/internal/ai"
	"rainbow-core/internal/classify"
	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/workflow"
)

// Sender is the subset of the bridge client the engine needs (mockable in tests).
type Sender interface {
	SendText(ctx context.Context, phone, text, instanceID string) (*contract.SendResult, error)
	Typing(ctx context.Context, phone, instanceID string)
	Paused(ctx context.Context, phone, instanceID string)
}

// Transcriber turns a voice-note audio URL into text (Groq Whisper).
type Transcriber interface {
	Transcribe(ctx context.Context, audioURL string) (string, error)
}

// Retriever returns KB context for a query (BM25 over the profile's KB).
type Retriever interface {
	Retrieve(query string, topK int) string
}

// Engine holds the per-profile pipeline dependencies.
type Engine struct {
	prof        *config.Profile
	clf         *classify.Classifier
	aiMgr       *ai.Manager // T4 classify (cheap/fast — Llama 8B first)
	replyMgr    *ai.Manager // guest reply (stronger — gemini-2.5-flash first)
	conv        *conversation.Manager
	send        Sender
	dedup       *dedup
	typing      bool
	wf          *workflow.Registry
	pms         workflow.PMS
	transcriber Transcriber
	retriever   Retriever
	ledger      *receiptLedger // replay protection for payment receipts
}

// Options configures the engine.
type Options struct {
	TypingIndicator bool
	Semantic        classify.Semantic  // optional T3 sidecar (nil = T1/T2/T4 only)
	Workflows       *workflow.Registry // optional workflow engine (nil = workflow action → llm/handoff)
	PMS             workflow.PMS       // optional digiman/PMS client (nil = pelangi_api steps escalate)
	Transcriber     Transcriber        // optional voice-note transcriber (nil = audio → media ack)
	Retriever       Retriever          // optional RAG retriever (nil = static-reply KB only)
	// ReceiptLedgerPath persists the used-receipt replay-protection ledger
	// (e.g. <dataDir>/receipt-ledger.json). Empty = in-memory only.
	ReceiptLedgerPath string
}

// NewEngine wires the pipeline for a single profile.
func NewEngine(prof *config.Profile, conv *conversation.Manager, send Sender, opts Options) *Engine {
	aiMgr := ai.New(prof)
	replyMgr := ai.NewReplyManager(prof)
	clf := classify.New(prof, ai.NewClassifier(prof, aiMgr))
	if opts.Semantic != nil {
		clf = clf.WithSemantic(opts.Semantic)
	}
	return &Engine{
		prof:        prof,
		clf:         clf,
		aiMgr:       aiMgr,
		replyMgr:    replyMgr,
		conv:        conv,
		send:        send,
		dedup:       newDedup(5 * time.Minute),
		typing:      opts.TypingIndicator,
		wf:          opts.Workflows,
		pms:         opts.PMS,
		transcriber: opts.Transcriber,
		retriever:   opts.Retriever,
		ledger:      newReceiptLedger(opts.ReceiptLedgerPath),
	}
}

// Result is the outcome of processing one message (returned for tests/tracing).
type Result struct {
	Skipped    bool
	SkipReason string
	Intent     string
	Confidence float64
	Source     string
	Action     string
	Reply      string
	Language   string
	Escalated  bool
}

// capturingSender records outbound text instead of sending it (for webchat /
// synchronous request-response channels).
type capturingSender struct {
	guest string
	texts []string
}

func (c *capturingSender) SendText(_ context.Context, phone, text, _ string) (*contract.SendResult, error) {
	// Only capture replies to the guest; staff-notify sends to other numbers are
	// still recorded so the caller can see an escalation happened, but kept separate.
	if c.guest == "" || phone == c.guest {
		c.texts = append(c.texts, text)
	}
	return &contract.SendResult{OK: true, Sent: true}, nil
}
func (c *capturingSender) Typing(context.Context, string, string) {}
func (c *capturingSender) Paused(context.Context, string, string) {}

// ClassifyText exposes the engine's tiered classifier (T1→T4) for the admin
// semantic check suite — the SAME pipeline that classifies guest messages.
func (e *Engine) ClassifyText(ctx context.Context, text string) classify.Result {
	return e.clf.Classify(ctx, text, nil)
}

// ProcessCapture runs the full pipeline but captures the guest-facing replies
// instead of sending them via the bridge — used by the webchat HTTP channel.
// It shallow-copies the engine with a capturing sender, so workflows, RAG, and
// escalation all work identically; only the transport differs.
func (e *Engine) ProcessCapture(ctx context.Context, msg contract.IncomingMessage) ([]string, Result, error) {
	cap := &capturingSender{guest: msg.From}
	clone := *e
	clone.send = cap
	clone.typing = false // no presence on a synchronous channel
	res, err := clone.Process(ctx, msg)
	return cap.texts, res, err
}

// Process runs the full inbound pipeline for one message.
func (e *Engine) Process(ctx context.Context, msg contract.IncomingMessage) (Result, error) {
	// Group messages are ignored (parity with input-validator).
	if msg.IsGroup {
		return Result{Skipped: true, SkipReason: "group"}, nil
	}
	// Dedup by messageId (5-min window).
	if msg.MessageID != "" && !e.dedup.firstSeen(msg.MessageID) {
		return Result{Skipped: true, SkipReason: "duplicate"}, nil
	}

	phone := msg.From
	profileID := e.prof.ID

	text := strings.TrimSpace(msg.Text)

	// Voice note (US-438): transcribe to text via Groq Whisper, then process as a
	// normal text message. Falls back to the media acknowledgement on failure.
	if msg.MessageType == contract.MsgAudio && text == "" && e.transcriber != nil && msg.MediaURL != "" {
		if tr, terr := e.transcriber.Transcribe(ctx, msg.MediaURL); terr == nil && strings.TrimSpace(tr) != "" {
			text = strings.TrimSpace(tr)
			msg.Transcribed = true
		}
	}

	state, err := e.conv.GetOrCreate(phone, msg.PushName, profileID)
	if err != nil {
		return Result{}, err
	}

	// Payment-receipt OCR gate: an inbound image may be a payment receipt.
	// Verified receipts release the guest's capsule; anything else falls
	// through to the normal pipeline (media ack / caption text).
	if msg.MessageType == contract.MsgImage && msg.MediaURL != "" {
		if res, handled := e.tryPaymentReceipt(ctx, state, msg); handled {
			return res, nil
		}
	}

	// Media with no caption (and audio that couldn't be transcribed): don't silently
	// drop — acknowledge so the guest always gets a response, and notify staff.
	if text == "" {
		if isMediaType(msg.MessageType) {
			return e.handleMediaAck(ctx, state, msg)
		}
		return Result{Skipped: true, SkipReason: "empty"}, nil
	}

	// Log inbound.
	_ = e.conv.AddMessage(phone, "user", text, profileID)
	state.LastUserMessageAtMs = time.Now().UnixMilli()

	// Typing indicator (best-effort).
	if e.typing {
		e.send.Typing(ctx, phone, msg.InstanceID)
		defer e.send.Paused(ctx, phone, msg.InstanceID)
	}

	// Conversation reset command (US: clearConversation) — cancels any active
	// workflow/booking and clears transient context.
	if isResetCommand(text) {
		state.UnknownCount = 0
		state.RepeatCount = 0
		state.Slots = map[string]any{}
		state.BookingStateJSON = ""
		state.WorkflowStateJSON = ""
		state.ActiveFlowJSON = ""
		state.LastIntent = "conversation_reset"
		_ = e.conv.Save(state)
		reply := resetMsg(state.Language)
		_, _ = e.send.SendText(ctx, phone, reply, msg.InstanceID)
		_ = e.conv.AddMessageMeta(phone, "assistant", reply, profileID, &conversation.MsgMeta{Intent: "conversation_reset", RoutedAction: "static_reply"})
		return Result{Intent: "conversation_reset", Action: "static_reply", Reply: reply, Language: state.Language}, nil
	}

	// Resume an active multi-turn workflow before classifying (the workflow sends
	// its own messages).
	if e.wf != nil && state.WorkflowStateJSON != "" {
		var wfState workflow.State
		if json.Unmarshal([]byte(state.WorkflowStateJSON), &wfState) == nil && wfState.Awaiting {
			// Escape hatch: let the guest abandon a multi-turn workflow instead of
			// having their "cancel" swallowed as the next slot value.
			if isCancelCommand(text) {
				state.WorkflowStateJSON = ""
				state.LastIntent = "workflow_cancelled"
				_ = e.conv.Save(state)
				reply := cancelMsg(state.Language)
				_, _ = e.send.SendText(ctx, phone, reply, msg.InstanceID)
				_ = e.conv.AddMessageMeta(phone, "assistant", reply, profileID, &conversation.MsgMeta{Intent: "workflow_cancelled", RoutedAction: "static_reply"})
				return Result{Intent: "workflow_cancelled", Action: "static_reply", Reply: reply, Language: state.Language}, nil
			}
			// Off-flow question: the guest asked something substantive instead
			// of answering the slot prompt ("wait, what time is check-out?").
			// Exit the workflow and let the normal pipeline answer rather than
			// swallowing it as a slot value and escalating garbage to staff.
			// Guard: workflow-continuation intents (booking, check_in_arrival)
			// should NOT exit — they are direct commands to advance the flow.
			if looksLikeQuestion(text) {
				if sub := e.clf.SubstantiveMatch(text, state.Language); sub != nil && !workflowContinuationIntent(sub.Category) {
					state.WorkflowStateJSON = "" // abandon flow, classify below
				}
			}
			if state.WorkflowStateJSON != "" { // still active after escape check
				out, err := e.wf.Resume(ctx, &wfState, text, e.runCtx(state, state.Language, msg.InstanceID))
				if err == nil {
					e.persistWorkflow(state, &wfState, out)
					if out.Done && wfState.WorkflowID == "checkin_full" {
						go e.checkOccupancyAlert(msg.InstanceID)
					}
					_ = e.conv.Save(state)
					return Result{Intent: "workflow_active", Action: "workflow", Escalated: out.Escalated, Language: state.Language}, nil
				}
				state.WorkflowStateJSON = "" // clear a stuck workflow, fall through
			}
		}
	}

	// Classify (T1 → T2 → T3 → T4).
	history := e.conv.HistoryStrings(phone, 8)
	cls := e.clf.Classify(ctx, text, history)

	// Guard (2026-07-19): a bare confirmation ("Yes, confirm please.") in a
	// session with no checkout context must NOT start the checkout workflow.
	// The T4 LLM tier guesses checkout_now from the word "confirm" alone; real
	// checkout requests carry checkout wording (not bare), and in-workflow
	// confirmations resume above before classification — both unaffected.
	if shouldDowngradeBareConfirmation(cls.Category, text, state) {
		log.Printf("[router] %s: downgrading checkout_now → general for bare confirmation %q (source=%s, no checkout context)", phone, text, cls.Source)
		cls.Category = "general"
	}

	res := Result{
		Intent:     cls.Category,
		Confidence: cls.Confidence,
		Source:     string(cls.Source),
		Language:   cls.Lang,
	}

	// Post-check-in maintenance grounding: answer in-stay problem reports from
	// the unit's REAL PMS maintenance records (anti-fabrication). Falls through
	// to the normal complaint workflow when the guest's unit is unknown.
	if isMaintenanceIntent(cls.Category) {
		state.Language = cls.Lang
		if mres, handled := e.tryMaintenanceReply(ctx, state, msg, cls.Category, cls.Lang, text); handled {
			mres.Confidence = cls.Confidence
			mres.Source = string(cls.Source)
			return mres, nil
		}
	}

	// Route + dispatch.
	route := e.prof.RouteFor(cls.Category)
	res.Action = route.Action

	// Workflow action: start a node-graph workflow (it sends its own messages).
	if route.Action == "workflow" && e.wf != nil && route.WorkflowID != "" && e.wf.Get(route.WorkflowID) != nil {
		state.Language = cls.Lang
		state.LastIntent = cls.Category
		state.LastIntentConfidence = cls.Confidence
		state.LastIntentTimestampMs = time.Now().UnixMilli()
		wfState, out, err := e.wf.Start(ctx, route.WorkflowID, e.runCtx(state, cls.Lang, msg.InstanceID))
		if err == nil {
			e.persistWorkflow(state, wfState, out)
			res.Escalated = out.Escalated
		}
		_ = e.conv.Save(state)
		return res, nil
	}

	reply := e.dispatch(ctx, cls, route, text, history)
	res.Reply = reply

	// Staff escalation: when we hand off, also alert staff with guest context.
	if e.isHandoff(cls, route) {
		res.Escalated = true
		e.notifyStaff(ctx, phone, msg.PushName, text, cls.Category, msg.InstanceID)
	}

	// Update conversation state.
	state.Language = cls.Lang
	state.LastIntent = cls.Category
	state.LastIntentConfidence = cls.Confidence
	state.LastIntentTimestampMs = time.Now().UnixMilli()
	if cls.Category == "unknown" {
		state.UnknownCount++
		// Tiered fallback: after 3 consecutive unknowns, hand off to staff.
		if state.UnknownCount >= 3 && !res.Escalated {
			res.Escalated = true
			e.notifyStaff(ctx, phone, msg.PushName, text, "repeated_unknown", msg.InstanceID)
			state.UnknownCount = 0
		}
	} else {
		state.UnknownCount = 0
	}
	_ = e.conv.Save(state)

	// Send + log assistant turn.
	if reply != "" {
		if _, err := e.send.SendText(ctx, phone, reply, msg.InstanceID); err != nil {
			return res, err
		}
		_ = e.conv.AddMessageMeta(phone, "assistant", reply, profileID, &conversation.MsgMeta{
			Intent: cls.Category, Confidence: cls.Confidence, Source: string(cls.Source), RoutedAction: route.Action,
		})
	}
	return res, nil
}

// runCtx builds the workflow execution context for a conversation turn.
func (e *Engine) runCtx(state *conversation.State, lang, instanceID string) workflow.RunContext {
	if lang == "" {
		lang = "en"
	}
	admin := e.prof.Staff.JayPhone
	if admin == "" && len(e.prof.Staff.Phones) > 0 {
		admin = e.prof.Staff.Phones[0]
	}
	return workflow.RunContext{
		GuestPhone: state.Phone,
		GuestName:  state.PushName,
		Lang:       lang,
		InstanceID: instanceID,
		AdminPhone:  admin,
		MayaPhone:   e.prof.Staff.MayaPhone,
		AlstonPhone: e.prof.Staff.AlstonPhone,
		PMS:        e.pms,
		Send: func(ctx context.Context, phone, text, inst string) error {
			_, err := e.send.SendText(ctx, phone, text, inst)
			// Persist guest-facing workflow messages so the transcript in
			// rainbow_messages is complete (staff notifies are not logged here).
			if err == nil {
				_ = e.conv.AddMessageMeta(phone, "assistant", text, e.prof.ID, &conversation.MsgMeta{Intent: state.LastIntent, RoutedAction: "workflow"})
			}
			return err
		},
	}
}

// persistWorkflow writes the workflow state back to the conversation: keep it
// when paused (awaiting the guest's reply), clear it when done/escalated.
// On completion, booking context (guest name/phone, confirmation, unit) is
// copied into the conversation Slots so later turns — payment-receipt OCR and
// maintenance lookups — can find the guest's reservation.
func (e *Engine) persistWorkflow(state *conversation.State, wfState *workflow.State, out workflow.Outcome) {
	if out.Paused {
		if b, err := json.Marshal(wfState); err == nil {
			state.WorkflowStateJSON = string(b)
		}
	} else {
		state.WorkflowStateJSON = ""
		if wfState != nil && len(wfState.Data) > 0 {
			if state.Slots == nil {
				state.Slots = map[string]any{}
			}
			for _, k := range []string{"guest_name", "guest_phone", "confirmation_number", "confirmationNumber", "reservation_id", "reservationId", "unitNumber"} {
				if v := strings.TrimSpace(wfState.Data[k]); v != "" {
					state.Slots[k] = v
				}
			}
		}
	}
}

// handleMediaAck acknowledges a caption-less media message and notifies staff
// (a voice note or photo usually needs a human, and we never silently drop it).
func (e *Engine) handleMediaAck(ctx context.Context, state *conversation.State, msg contract.IncomingMessage) (Result, error) {
	lang := state.Language
	if lang == "" {
		lang = "en"
	}
	ack := mediaAckMsg[lang]
	if ack == "" {
		ack = mediaAckMsg["en"]
	}
	label := string(msg.MessageType)
	_ = e.conv.AddMessageMeta(state.Phone, "user", "["+label+"]", e.prof.ID, &conversation.MsgMeta{MessageType: label})
	if _, err := e.send.SendText(ctx, state.Phone, ack, msg.InstanceID); err != nil {
		return Result{}, err
	}
	_ = e.conv.AddMessageMeta(state.Phone, "assistant", ack, e.prof.ID, &conversation.MsgMeta{Intent: "media_ack", RoutedAction: "escalate"})
	e.notifyStaff(ctx, state.Phone, msg.PushName, "(sent a "+label+")", "media_"+label, msg.InstanceID)
	_ = e.conv.Save(state)
	return Result{Intent: "media_ack", Action: "escalate", Escalated: true, Language: lang}, nil
}

// dispatch resolves the reply text for a routed action.
func (e *Engine) dispatch(ctx context.Context, cls classify.Result, route config.Route, text string, history []string) string {
	switch route.Action {
	case "static_reply":
		if reply, ok := e.prof.StaticReply(cls.Category, cls.Lang); ok {
			return reply
		}
		// fall through to LLM if no static template
		return e.llmReply(ctx, cls, text, history)
	case "escalate":
		return e.handoff(cls.Lang)
	default: // llm_reply, workflow (not yet ported → conversational), etc.
		if isEscalationIntent(cls.Category) {
			return e.handoff(cls.Lang)
		}
		return e.llmReply(ctx, cls, text, history)
	}
}

// llmReply generates an LLM reply grounded in the intent's static KB (if any).
// RAG chunks are LLM grounding context ONLY — when the LLM tier is down they
// must never reach the guest verbatim (they can contain internal notes), so
// every failure path falls back to the curated static template or a handoff.
func (e *Engine) llmReply(ctx context.Context, cls classify.Result, text string, history []string) string {
	static := ""
	if reply, ok := e.prof.StaticReply(cls.Category, cls.Lang); ok {
		static = reply
	}
	kb := static
	// RAG: ground the reply with the most relevant KB chunks (BM25).
	if e.retriever != nil {
		if chunks := e.retriever.Retrieve(text, 5); chunks != "" {
			if kb != "" {
				kb = kb + "\n\n" + chunks
			} else {
				kb = chunks
			}
		}
	}
	if !e.replyMgr.Available() {
		// No AI configured → safe static fallback or handoff.
		if static != "" {
			return static
		}
		return e.handoff(cls.Lang)
	}
	// Per-turn system prompt: introduce the AI on FIRST contact only, or gently
	// re-note it (plus the human staff number) when the guest sounds upset. On a
	// normal follow-up we say nothing about being an AI (settings.json no longer
	// forces the "I'm a bot" opener on every reply). history already includes the
	// current user turn (added before classification), so len==1 = first message.
	sysPrompt := e.prof.SystemPrompt
	botName := e.prof.BotName
	switch {
	case ai.IsNegative(text):
		sysPrompt += "\n\nThe guest seems upset — gently note you are " + botName + " (an AI assistant) and that our human staff (+60 12-708 8789) can take over, then help."
	case len(history) <= 1 && cls.Category != "greeting":
		sysPrompt += "\n\nThis is the guest's first message — briefly introduce yourself as " + botName + ", an AI assistant, then answer."
	}
	res, err := e.replyMgr.GenerateReply(ctx, sysPrompt, kb, history, text, cls.Lang, 800, 0.4)
	if err != nil || res == nil || strings.TrimSpace(res.Content) == "" {
		if static != "" {
			return static
		}
		return e.handoff(cls.Lang)
	}
	return res.Content
}

var handoffMsg = map[string]string{
	"en": "Let me connect you with our staff who can help you better. Please hold on a moment. 🙏",
	"ms": "Saya akan hubungkan anda dengan staf kami untuk bantuan lanjut. Sila tunggu sebentar. 🙏",
	"zh": "我帮您联系我们的工作人员来协助您，请稍等。🙏",
	"ta": "எங்கள் ஊழியருடன் உங்களை இணைக்கிறேன். தயவுசெய்து சிறிது நேரம் காத்திருங்கள். 🙏",
}

func (e *Engine) handoff(lang string) string {
	if m, ok := handoffMsg[lang]; ok {
		return m
	}
	return handoffMsg["en"]
}

// isHandoff reports whether this turn results in a human handoff.
func (e *Engine) isHandoff(cls classify.Result, route config.Route) bool {
	return route.Action == "escalate" || isEscalationIntent(cls.Category)
}

// notifyStaff sends a guest-context alert to the configured staff phone(s).
// Mirrors escalation.ts escalateToStaff (minimal: primary phone, plain text).
func (e *Engine) notifyStaff(ctx context.Context, guestPhone, pushName, message, intent, instanceID string) {
	staff := e.prof.Staff.JayPhone
	if staff == "" && len(e.prof.Staff.Phones) > 0 {
		staff = e.prof.Staff.Phones[0]
	}
	if staff == "" {
		return // no staff configured
	}
	name := pushName
	if name == "" {
		name = "Guest"
	}
	contactLine := guestContactLine(guestPhone, name)
	alert := "🔔 *Staff attention needed*\n" +
		"Guest: " + contactLine + "\n" +
		"Intent: " + intent + "\n" +
		"Message: " + message + "\n\n" +
		"Please reply to the guest directly."
	if _, err := e.send.SendText(ctx, staff, alert, instanceID); err != nil {
		// best-effort; don't fail the guest reply over a staff-notify error
		_ = err
	}
}

// notifyAllPaymentStaff sends a payment event alert to all three configured
// payment contacts (Jay, Alston, Maya) so every stakeholder sees receipt
// verifications and payment failures. Best-effort — never blocks the guest reply.
func (e *Engine) notifyAllPaymentStaff(ctx context.Context, guestPhone, pushName, message, intent, instanceID string) {
	name := pushName
	if name == "" {
		name = "Guest"
	}
	contactLine := guestContactLine(guestPhone, name)
	alert := "💳 *Payment notification*\n" +
		"Guest: " + contactLine + "\n" +
		"Intent: " + intent + "\n" +
		message
	phones := []string{
		e.prof.Staff.JayPhone,
		e.prof.Staff.AlstonPhone,
		e.prof.Staff.MayaPhone,
	}
	if e.prof.Staff.JayPhone == "" && len(e.prof.Staff.Phones) > 0 {
		phones = e.prof.Staff.Phones
	}
	for _, ph := range phones {
		if ph == "" {
			continue
		}
		if _, err := e.send.SendText(ctx, ph, alert, instanceID); err != nil {
			_ = err
		}
	}
}

// guestContactLine converts a Baileys JID into a human-readable contact
// string for staff notifications.
// - "601XXXXXXXX@s.whatsapp.net" → "+601XXXXXXXX (Name)"
// - "123456789@lid"              → "Name (reply in WhatsApp thread)"
// - anything else                → "Name (phone)"
func guestContactLine(jid, name string) string {
	if at := strings.Index(jid, "@"); at > 0 {
		host := jid[at+1:]
		num := jid[:at]
		if host == "s.whatsapp.net" && len(num) >= 8 {
			return name + " — +" + num
		}
	}
	// LID or unknown: can't extract a dialable number; staff replies in-thread.
	return name + " (reply in this WhatsApp chat)"
}

func isEscalationIntent(intent string) bool {
	switch intent {
	case "contact_staff", "theft", "theft_report", "card_locked":
		return true
	}
	return false
}

// ─── dedup ───────────────────────────────────────────────────────────────────

type dedup struct {
	mu   sync.Mutex
	seen map[string]time.Time
	ttl  time.Duration
}

func newDedup(ttl time.Duration) *dedup {
	return &dedup{seen: map[string]time.Time{}, ttl: ttl}
}

// firstSeen returns true if id has NOT been seen within the TTL window.
func (d *dedup) firstSeen(id string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	if t, ok := d.seen[id]; ok && now.Sub(t) < d.ttl {
		return false
	}
	d.seen[id] = now
	// opportunistic GC
	if len(d.seen) > 4096 {
		for k, t := range d.seen {
			if now.Sub(t) > d.ttl {
				delete(d.seen, k)
			}
		}
	}
	return true
}
