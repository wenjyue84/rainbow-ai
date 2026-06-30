package transcribe

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranscribe(t *testing.T) {
	// Mock media server (serves the audio bytes the bridge would host).
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OGGFAKEAUDIOBYTES"))
	}))
	defer media.Close()

	// Mock Groq Whisper endpoint.
	groq := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gk" {
			http.Error(w, "unauthorized", 401)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			http.Error(w, "expected multipart", 400)
			return
		}
		// Verify the file part arrived.
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, "bad form", 400)
			return
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "no file", 400)
			return
		}
		f.Close()
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("what time is check in"))
	}))
	defer groq.Close()

	c := New("gk", "whisper-large-v3")
	c.endpoint = groq.URL // point at the mock

	text, err := c.Transcribe(context.Background(), media.URL+"/voice.ogg")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if text != "what time is check in" {
		t.Errorf("transcript = %q", text)
	}
}

func TestTranscribeNoKey(t *testing.T) {
	c := New("", "")
	if c.Configured() {
		t.Error("should not be configured without a key")
	}
	_, err := c.Transcribe(context.Background(), "http://x/a.ogg")
	if err == nil {
		t.Error("expected error without API key")
	}
}

func TestTranscribeJSONResponse(t *testing.T) {
	media := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("audio"))
	}))
	defer media.Close()
	groq := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"text":"hello there"}`))
	}))
	defer groq.Close()
	c := New("gk", "")
	c.endpoint = groq.URL
	text, err := c.Transcribe(context.Background(), media.URL)
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if text != "hello there" {
		t.Errorf("transcript = %q (JSON response should be parsed)", text)
	}
}
