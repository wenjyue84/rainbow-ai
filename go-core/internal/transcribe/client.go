// Package transcribe is the Go port of pipeline/stages/audio-transcription.ts:
// it transcribes WhatsApp voice notes via the Groq Whisper cloud API. The bridge
// downloads the audio and gives the core a URL; the core fetches it and POSTs it
// to Groq. (No local ML — matches the Node app, which also uses Groq Whisper.)
package transcribe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

const defaultEndpoint = "https://api.groq.com/openai/v1/audio/transcriptions"

// Client transcribes audio via Groq Whisper.
type Client struct {
	apiKey   string
	model    string
	endpoint string
	http     *http.Client
}

// New builds a transcribe client. model defaults to whisper-large-v3 (Node default).
func New(apiKey, model string) *Client {
	if model == "" {
		model = "whisper-large-v3"
	}
	return &Client{apiKey: apiKey, model: model, endpoint: defaultEndpoint, http: &http.Client{Timeout: 30 * time.Second}}
}

// Configured reports whether an API key is set.
func (c *Client) Configured() bool { return c != nil && c.apiKey != "" }

// Transcribe fetches the audio at audioURL and returns its transcript text.
func (c *Client) Transcribe(ctx context.Context, audioURL string) (string, error) {
	if c.apiKey == "" {
		return "", fmt.Errorf("no Groq API key for transcription")
	}
	// 1. Fetch the audio bytes (from the bridge's /media URL).
	audio, err := c.fetch(ctx, audioURL)
	if err != nil {
		return "", fmt.Errorf("fetch audio: %w", err)
	}
	if len(audio) == 0 {
		return "", fmt.Errorf("empty audio")
	}
	// 2. Build the multipart request for Groq.
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "voice.ogg")
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(audio); err != nil {
		return "", err
	}
	mw.WriteField("model", c.model)
	mw.WriteField("response_format", "text")
	mw.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("groq whisper http %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	// response_format=text → plain text; some gateways still return JSON {text}.
	text := strings.TrimSpace(string(raw))
	if strings.HasPrefix(text, "{") {
		var j struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &j) == nil && j.Text != "" {
			text = strings.TrimSpace(j.Text)
		}
	}
	if text == "" {
		return "", fmt.Errorf("empty transcription")
	}
	return text, nil
}

func (c *Client) fetch(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("media http %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
