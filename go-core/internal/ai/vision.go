// Vision (image → JSON) support for receipt OCR. Uses the first configured
// Google Gemini provider (settings.json ocr_provider points at
// google-gemini-flash — the cheapest adequate multimodal model already wired
// into this deployment; Groq llama text models have no vision).
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"rainbow-core/internal/config"
)

// VisionAvailable reports whether a vision-capable (Gemini) provider has a key.
func (m *Manager) VisionAvailable() bool {
	return m.visionProvider() != nil
}

func (m *Manager) visionProvider() *config.Provider {
	for i := range m.order {
		p := m.order[i]
		if strings.Contains(strings.ToLower(p.Type), "gemini") && m.apiKey(p) != "" {
			return &p
		}
	}
	return nil
}

// VisionJSON sends prompt + one inline image to a vision provider and returns
// the raw model output (asked for as JSON via responseMimeType).
func (m *Manager) VisionJSON(ctx context.Context, prompt, mimeType, b64Data string, maxTokens int) (*ChatResult, error) {
	p := m.visionProvider()
	if p == nil {
		return nil, fmt.Errorf("no vision-capable AI provider configured")
	}
	key := m.apiKey(*p)
	timeout := time.Duration(p.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body := map[string]any{
		"contents": []map[string]any{{
			"role": "user",
			"parts": []map[string]any{
				{"text": prompt},
				{"inline_data": map[string]any{"mime_type": mimeType, "data": b64Data}},
			},
		}},
		"generationConfig": map[string]any{
			"temperature":      0.0,
			"maxOutputTokens":  maxTokens,
			"responseMimeType": "application/json",
			// gemini-2.5-flash spends maxOutputTokens on hidden "thinking" by
			// default, truncating the JSON output (observed 2026-07-19). OCR
			// extraction needs no reasoning budget.
			"thinkingConfig": map[string]any{"thinkingBudget": 0},
		},
	}
	b, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", strings.TrimRight(p.BaseURL, "/"), p.Model, key)
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, url, bytes.NewReader(b))
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
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
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
		return nil, fmt.Errorf("%s: empty vision response", p.ID)
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
