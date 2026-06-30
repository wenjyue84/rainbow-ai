package rag

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBM25Ranking(t *testing.T) {
	chunks := []Chunk{
		{Source: "wifi.md", Text: "The wifi password is ilovestaycapsule and the network is pelangi capsule"},
		{Source: "checkin.md", Text: "Check-in time is 3pm and check-out is 12 noon"},
		{Source: "pricing.md", Text: "Daily rate is RM40 per night, weekly discount available"},
	}
	idx := NewIndex(chunks)
	if idx.Len() != 3 {
		t.Fatalf("len = %d", idx.Len())
	}
	res := idx.Search("what is the wifi password", 3)
	if len(res) == 0 {
		t.Fatal("no results for wifi query")
	}
	if res[0].Chunk.Source != "wifi.md" {
		t.Errorf("top result = %q, want wifi.md", res[0].Chunk.Source)
	}

	res2 := idx.Search("how much per night rate", 3)
	if len(res2) == 0 || res2[0].Chunk.Source != "pricing.md" {
		t.Errorf("pricing query top = %v, want pricing.md", res2)
	}
}

func TestChunkFileOverlap(t *testing.T) {
	// 700 words → multiple overlapping chunks.
	words := make([]string, 700)
	for i := range words {
		words[i] = "word"
	}
	chunks := chunkFile("big.md", strings.Join(words, " "))
	if len(chunks) < 2 {
		t.Errorf("expected multiple chunks for 700 words, got %d", len(chunks))
	}
}

func TestLoadRealKB(t *testing.T) {
	dir := filepath.Join("..", "..", "..", ".rainbow-kb")
	if _, err := os.Stat(dir); err != nil {
		t.Skipf("no KB dir: %v", err)
	}
	r, err := LoadDir(dir)
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	if r.Chunks() == 0 {
		t.Fatal("no chunks loaded from real KB")
	}
	t.Logf("loaded %d chunks from %s", r.Chunks(), dir)

	// A wifi query should retrieve content mentioning wifi.
	ctx := r.Retrieve("what is the wifi password", 5)
	if ctx == "" {
		t.Fatal("wifi query returned no KB context")
	}
	if !strings.Contains(strings.ToLower(ctx), "wifi") && !strings.Contains(strings.ToLower(ctx), "password") {
		t.Errorf("retrieved context does not look wifi-related:\n%.200s", ctx)
	}
}
