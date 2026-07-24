// Package ai is the Go port of assistant/ai-provider-manager.ts: a multi-provider
// LLM client (Groq / OpenRouter / Ollama / OpenAI-compatible / Google Gemini) that
// tries providers in priority order with per-provider timeouts and graceful
// fallback. Resolves API keys from the env var named by each provider.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"rainbow-core/internal/config"
)

// ChatMessage is an OpenAI-style chat message.
type ChatMessage struct {
	Role    string `json:"role"` // system | user | assistant
	Content string `json:"content"`
}

// Usage mirrors the OpenAI usage block.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ChatResult is one successful provider response.
type ChatResult struct {
	Content  string
	Usage    Usage
	Provider string // provider id that answered
	Model    string
}

// Manager holds the ordered provider list and issues chat calls with fallback.
type Manager struct {
	prof   *config.Profile
	order  []config.Provider // resolved priority order (selected first)
	client *http.Client
}

// New builds a Manager. Provider order: llm-settings selectedProviders first
// (by priority), then any remaining enabled providers.
func New(prof *config.Profile) *Manager {
	m := &Manager{prof: prof, client: &http.Client{}}
	seen := map[string]bool{}
	for _, id := range prof.Selected {
		if p, ok := prof.ProviderByID[id]; ok && !seen[id] {
			m.order = append(m.order, p)
			seen[id] = true
		}
	}
	for _, p := range prof.Providers { // enabled, priority-sorted
		if !seen[p.ID] {
			m.order = append(m.order, p)
			seen[p.ID] = true
		}
	}
	return m
}

// NewReplyManager builds a Manager for GUEST REPLIES. Unlike New (classify),
// reply order is settings.json providers first (priority-sorted → gemini-2.5-flash
// at priority 0 leads), then llm-settings selectedProviders as fallback. This
// keeps guest prose on the stronger model while T4 classification stays on the
// cheap/fast 8B via New.
func NewReplyManager(prof *config.Profile) *Manager {
	m := &Manager{prof: prof, client: &http.Client{}}
	seen := map[string]bool{}
	for _, p := range prof.Providers { // enabled, priority-sorted
		if !seen[p.ID] {
			m.order = append(m.order, p)
			seen[p.ID] = true
		}
	}
	for _, id := range prof.Selected {
		if p, ok := prof.ProviderByID[id]; ok && !seen[id] {
			m.order = append(m.order, p)
			seen[id] = true
		}
	}
	return m
}

// Order returns the resolved provider priority order (read-only view).
func (m *Manager) Order() []config.Provider { return m.order }

// Active returns the first provider that would actually serve a request (has an
// API key or is a keyless local provider), plus true. If none are usable it
// returns the first in order with false (so the dashboard can still name it).
func (m *Manager) Active() (config.Provider, bool) {
	for _, p := range m.order {
		if m.apiKey(p) != "" || isLocal(p) {
			return p, true
		}
	}
	if len(m.order) > 0 {
		return m.order[0], false
	}
	return config.Provider{}, false
}

// Available reports whether at least one provider has its API key set (or is a
// keyless local provider like Ollama).
func (m *Manager) Available() bool {
	for _, p := range m.order {
		if m.apiKey(p) != "" || isLocal(p) {
			return true
		}
	}
	return false
}

func isLocal(p config.Provider) bool {
	t := strings.ToLower(p.Type)
	return strings.Contains(t, "ollama") || strings.Contains(p.BaseURL, "localhost") || strings.Contains(p.BaseURL, "127.0.0.1")
}

func (m *Manager) apiKey(p config.Provider) string {
	if p.APIKeyEnv == "" {
		return ""
	}
	return strings.TrimSpace(os.Getenv(p.APIKeyEnv))
}

// Chat tries each provider in order until one returns content. jsonMode hints the
// provider to emit JSON (OpenAI response_format).
func (m *Manager) Chat(ctx context.Context, messages []ChatMessage, maxTokens int, temperature float64, jsonMode bool) (*ChatResult, error) {
	var lastErr error
	for _, p := range m.order {
		key := m.apiKey(p)
		if key == "" && !isLocal(p) {
			continue // no credentials
		}
		timeout := time.Duration(p.TimeoutMs) * time.Millisecond
		if timeout <= 0 {
			timeout = 30 * time.Second
		}
		cctx, cancel := context.WithTimeout(ctx, timeout)
		var res *ChatResult
		var err error
		if strings.Contains(strings.ToLower(p.Type), "gemini") {
			res, err = m.chatGemini(cctx, p, key, messages, maxTokens, temperature)
		} else {
			res, err = m.chatOpenAI(cctx, p, key, messages, maxTokens, temperature, jsonMode)
		}
		cancel()
		if err == nil && res != nil && strings.TrimSpace(res.Content) != "" {
			return res, nil
		}
		if err != nil {
			lastErr = err
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no available AI provider")
	}
	return nil, lastErr
}

// ─── OpenAI-compatible (Groq / OpenRouter / Ollama / openai-compat) ──────────

type openAIReq struct {
	Model       string         `json:"model"`
	Messages    []ChatMessage  `json:"messages"`
	MaxTokens   int            `json:"max_tokens,omitempty"`
	Temperature float64        `json:"temperature"`
	ResponseFmt map[string]any `json:"response_format,omitempty"`
}

type openAIResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage Usage `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (m *Manager) chatOpenAI(ctx context.Context, p config.Provider, key string, messages []ChatMessage, maxTokens int, temperature float64, jsonMode bool) (*ChatResult, error) {
	reqBody := openAIReq{Model: p.Model, Messages: messages, MaxTokens: maxTokens, Temperature: temperature}
	if jsonMode {
		reqBody.ResponseFmt = map[string]any{"type": "json_object"}
	}
	b, _ := json.Marshal(reqBody)
	url := strings.TrimRight(p.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", p.ID, err)
	}
	defer resp.Body.Close()
	var out openAIResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("%s: decode: %w", p.ID, err)
	}
	if resp.StatusCode >= 400 {
		msg := ""
		if out.Error != nil {
			msg = out.Error.Message
		}
		return nil, fmt.Errorf("%s: http %d: %s", p.ID, resp.StatusCode, msg)
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("%s: no choices", p.ID)
	}
	return &ChatResult{Content: strings.TrimSpace(out.Choices[0].Message.Content), Usage: out.Usage, Provider: p.ID, Model: p.Model}, nil
}

// ─── Google Gemini ───────────────────────────────────────────────────────────

func (m *Manager) chatGemini(ctx context.Context, p config.Provider, key string, messages []ChatMessage, maxTokens int, temperature float64) (*ChatResult, error) {
	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role"`
		Parts []part `json:"parts"`
	}
	var sys strings.Builder
	var contents []content
	for _, msg := range messages {
		switch msg.Role {
		case "system":
			sys.WriteString(msg.Content)
			sys.WriteString("\n")
		case "assistant":
			contents = append(contents, content{Role: "model", Parts: []part{{Text: msg.Content}}})
		default:
			contents = append(contents, content{Role: "user", Parts: []part{{Text: msg.Content}}})
		}
	}
	body := map[string]any{
		"contents":         contents,
		"generationConfig": map[string]any{"temperature": temperature, "maxOutputTokens": maxTokens},
	}
	if sys.Len() > 0 {
		body["systemInstruction"] = map[string]any{"parts": []part{{Text: sys.String()}}}
	}
	b, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", strings.TrimRight(p.BaseURL, "/"), p.Model, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", p.ID, err)
	}
	defer resp.Body.Close()
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []part `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
			TotalTokenCount      int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("%s: decode: %w", p.ID, err)
	}
	if resp.StatusCode >= 400 || out.Error != nil {
		msg := ""
		if out.Error != nil {
			msg = out.Error.Message
		}
		return nil, fmt.Errorf("%s: http %d: %s", p.ID, resp.StatusCode, msg)
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("%s: empty gemini response", p.ID)
	}
	var sb strings.Builder
	for _, pt := range out.Candidates[0].Content.Parts {
		sb.WriteString(pt.Text)
	}
	return &ChatResult{
		Content:  strings.TrimSpace(sb.String()),
		Usage:    Usage{PromptTokens: out.UsageMetadata.PromptTokenCount, CompletionTokens: out.UsageMetadata.CandidatesTokenCount, TotalTokens: out.UsageMetadata.TotalTokenCount},
		Provider: p.ID, Model: p.Model,
	}, nil
}
