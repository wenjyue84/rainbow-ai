package ai

import (
	"context"
	"strings"
)

var langInstruction = map[string]string{
	"en": "Reply in English.",
	"ms": "Reply in Malay (Bahasa Malaysia).",
	"zh": "Reply in Chinese (中文).",
	"ta": "Reply in Tamil (தமிழ்).",
}

// GenerateReply produces a natural-language assistant reply grounded in the
// business system prompt + optional KB context. Mirrors the llm_reply path of
// ai-response-generator.ts (without tools/streaming, which arrive in a later slice).
func (m *Manager) GenerateReply(ctx context.Context, systemPrompt, kbContext string, history []string, userText, lang string, maxTokens int, temperature float64) (*ChatResult, error) {
	var sys strings.Builder
	if systemPrompt != "" {
		sys.WriteString(systemPrompt)
		sys.WriteString("\n\n")
	} else {
		sys.WriteString("You are a helpful WhatsApp assistant for a hostel. Be concise, friendly, and accurate.\n\n")
	}
	if kbContext != "" {
		sys.WriteString("Use ONLY the following knowledge base to answer. If the answer isn't here, say you'll check with staff.\n")
		sys.WriteString(kbContext)
		sys.WriteString("\n\n")
	}
	if li, ok := langInstruction[lang]; ok {
		sys.WriteString(li)
	}

	msgs := []ChatMessage{{Role: "system", Content: strings.TrimSpace(sys.String())}}
	for _, h := range lastN(history, 8) {
		role, content := splitHistory(h)
		msgs = append(msgs, ChatMessage{Role: role, Content: content})
	}
	msgs = append(msgs, ChatMessage{Role: "user", Content: userText})

	if maxTokens <= 0 {
		maxTokens = 500
	}
	return m.Chat(ctx, msgs, maxTokens, temperature, false)
}
