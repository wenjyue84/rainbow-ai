package semantic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/semantic" {
			http.Error(w, "404", 404)
			return
		}
		var in struct {
			Text string `json:"text"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		json.NewEncoder(w).Encode(map[string]any{"intent": "late_checkout_request", "score": 0.83, "example": "can I check out late"})
	}))
	defer srv.Close()

	c := New(srv.URL)
	intent, score, ex, err := c.Match(context.Background(), "possible to leave a bit later")
	if err != nil {
		t.Fatalf("Match: %v", err)
	}
	if intent != "late_checkout_request" || score != 0.83 || ex == "" {
		t.Errorf("got intent=%q score=%v ex=%q", intent, score, ex)
	}
}

func TestMatchSidecarDown(t *testing.T) {
	c := New("http://127.0.0.1:1") // nothing listening
	_, _, _, err := c.Match(context.Background(), "hello")
	if err == nil {
		t.Error("expected error when sidecar is down (classifier should degrade to T4)")
	}
}

func TestHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	}))
	defer srv.Close()
	if !New(srv.URL).Healthy(context.Background()) {
		t.Error("expected healthy")
	}
}
