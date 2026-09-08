package admin

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"rainbow-core/internal/config"
	"rainbow-core/internal/store"
)

// newDataServer is newServer with a temp data dir seeded with settings.json
// (default profile) so the profile-aware read/write helpers have a target.
func newDataServer(t *testing.T) (*httptest.Server, string, *Handler) {
	t.Helper()
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte(`{"bot_name":"Rainbow","ai":{"providers":[]}}`), 0o644)
	h := New(st, "", "", dataDir)
	h.SetProfiles([]string{"pelangi", "senai-app"}, "pelangi")
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { srv.Close(); st.Close() })
	return srv, dataDir, h
}

func doJSON(t *testing.T, method, url, profile string, body any) (int, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, url, rd)
	req.Header.Set("Content-Type", "application/json")
	if profile != "" {
		req.Header.Set("x-profile-id", profile)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	return resp.StatusCode, m
}

func TestIgnoredNumbersDefaultEmpty(t *testing.T) {
	srv, _, _ := newDataServer(t)
	code, body := doJSON(t, "GET", srv.URL+"/api/rainbow/settings/ignored-numbers", "pelangi", nil)
	if code != 200 {
		t.Fatalf("status %d: %v", code, body)
	}
	list, ok := body["ignoredNumbers"].([]any)
	if !ok || len(list) != 0 {
		t.Errorf("want empty array, got %v", body["ignoredNumbers"])
	}
}

func TestIgnoredNumbersPutInvalidPhone(t *testing.T) {
	srv, _, _ := newDataServer(t)
	code, body := doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "pelangi",
		map[string]any{"ignoredNumbers": []map[string]string{{"phone": "1234", "label": "short"}}})
	if code != 400 {
		t.Fatalf("want 400 for 4-digit phone, got %d: %v", code, body)
	}
	code, _ = doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "pelangi",
		map[string]any{"nope": true})
	if code != 400 {
		t.Errorf("want 400 for missing array, got %d", code)
	}
}

func TestIgnoredNumbersPutPersistsAndApplies(t *testing.T) {
	srv, dataDir, h := newDataServer(t)
	var gotProfile string
	var gotList []config.IgnoredNumber
	h.SetIgnoredApplier(func(pid string, list []config.IgnoredNumber) bool {
		gotProfile, gotList = pid, list
		return true
	})
	code, body := doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "pelangi",
		map[string]any{"ignoredNumbers": []map[string]string{
			{"phone": "+60 17-670 1102", "label": "Maya"},
			{"phone": "60167620815", "label": "Alston"},
			{"phone": "60167620815", "label": "dupe"},
		}})
	if code != 200 {
		t.Fatalf("status %d: %v", code, body)
	}
	if body["applied"] != true {
		t.Errorf("applied = %v, want true", body["applied"])
	}
	if gotProfile != "pelangi" {
		t.Errorf("applier profile = %q, want pelangi (default mapped from \"\")", gotProfile)
	}
	if len(gotList) != 2 || gotList[0].Phone != "60176701102" || gotList[1].Label != "Alston" {
		t.Errorf("applier list = %+v", gotList)
	}

	// File: key merged, other keys intact.
	b, _ := os.ReadFile(filepath.Join(dataDir, "settings.json"))
	var doc map[string]any
	json.Unmarshal(b, &doc)
	if doc["bot_name"] != "Rainbow" {
		t.Errorf("bot_name lost on merge: %v", doc)
	}
	if arr, _ := doc["ignoredNumbers"].([]any); len(arr) != 2 {
		t.Errorf("file ignoredNumbers = %v", doc["ignoredNumbers"])
	}

	// GET round-trips.
	code, body = doJSON(t, "GET", srv.URL+"/api/rainbow/settings/ignored-numbers", "pelangi", nil)
	if code != 200 {
		t.Fatalf("GET status %d", code)
	}
	if arr, _ := body["ignoredNumbers"].([]any); len(arr) != 2 {
		t.Errorf("GET ignoredNumbers = %v", body["ignoredNumbers"])
	}

	// Non-default profile writes its own variant, never the global file.
	code, _ = doJSON(t, "PUT", srv.URL+"/api/rainbow/settings/ignored-numbers", "senai-app",
		map[string]any{"ignoredNumbers": []map[string]string{{"phone": "60111111111", "label": "X"}}})
	if code != 200 {
		t.Fatalf("senai PUT status %d", code)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "settings-senai-app.json")); err != nil {
		t.Errorf("settings-senai-app.json not created: %v", err)
	}
	b, _ = os.ReadFile(filepath.Join(dataDir, "settings.json"))
	json.Unmarshal(b, &doc)
	if arr, _ := doc["ignoredNumbers"].([]any); len(arr) != 2 {
		t.Errorf("global file changed by senai PUT: %v", doc["ignoredNumbers"])
	}
	if gotProfile != "senai-app" {
		t.Errorf("applier profile = %q, want senai-app", gotProfile)
	}
}

func TestLLMLatencyWithoutProber(t *testing.T) {
	srv, _, _ := newDataServer(t)
	code, body := doJSON(t, "POST", srv.URL+"/api/rainbow/test/llm-latency", "pelangi", map[string]any{"providerId": "x"})
	if code != 501 {
		t.Errorf("want 501 without prober, got %d: %v", code, body)
	}
}
