// PMS2 MCP transport (JSON-RPC tools/call with x-api-key auth). Since
// 2026-07-18 the canonical PMS2 API host is the Hetzner Node app
// (nginx https://pms.pelangicapsulehostel.com/api/mcp → 127.0.0.1:5001);
// reservation reads/writes go through MCP tools rather than the legacy
// Bearer-auth REST routes.
package digiman

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// SetMCP enables the PMS2 MCP JSON-RPC transport (reservation lookup/create).
// url is the full /api/mcp endpoint; key is sent as x-api-key.
func (c *Client) SetMCP(url, key string) {
	c.mcpURL = strings.TrimSpace(url)
	c.mcpKey = key
}

// MCPConfigured reports whether the MCP endpoint is set.
func (c *Client) MCPConfigured() bool { return c != nil && c.mcpURL != "" }

// mcpCall performs a JSON-RPC 2.0 tools/call and decodes the JSON object in the
// first text content block of the result.
func (c *Client) mcpCall(ctx context.Context, tool string, args map[string]any) (map[string]any, error) {
	text, err := c.mcpCallText(ctx, tool, args)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		return nil, fmt.Errorf("mcp %s: non-JSON payload: %w", tool, err)
	}
	return m, nil
}

// mcpCallText performs a JSON-RPC 2.0 tools/call and returns the raw text of
// the first content block (some tools return JSON arrays, not objects).
func (c *Client) mcpCallText(ctx context.Context, tool string, args map[string]any) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params":  map[string]any{"name": tool, "arguments": args},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.mcpURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.mcpKey != "" {
		req.Header.Set("x-api-key", c.mcpKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("mcp %s: %w", tool, err)
	}
	defer resp.Body.Close()
	var rpc struct {
		Result *struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rpc); err != nil {
		return "", fmt.Errorf("mcp %s: bad response (%d): %w", tool, resp.StatusCode, err)
	}
	if rpc.Error != nil {
		return "", fmt.Errorf("mcp %s: %s", tool, rpc.Error.Message)
	}
	if rpc.Result == nil || len(rpc.Result.Content) == 0 {
		return "", fmt.Errorf("mcp %s: empty result (http %d)", tool, resp.StatusCode)
	}
	if rpc.Result.IsError {
		return "", fmt.Errorf("mcp %s: tool error: %s", tool, rpc.Result.Content[0].Text)
	}
	return rpc.Result.Content[0].Text, nil
}

// cleanPhone strips a WhatsApp JID suffix and separators; returns "" unless the
// remainder is a plausible all-digit phone number (webchat "web:<session>"
// pseudo-numbers are rejected).
func cleanPhone(s string) string {
	s = strings.TrimSpace(s)
	if at := strings.Index(s, "@"); at >= 0 {
		s = s[:at]
	}
	if strings.Contains(s, ":") { // "web:abc123" webchat session id — not a phone
		return ""
	}
	s = strings.NewReplacer(" ", "", "-", "", "+", "").Replace(s)
	if len(s) < 7 {
		return ""
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return ""
		}
	}
	return s
}

// strField reads a string field from a decoded JSON object ("" if absent).
func strField(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}
