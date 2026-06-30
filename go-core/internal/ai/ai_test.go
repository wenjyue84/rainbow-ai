package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"rainbow-core/internal/config"
)

// mockOpenAI returns a server that echoes a fixed assistant content.
func mockOpenAI(t *testing.T, content string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.Error(w, "not found", 404)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, "unauthorized", 401)
			return
		}
		var body openAIReq
		json.NewDecoder(r.Body).Decode(&body)
		resp := openAIResp{}
		resp.Choices = append(resp.Choices, struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		}{})
		resp.Choices[0].Message.Content = content
		resp.Usage = Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15}
		json.NewEncoder(w).Encode(resp)
	}))
}

func testProfile(baseURL string) *config.Profile {
	p := &config.Profile{
		ID:           "test",
		Routing:      map[string]config.Route{"greeting": {Action: "static_reply"}, "pricing": {Action: "llm_reply"}, "booking": {Action: "workflow"}},
		ProviderByID: map[string]config.Provider{},
	}
	prov := config.Provider{ID: "mock", Type: "openai-compatible", APIKeyEnv: "MOCK_KEY", BaseURL: baseURL, Model: "test-model", Enabled: true, Priority: 0, TimeoutMs: 5000}
	p.ProviderByID["mock"] = prov
	p.Providers = []config.Provider{prov}
	p.Selected = []string{"mock"}
	return p
}

func TestChatOpenAI(t *testing.T) {
	srv := mockOpenAI(t, "Hello from mock")
	defer srv.Close()
	t.Setenv("MOCK_KEY", "test-key")

	prof := testProfile(srv.URL)
	m := New(prof)
	if !m.Available() {
		t.Fatal("expected provider available")
	}
	res, err := m.Chat(context.Background(), []ChatMessage{{Role: "user", Content: "hi"}}, 100, 0.2, false)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if res.Content != "Hello from mock" {
		t.Errorf("content = %q", res.Content)
	}
	if res.Usage.TotalTokens != 15 {
		t.Errorf("usage = %+v", res.Usage)
	}
}

func TestLLMClassify(t *testing.T) {
	srv := mockOpenAI(t, `{"category":"pricing","confidence":0.88,"entities":{}}`)
	defer srv.Close()
	t.Setenv("MOCK_KEY", "test-key")

	prof := testProfile(srv.URL)
	m := New(prof)
	c := NewClassifier(prof, m)
	r, err := c.Classify(context.Background(), "how much for a week", "", nil)
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	if r.Category != "pricing" {
		t.Errorf("category = %q, want pricing", r.Category)
	}
	if r.Confidence != 0.88 {
		t.Errorf("confidence = %v", r.Confidence)
	}
}

func TestLLMClassifyMarkdownWrapped(t *testing.T) {
	srv := mockOpenAI(t, "```json\n{\"category\":\"booking\",\"confidence\":0.7}\n```")
	defer srv.Close()
	t.Setenv("MOCK_KEY", "test-key")
	prof := testProfile(srv.URL)
	c := NewClassifier(prof, New(prof))
	r, err := c.Classify(context.Background(), "book a room", "", nil)
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	if r.Category != "booking" {
		t.Errorf("category = %q, want booking (markdown-wrapped JSON should parse)", r.Category)
	}
}

func TestUnknownCategoryMappedToGeneral(t *testing.T) {
	srv := mockOpenAI(t, `{"category":"made_up_intent","confidence":0.9}`)
	defer srv.Close()
	t.Setenv("MOCK_KEY", "test-key")
	prof := testProfile(srv.URL)
	c := NewClassifier(prof, New(prof))
	r, _ := c.Classify(context.Background(), "xyz", "", nil)
	if r.Category != "general" {
		t.Errorf("category = %q, want general (invalid intent should map to general)", r.Category)
	}
}

func TestGenerateReply(t *testing.T) {
	srv := mockOpenAI(t, "Our weekly rate is RM250.")
	defer srv.Close()
	t.Setenv("MOCK_KEY", "test-key")
	prof := testProfile(srv.URL)
	m := New(prof)
	res, err := m.GenerateReply(context.Background(), "You are a hostel assistant.", "Weekly: RM250", nil, "how much weekly", "en", 200, 0.3)
	if err != nil {
		t.Fatalf("GenerateReply: %v", err)
	}
	if res.Content == "" {
		t.Error("empty reply")
	}
}

func TestNoKeyNoLocalUnavailable(t *testing.T) {
	prof := testProfile("http://example.invalid")
	// MOCK_KEY not set
	m := New(prof)
	if m.Available() {
		t.Error("expected unavailable when no key set and not local")
	}
}
