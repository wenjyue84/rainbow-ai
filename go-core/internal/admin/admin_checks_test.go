package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rainbow-core/internal/ai"
	"rainbow-core/internal/classify"
	"rainbow-core/internal/store"
)

// seedDataDir writes a minimal-but-consistent set of profile config files.
func seedDataDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"intents.json": `{"categories":[{"intents":[{"category":"booking","patterns":["\\bbook\\b"]}]}]}`,
		"intent-keywords.json": `{"intents":[
			{"intent":"booking","keywords":{"en":["book a capsule","reserve a bed"],"ms":["tempah kapsul"]}},
			{"intent":"wifi","keywords":{"en":["wifi password"],"zh":["无线网络密码"]}}]}`,
		"intent-examples.json": `{"intents":[{"intent":"booking","examples":{"en":["i want to book"]}},{"intent":"wifi","examples":{"en":["wifi?"]}},{"intent":"pricing","examples":{"en":["price?"]}}]}`,
		"knowledge.json":       `{"static":[{"intent":"wifi","response":{"en":"WiFi: pelangi123"}}]}`,
		"routing.json":         `{"booking":{"action":"workflow","workflow_id":"wf1"},"wifi":{"action":"static_reply"}}`,
		"settings.json":        `{"ai":{"providers":[]}}`,
		"workflows.json":       `{"workflows":[{"id":"wf1","name":"Book","startNodeId":"n1","nodes":[{"id":"n1","type":"message","next":"n2"},{"id":"n2","type":"wait_reply"}]}]}`,
		"intent-tiers.json":    `{"tiers":{"tier1_emergency":{"enabled":true},"tier2_fuzzy":{"enabled":true,"threshold":0.8},"tier3_semantic":{"enabled":true,"threshold":0.67},"tier4_llm":{"enabled":true}},"schema_version":"1.0.0"}`,
		"llm-settings.json":    `{"thresholds":{"fuzzy":0.85},"schema_version":"1.0.0"}`,
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func newServerWithData(t *testing.T, dataDir string) (*httptest.Server, *Handler, *store.Store) {
	t.Helper()
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	h := New(st, "", "", dataDir)
	h.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { srv.Close(); st.Close() })
	return srv, h, st
}

func postJSON(t *testing.T, url string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	return resp.StatusCode, m
}

func TestIntentManagerStats(t *testing.T) {
	srv, _, _ := newServerWithData(t, seedDataDir(t))
	code, body := get(t, srv.URL+"/api/rainbow/intent-manager/stats", "")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	if body["totalIntents"] != float64(2) {
		t.Errorf("totalIntents = %v, want 2", body["totalIntents"])
	}
	if body["totalKeywords"] != float64(5) {
		t.Errorf("totalKeywords = %v, want 5", body["totalKeywords"])
	}
	if body["totalExamples"] != float64(3) {
		t.Errorf("totalExamples = %v, want 3", body["totalExamples"])
	}
}

func TestTiersRoundtrip(t *testing.T) {
	dataDir := seedDataDir(t)
	srv, _, _ := newServerWithData(t, dataDir)

	// PUT the SPA's partial fragment.
	req, _ := http.NewRequest("PUT", srv.URL+"/api/rainbow/intent-manager/tiers",
		strings.NewReader(`{"tiers":{"tier2_fuzzy":{"enabled":false}}}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("PUT status %d", resp.StatusCode)
	}

	// GET reflects the change; sibling keys survive the merge.
	code, tiers := get(t, srv.URL+"/api/rainbow/intent-manager/tiers", "")
	if code != 200 {
		t.Fatalf("GET status %d", code)
	}
	t2, _ := tiers["tier2_fuzzy"].(map[string]any)
	if t2 == nil || t2["enabled"] != false {
		t.Errorf("tier2_fuzzy not disabled: %v", tiers)
	}
	if t2["threshold"] != float64(0.8) {
		t.Errorf("tier2 threshold lost in merge: %v", t2)
	}
	t4, _ := tiers["tier4_llm"].(map[string]any)
	if t4 == nil || t4["enabled"] != true {
		t.Errorf("tier4_llm clobbered: %v", tiers)
	}
}

func TestSystemPromptSave(t *testing.T) {
	dataDir := seedDataDir(t)
	srv, _, _ := newServerWithData(t, dataDir)
	code, body := postJSON(t, srv.URL+"/api/rainbow/intent-manager/system-prompt", map[string]any{"prompt": "You classify hostel intents."})
	if code != 200 || body["ok"] != true {
		t.Fatalf("status %d body %v", code, body)
	}
	b, _ := os.ReadFile(filepath.Join(dataDir, "llm-settings.json"))
	var doc map[string]any
	json.Unmarshal(b, &doc)
	if doc["systemPrompt"] != "You classify hostel intents." {
		t.Errorf("systemPrompt not persisted: %v", doc["systemPrompt"])
	}
	if doc["schema_version"] != "1.0.0" {
		t.Errorf("schema_version lost: %v", doc)
	}
}

func TestChecksSuites(t *testing.T) {
	srv, h, _ := newServerWithData(t, seedDataDir(t))

	for _, project := range []string{"unit", "integration"} {
		code, body := postJSON(t, srv.URL+"/api/rainbow/tests/run", map[string]any{"project": project})
		if code != 200 {
			t.Fatalf("%s status %d", project, code)
		}
		if body["numTotalTests"].(float64) < 1 {
			t.Errorf("%s: no tests ran: %v", project, body)
		}
		if body["success"] != true {
			t.Errorf("%s: suite failed on consistent seeds: %v", project, body)
		}
		if _, ok := body["testFiles"].([]any); !ok {
			t.Errorf("%s: missing testFiles: %v", project, body)
		}
	}

	// Semantic with a stub classifier: booking passes, others fail.
	h.SetClassify(func(_ context.Context, text string) classify.Result {
		return classify.Result{Category: "booking", Confidence: 0.9, Source: classify.SrcRegex}
	})
	code, body := postJSON(t, srv.URL+"/api/rainbow/tests/run", map[string]any{"project": "semantic"})
	if code != 200 {
		t.Fatalf("semantic status %d", code)
	}
	if body["numPassedTests"].(float64) < 1 || body["numFailedTests"].(float64) < 1 {
		t.Errorf("stub semantic counts wrong: %v", body)
	}

	// run-all aggregates all three suites.
	code, all := postJSON(t, srv.URL+"/api/rainbow/testing/run-all", map[string]any{})
	if code != 200 {
		t.Fatalf("run-all status %d", code)
	}
	if all["numTotalTests"].(float64) <= body["numTotalTests"].(float64) {
		t.Errorf("run-all did not aggregate: %v", all["numTotalTests"])
	}
}

func TestWebchatReplyInserts(t *testing.T) {
	srv, _, st := newServerWithData(t, seedDataDir(t))
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('web:replysess','user','hi',?, 'pelangi')`, store.NowISO())

	code, body := postJSON(t, srv.URL+"/api/rainbow/webchat/conversations/replysess/reply",
		map[string]any{"message": "Hello from staff", "staffName": "Jay"})
	if code != 200 {
		t.Fatalf("status %d body %v", code, body)
	}
	if _, ok := body["timestamp"].(float64); !ok {
		t.Errorf("timestamp not numeric: %v", body)
	}
	var n int
	st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone='web:replysess' AND role='staff' AND source='webchat-admin'`).Scan(&n)
	if n != 1 {
		t.Errorf("staff row count = %d, want 1", n)
	}
}

func TestConversationSendNoBridge(t *testing.T) {
	srv, _, st := newServerWithData(t, seedDataDir(t))
	// The ownership gate 404s unknown conversations before the bridge check, so
	// the conversation must exist in the default profile first.
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('60123','user','hello',?,?)`,
		store.NowISO(), "pelangi")
	code, body := postJSON(t, srv.URL+"/api/rainbow/conversations/60123/send", map[string]any{"message": "hi"})
	if code != 501 {
		t.Errorf("expected 501 without bridge, got %d %v", code, body)
	}
	// Unknown conversation → 404, never a bridge attempt.
	code, _ = postJSON(t, srv.URL+"/api/rainbow/conversations/60999999999/send", map[string]any{"message": "hi"})
	if code != 404 {
		t.Errorf("expected 404 for unowned conversation, got %d", code)
	}
}

// stubChatter fakes the LLM for generate-draft.
type stubChatter struct{ content string }

func (s stubChatter) Chat(context.Context, []ai.ChatMessage, int, float64, bool) (*ai.ChatResult, error) {
	return &ai.ChatResult{Content: s.content}, nil
}

func TestGenerateDraftStub(t *testing.T) {
	srv, h, _ := newServerWithData(t, seedDataDir(t))

	// No AI wired → 502.
	code, body := postJSON(t, srv.URL+"/api/rainbow/knowledge/generate-draft", map[string]any{"topic": "luggage"})
	if code != 502 {
		t.Errorf("expected 502 without AI, got %d %v", code, body)
	}

	h.SetAI(stubChatter{content: "```json\n{\"intent\":\"luggage_storage\",\"phase\":\"CHECKOUT_DEPARTURE\",\"response\":{\"en\":\"Yes we store bags\",\"ms\":\"Ya\",\"zh\":\"可以\"}}\n```"})
	code, body = postJSON(t, srv.URL+"/api/rainbow/knowledge/generate-draft", map[string]any{"topic": "luggage"})
	if code != 200 || body["ok"] != true {
		t.Fatalf("status %d body %v", code, body)
	}
	if body["intent"] != "luggage_storage" || body["phase"] != "CHECKOUT_DEPARTURE" {
		t.Errorf("draft fields wrong: %v", body)
	}
	resp, _ := body["response"].(map[string]any)
	if resp == nil || resp["zh"] != "可以" {
		t.Errorf("trilingual response wrong: %v", body)
	}

	// Invalid phase falls back to GENERAL_SUPPORT.
	if _, phase, _, ok := parseDraftJSON(`{"intent":"x","phase":"NOPE","response":{"en":"y"}}`); !ok || phase != "GENERAL_SUPPORT" {
		t.Errorf("phase fallback broken: ok=%v phase=%s", ok, phase)
	}
}

func TestBuildDraftPrompt(t *testing.T) {
	p := buildDraftPrompt([]string{"wifi", "pricing"}, "laundry")
	for _, want := range []string{"wifi, pricing", "laundry", "GENERAL_SUPPORT", `"response"`} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
}
