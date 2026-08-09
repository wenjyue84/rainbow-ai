package router

// Conversational guard predicates + canned multilingual replies used by the
// engine routing loop: off-flow question detection, mid-workflow cancel,
// bare-confirmation downgrade, reset command, media detection. Pure functions
// only — Engine methods stay in engine.go. Extracted 2026-07-21 (cohesion).

import (
	"regexp"
	"strings"

	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
)

// workflowContinuationIntent returns true for intents that explicitly advance
// or restart a multi-turn workflow — these should NOT trigger the off-flow escape.
func workflowContinuationIntent(intent string) bool {
	switch intent {
	case "booking", "check_in_arrival", "conversation_reset":
		return true
	}
	return false
}

// looksLikeQuestion is a cheap guard so slot answers ("2 pax", "15 Feb") never
// count as off-flow questions — only interrogatives / "?" do.
var questionRe = regexp.MustCompile(`(?i)[?？]|^(what|when|where|how|why|who|is|are|do|does|can|could|got|ada|bila|berapa|macam ?mana|boleh|apakah|几点|多少|吗|怎么|哪里)\b|(吗|呢)\s*$`)

func looksLikeQuestion(text string) bool {
	return questionRe.MatchString(strings.TrimSpace(text))
}

var cancelPhraseRe = regexp.MustCompile(`(?i)\b(cancel|stop|quit|exit|nevermind|never mind|forget it|batal|tak jadi|x jadi)\b|取消|不要了|算了|(?i:\b(don'?t|do not|no longer)\s+want\b)`)

// isCancelCommand reports whether a mid-workflow reply is the guest bailing out
// (checked only while a workflow is awaiting a slot value, so a bare "cancel"
// can't collide with the cancellation-intent routing of a fresh message).
func isCancelCommand(text string) bool {
	return cancelPhraseRe.MatchString(strings.TrimSpace(text))
}

var cancelMsgs = map[string]string{
	"en": "No problem, I've cancelled that. How else can I help you? 😊",
	"ms": "Baik, saya sudah batalkan. Ada lagi yang boleh saya bantu? 😊",
	"zh": "好的，已为您取消。还有什么可以帮您？😊",
	"ta": "பரவாயில்லை, ரத்து செய்துவிட்டேன். வேறு எப்படி உதவலாம்? 😊",
}

func cancelMsg(lang string) string {
	if m, ok := cancelMsgs[lang]; ok {
		return m
	}
	return cancelMsgs["en"]
}

// bareConfirmWords are pure acknowledgement/confirmation tokens. A message made
// ONLY of these (e.g. "Yes, confirm please.") carries no intent of its own and
// must be interpreted against the session context, never as a fresh command.
var bareConfirmWords = map[string]bool{
	// en
	"yes": true, "yeah": true, "yep": true, "yup": true, "ok": true, "okay": true,
	"sure": true, "confirm": true, "confirmed": true, "please": true, "pls": true,
	"correct": true, "right": true, "alright": true, "fine": true, "good": true,
	"go": true, "ahead": true, "proceed": true, "that's": true, "thats": true, "it": true,
	// ms
	"ya": true, "ye": true, "betul": true, "boleh": true, "sahkan": true,
	"teruskan": true, "baik": true, "setuju": true,
}

// zh bare confirmations are matched as whole strings (no word spacing).
var bareConfirmZh = map[string]bool{
	"是": true, "是的": true, "对": true, "对的": true, "好": true, "好的": true,
	"确认": true, "可以": true, "行": true, "嗯": true, "请确认": true, "确认吧": true,
}

// isBareConfirmation reports whether text is nothing but confirmation words
// ("Yes, confirm please.", "ok sure", "好的").
func isBareConfirmation(text string) bool {
	t := strings.TrimSpace(strings.ToLower(text))
	if t == "" {
		return false
	}
	if bareConfirmZh[strings.Trim(t, " 。！!.,")] {
		return true
	}
	toks := tokenizeWords(t)
	if len(toks) == 0 || len(toks) > 5 {
		return false
	}
	for _, tok := range toks {
		if !bareConfirmWords[tok] {
			return false
		}
	}
	return true
}

func tokenizeWords(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == ',' || r == '.' || r == '!' || r == '?' || r == ';' || r == ':' || r == '。' || r == '，' || r == '！' || r == '？'
	})
}

// shouldDowngradeBareConfirmation is the routing guard: a checkout_now
// classification earned by a bare confirmation with no checkout context is a
// misroute and gets downgraded to general (→ llm_reply).
func shouldDowngradeBareConfirmation(category, text string, state *conversation.State) bool {
	return category == "checkout_now" && isBareConfirmation(text) && !hasCheckoutContext(state)
}

// hasCheckoutContext reports whether the session gives a bare confirmation a
// legitimate checkout meaning: an active (non-awaiting) workflow snapshot, or a
// last intent that was already checkout-flavoured.
func hasCheckoutContext(state *conversation.State) bool {
	if state == nil {
		return false
	}
	if state.WorkflowStateJSON != "" {
		return true
	}
	switch state.LastIntent {
	case "checkout_now", "checkout_info", "checkout_procedure":
		return true
	}
	return false
}

var resetKeywords = []string{
	"restart", "reset", "start over", "start again", "clear chat",
	"mula semula", "set semula", "重新开始", "重新", "/reset", "/restart",
}

func isResetCommand(text string) bool {
	t := strings.ToLower(strings.TrimSpace(text))
	for _, k := range resetKeywords {
		if t == k {
			return true
		}
	}
	return false
}

var resetMsgs = map[string]string{
	"en": "✅ Conversation reset. How can I help you?",
	"ms": "✅ Perbualan ditetapkan semula. Bagaimana saya boleh bantu?",
	"zh": "✅ 对话已重置。请问有什么可以帮您？",
	"ta": "✅ உரையாடல் மீட்டமைக்கப்பட்டது. நான் எப்படி உதவ முடியும்?",
}

func resetMsg(lang string) string {
	if m, ok := resetMsgs[lang]; ok {
		return m
	}
	return resetMsgs["en"]
}

func isMediaType(mt contract.MessageType) bool {
	switch mt {
	case contract.MsgImage, contract.MsgAudio, contract.MsgVideo, contract.MsgDocument, contract.MsgSticker:
		return true
	}
	return false
}

var mediaAckMsg = map[string]string{
	"en": "Thanks for that! Our staff will take a look and get back to you shortly. 🙏",
	"ms": "Terima kasih! Staf kami akan semak dan hubungi anda sebentar lagi. 🙏",
	"zh": "收到，谢谢！我们的工作人员会查看并尽快回复您。🙏",
	"ta": "நன்றி! எங்கள் ஊழியர் பார்த்து விரைவில் பதிலளிப்பார். 🙏",
}
