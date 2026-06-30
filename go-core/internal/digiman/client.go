// Package digiman is the Go core's REST client to the digiman/PMS admin API
// (the Node app's lib/http-client.ts → DIGIMAN_API_URL). It backs the workflow
// engine's pelangi_api nodes and (later) pricing/availability tools.
package digiman

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client talks to the digiman/PMS REST API.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// New builds a client. baseURL e.g. http://127.0.0.1:5000 ; token is the bearer.
func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

// Configured reports whether a base URL is set.
func (c *Client) Configured() bool { return c != nil && c.baseURL != "" }

func (c *Client) do(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("digiman %s %s -> %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return raw, nil
}

// Get performs a GET and returns the raw JSON body.
func (c *Client) Get(ctx context.Context, path string) (json.RawMessage, error) {
	return c.do(ctx, http.MethodGet, path, nil)
}

// Post performs a POST with a JSON body and returns the raw JSON body.
func (c *Client) Post(ctx context.Context, path string, body any) (json.RawMessage, error) {
	return c.do(ctx, http.MethodPost, path, body)
}

// ─── Workflow action dispatch (implements workflow.PMS) ──────────────────────

// Do maps a pelangi_api action to a real PMS call. It returns ok=false for
// actions that are not implemented (the caller then escalates to staff — which is
// safer than the Node enhancer, where unimplemented actions silently no-op and the
// workflow proceeds with blank data). On a real API error it returns err.
func (c *Client) Do(ctx context.Context, action string, params map[string]string) (outputs map[string]string, ok bool, err error) {
	outputs = map[string]string{}
	switch action {
	case "check_availability":
		raw, err := c.Get(ctx, "/api/units/available")
		if err != nil {
			return nil, true, err
		}
		units := parseUnits(raw)
		outputs["available_count"] = fmt.Sprintf("%d", len(units))
		outputs["available"] = boolStr(len(units) > 0)
		if len(units) > 0 {
			outputs["unit_number"] = units[0]
		}
		return outputs, true, nil

	case "assign_capsule", "book_capsule", "book_unit":
		unit := first(params["unitNumber"], params["unit_number"])
		guest := first(params["guestName"], params["guest_name"])
		raw, err := c.Post(ctx, "/api/units/assign", map[string]string{"unitNumber": unit, "guestName": guest})
		if err != nil {
			return nil, true, err
		}
		outputs["assigned"] = "true"
		mergeStringFields(raw, outputs)
		return outputs, true, nil

	case "create_checkin_link":
		guest := first(params["guestName"], params["guest_name"])
		phone := first(params["phoneNumber"], params["phone"])
		raw, err := c.Post(ctx, "/api/guest-tokens/internal", map[string]string{"guestName": guest, "phoneNumber": phone})
		if err != nil {
			return nil, true, err
		}
		mergeStringFields(raw, outputs)
		return outputs, true, nil

	default:
		// find_reservation / find_active_reservation / process_checkout /
		// log_service_request / check_lower_deck — not implemented (matching the
		// Node enhancer). Escalate to staff instead of faking PMS data.
		return nil, false, nil
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func parseUnits(raw json.RawMessage) []string {
	// Response is either an array of units or { units: [...] }.
	var arr []map[string]any
	if json.Unmarshal(raw, &arr) != nil {
		var wrap struct {
			Units []map[string]any `json:"units"`
		}
		if json.Unmarshal(raw, &wrap) != nil {
			return nil
		}
		arr = wrap.Units
	}
	out := make([]string, 0, len(arr))
	for _, u := range arr {
		for _, k := range []string{"unitNumber", "unit_number", "number", "name", "id"} {
			if v, ok := u[k]; ok {
				out = append(out, fmt.Sprintf("%v", v))
				break
			}
		}
	}
	return out
}

func mergeStringFields(raw json.RawMessage, out map[string]string) {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return
	}
	for k, v := range m {
		switch v.(type) {
		case string, float64, bool:
			out[k] = fmt.Sprintf("%v", v)
		}
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func first(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
