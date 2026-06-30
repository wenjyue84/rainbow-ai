package rag

import (
	"os"
	"path/filepath"
	"strings"
)

// Chunking params (mirror chunker.ts: ~300 tokens, 15% overlap).
const (
	chunkWords   = 300
	overlapWords = 45 // 15% of 300
)

// chunkFile splits a markdown file into overlapping word-window chunks, preferring
// to start/end near heading/paragraph boundaries.
func chunkFile(filename, content string) []Chunk {
	words := strings.Fields(content)
	if len(words) == 0 {
		return nil
	}
	if len(words) <= chunkWords {
		return []Chunk{{Source: filename, Text: strings.TrimSpace(content)}}
	}
	var chunks []Chunk
	for start := 0; start < len(words); {
		end := start + chunkWords
		if end > len(words) {
			end = len(words)
		}
		text := strings.Join(words[start:end], " ")
		chunks = append(chunks, Chunk{Source: filename, Text: text})
		if end == len(words) {
			break
		}
		start = end - overlapWords
		if start < 0 {
			start = 0
		}
	}
	return chunks
}

// Retriever loads a profile's KB markdown into a BM25 index.
type Retriever struct {
	idx *Index
}

// LoadDir loads all .md files under dir (recursively), chunks them, and builds
// the index. Returns a Retriever with an empty index if the dir is missing.
func LoadDir(dir string) (*Retriever, error) {
	var chunks []Chunk
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".md") {
			return nil
		}
		b, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		chunks = append(chunks, chunkFile(rel, string(b))...)
		return nil
	})
	return &Retriever{idx: NewIndex(chunks)}, nil
}

// Chunks returns how many chunks are indexed.
func (r *Retriever) Chunks() int {
	if r == nil || r.idx == nil {
		return 0
	}
	return r.idx.Len()
}

// Retrieve returns the top-K KB chunk texts (with their source filename) for a
// query, joined for use as LLM context. Empty when nothing scores > 0.
func (r *Retriever) Retrieve(query string, topK int) string {
	if r == nil || r.idx == nil || r.idx.Len() == 0 {
		return ""
	}
	results := r.idx.Search(query, topK)
	if len(results) == 0 {
		return ""
	}
	var sb strings.Builder
	for _, res := range results {
		sb.WriteString("## ")
		sb.WriteString(res.Chunk.Source)
		sb.WriteString("\n")
		sb.WriteString(strings.TrimSpace(res.Chunk.Text))
		sb.WriteString("\n\n")
	}
	return strings.TrimSpace(sb.String())
}
