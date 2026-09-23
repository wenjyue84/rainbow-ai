// Package bridge is the Go core's HTTP client to the dumb Node Baileys bridge.
// The core never touches Baileys; it asks the bridge to perform send operations.
package bridge

import (
	"log"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"rainbow-core/internal/contract"
)

// Client posts send-ops to the bridge's POST /send endpoint.
type Client struct {
	baseURL   string
	mu        sync.RWMutex      // guards instances (hot-added by the setup wizard)
	instances map[string]string // instanceId -> bridge base URL (overrides baseURL)
	http      *http.Client
	sendToken string // x-bridge-token for POST /send (BRIDGE_SEND_TOKEN); "" = none
}

// SetSendToken sets the shared secret the bridge requires on POST /send
// (bridge index.js BRIDGE_SEND_TOKEN, 2026-09-08 — closes the unauthenticated
// nginx-exposed /senai/send). Sent to every bridge; bridges without the env
// ignore it.
func (c *Client) SetSendToken(t string) { c.sendToken = strings.TrimSpace(t) }

func New(baseURL string) *Client {
	return &Client{baseURL: baseURL, instances: map[string]string{}, http: &http.Client{Timeout: 30 * time.Second}}
}

// SetInstanceURL routes send-ops for a WhatsApp instance id to its own bridge
// (each Baileys session is a separate bridge process on its own port). Sends
// for unmapped instances go to the default baseURL.
func (c *Client) SetInstanceURL(instanceID, baseURL string) {
	if instanceID == "" || baseURL == "" {
		return
	}
	c.mu.Lock()
	c.instances[instanceID] = strings.TrimRight(baseURL, "/")
	c.mu.Unlock()
}

// URLFor returns the bridge base URL that serves instanceID.
func (c *Client) URLFor(instanceID string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if u, ok := c.instances[instanceID]; ok {
		return u
	}
	return c.baseURL
}

func (c *Client) send(ctx context.Context, req contract.SendRequest) (*contract.SendResult, error) {
	b, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URLFor(req.InstanceID)+"/send", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	// x-caller labels this consumer in the WA Hub (engine-admin) proxy log
	// (engine-admin /i/<inst>/send, 2026-09-08).
	httpReq.Header.Set("x-caller", "rainbow-core")
	if c.sendToken != "" {
		httpReq.Header.Set("x-bridge-token", c.sendToken)
	}
	resp, err := c.http.Do(httpReq)
	if err != nil {
		log.Printf("[bridge] send op=%s inst=%s via %s failed: %v", req.Op, req.InstanceID, c.URLFor(req.InstanceID), err)
		return nil, err
	}
	defer resp.Body.Close()
	log.Printf("[bridge] send op=%s inst=%s via %s http=%d", req.Op, req.InstanceID, c.URLFor(req.InstanceID), resp.StatusCode)
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
