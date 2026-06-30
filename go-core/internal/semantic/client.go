// Package semantic is the Go core's T3 client to the Node ML sidecar. It calls
// the sidecar's /semantic endpoint (embeddings stay in the sidecar process) and
// implements classify.Semantic. When the sidecar is unreachable the classifier
// degrades gracefully to T1/T2/T4.
package semantic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Client calls the ML sidecar.
type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) *Client {
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 5 * time.Second}}
}

// Match implements classify.Semantic: returns the best intent for text.
func (c *Client) Match(ctx context.Context, text string) (string, float64, string, error) {
	body, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/semantic", bytes.NewReader(body))
	if err != nil {
		return "", 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", 0, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, "", fmt.Errorf("sidecar /semantic http %d", resp.StatusCode)
	}
	var out struct {
		Intent  string  `json:"intent"`
		Score   float64 `json:"score"`
		Example string  `json:"example"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", 0, "", err
	}
	return out.Intent, out.Score, out.Example, nil
}

// Healthy reports whether the sidecar is up and finished loading.
func (c *Client) Healthy(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return false
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var out struct {
		Status string `json:"status"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return out.Status == "ok"
}
