package ai

import (
	"context"
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"rainbow-core/internal/classify"
	"rainbow-core/internal/config"
)

// Classifier is the T4 LLM tier — implements classify.LLMClassifier. It builds an
// intent-classification system prompt from the profile's defined intents and asks
// the LLM for {category, confidence, entities} JSON (ai-classification.ts parity).
type Classifier struct {
	mgr       *Manager
	prof      *config.Profile
	sysPrompt string
	valid     map[string]bool
	maxTokens int
	temp      float64
}

// NewClassifier builds the T4 classifier for a profile.
func NewClassifier(prof *config.Profile, mgr *Manager) *Classifier {
	intents := definedIntents(prof)
	valid := map[string]bool{}
	for _, i := range intents {
		valid[i] = true
	}
	c := &Classifier{mgr: mgr, prof: prof, valid: valid, maxTokens: 150, temp: 0.1}
	c.sysPrompt = buildClassifyPrompt(intents, prof.ClassifyPrompt)
	return c
}

func definedIntents(prof *config.Profile) []string {
	set := map[string]bool{}
	for intent := range prof.Routing {
		set[intent] = true
	}
	set["general"] = true
	set["unknown"] = true
	out := make([]string, 0, len(set))
	for i := range set {
		out = append(out, i)
	}
	sort.Strings(out)
	return out
}

func buildClassifyPrompt(intents []string, custom string) string {
	// A custom prompt (llm-settings.json systemPrompt, editable in the admin t4
	// tab) replaces the role/rules header; the category list + JSON output
	// contract are always appended so classification stays valid.
	head := "You are an intent classifier for a hostel WhatsApp bot.\n" +
		"Given the user message, classify it into exactly ONE category and extract entities."
	if custom != "" {
		head = custom
	}
	return head + "\n\n" +
		"Categories: " + strings.Join(intents, ", ") + "\n\n" +
		"Extract entities when present: dates (check_in, check_out), guest_count, language.\n\n" +
		"Respond with ONLY valid JSON (no markdown):\n" +
		`{"category":"<category>","confidence":<0-1>,"entities":{}}`
}

var jsonObjRe = regexp.MustCompile(`(?s)\{.*\}`)

// Classify implements classify.LLMClassifier. The systemPrompt argument (the
// business reply prompt) is ignored here — T4 classification uses its own prompt.
func (c *Classifier) Classify(ctx context.Context, text, _ string, history []string) (classify.Result, error) {
	msgs := []ChatMessage{{Role: "system", Content: c.sysPrompt}}
	for _, h := range lastN(history, 5) {
		role, content := splitHistory(h)
		msgs = append(msgs, ChatMessage{Role: role, Content: content})
	}
	msgs = append(msgs, ChatMessage{Role: "user", Content: text})

	res, err := c.mgr.Chat(ctx, msgs, c.maxTokens, c.temp, true)
	if err != nil {
		return classify.Result{}, err
	}
	cat, conf := parseClassifyJSON(res.Content)
	if !c.valid[cat] {
		cat = "general"
	}
	return classify.Result{Category: cat, Confidence: conf, Source: classify.SrcLLM}, nil
}

func parseClassifyJSON(raw string) (string, float64) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "```json")
	raw = strings.TrimPrefix(raw, "```")
	raw = strings.TrimSuffix(raw, "```")
	if m := jsonObjRe.FindString(raw); m != "" {
		raw = m
	}
	var p struct {
		Category   string  `json:"category"`
		Intent     string  `json:"intent"`
		Confidence float64 `json:"confidence"`
	}
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return "unknown", 0
	}
	cat := p.Category
	if cat == "" {
		cat = p.Intent
	}
	if cat == "" {
		cat = "unknown"
	}
	conf := p.Confidence
	if conf < 0 {
		conf = 0
	}
	if conf > 1 {
		conf = 1
	}
	return cat, conf
}

func lastN(s []string, n int) []string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func splitHistory(h string) (role, content string) {
	if strings.HasPrefix(h, "assistant:") {
		return "assistant", strings.TrimSpace(strings.TrimPrefix(h, "assistant:"))
	}
	if strings.HasPrefix(h, "user:") {
		return "user", strings.TrimSpace(strings.TrimPrefix(h, "user:"))
	}
	return "user", h
}
