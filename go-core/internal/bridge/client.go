// Package bridge is the Go core's HTTP client to the dumb Node Baileys bridge.
// The core never touches Baileys; it asks the bridge to perform send operations.
package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"rainbow-core/internal/contract"
)

// Client posts send-ops to the bridge's POST /send endpoint.
type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) *Client {
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) send(ctx context.Context, req contract.SendRequest) (*contract.SendResult, error) {
	b, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/send", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("bridge /send http %d", resp.StatusCode)
	}
	var out contract.SendResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return &contract.SendResult{OK: true}, nil // bridge may return empty body
	}
	return &out, nil
}

// SendText asks the bridge to deliver a plain text message.
func (c *Client) SendText(ctx context.Context, phone, text, instanceID string) (*contract.SendResult, error) {
	return c.send(ctx, contract.SendRequest{Op: contract.OpText, Phone: phone, Text: text, InstanceID: instanceID})
}

// Typing/Paused are best-effort presence updates.
func (c *Client) Typing(ctx context.Context, phone, instanceID string) {
	_, _ = c.send(ctx, contract.SendRequest{Op: contract.OpTyping, Phone: phone, InstanceID: instanceID})
}
func (c *Client) Paused(ctx context.Context, phone, instanceID string) {
	_, _ = c.send(ctx, contract.SendRequest{Op: contract.OpPaused, Phone: phone, InstanceID: instanceID})
}

// SendMedia asks the bridge to fetch mediaURL and send it.
func (c *Client) SendMedia(ctx context.Context, phone, mediaURL, mimetype, fileName, caption, instanceID string) (*contract.SendResult, error) {
	return c.send(ctx, contract.SendRequest{Op: contract.OpMedia, Phone: phone, MediaURL: mediaURL, MimeType: mimetype, FileName: fileName, Caption: caption, InstanceID: instanceID})
}
