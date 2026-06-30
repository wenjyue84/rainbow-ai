// Package rag is the Go port of assistant/rag (bm25.ts + chunker.ts): a sparse
// BM25 retriever over the profile's knowledge-base markdown files. It grounds
// llm_reply with the most relevant KB chunks. (Dense/vector rerank can be layered
// on later via the ML sidecar's /embed endpoint.)
package rag

import (
	"math"
	"strings"
	"unicode"
)

// BM25 parameters (standard, matching bm25.ts).
const (
	k1 = 1.2
	b  = 0.75
)

// Chunk is a retrievable KB segment.
type Chunk struct {
	Source string // filename
	Text   string
}

// Result is a scored chunk.
type Result struct {
	Chunk Chunk
	Score float64
}

var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "and": true, "or": true, "but": true, "is": true,
	"are": true, "was": true, "were": true, "to": true, "of": true, "in": true, "on": true,
	"at": true, "for": true, "with": true, "as": true, "by": true, "it": true, "this": true,
	"that": true, "be": true, "do": true, "does": true, "i": true, "you": true, "we": true,
	"can": true, "will": true, "my": true, "your": true,
	// Malay common
	"yang": true, "dan": true, "di": true, "ke": true, "untuk": true, "ada": true, "ini": true,
	"itu": true, "saya": true, "anda": true,
}

// tokenize mirrors bm25.ts: lowercase, keep word chars + CJK + Tamil, drop
// 1-char tokens and stop words.
func tokenize(text string) []string {
	var sb strings.Builder
	for _, r := range strings.ToLower(text) {
		if r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.Is(unicode.Han, r) || unicode.Is(unicode.Tamil, r) {
			sb.WriteRune(r)
		} else {
			sb.WriteRune(' ')
		}
	}
	var out []string
	for _, t := range strings.Fields(sb.String()) {
		if len([]rune(t)) > 1 && !stopWords[t] {
			out = append(out, t)
		}
	}
	return out
}

// Index is an in-memory BM25 index over KB chunks.
type Index struct {
	docs        []Chunk
	docTokens   [][]string
	docLengths  []int
	avgDocLen   float64
	termDocFreq map[string]int
	n           int
}

// NewIndex builds a BM25 index from chunks.
func NewIndex(chunks []Chunk) *Index {
	idx := &Index{docs: chunks, n: len(chunks), termDocFreq: map[string]int{}}
	total := 0
	for _, c := range chunks {
		toks := tokenize(c.Text)
		idx.docTokens = append(idx.docTokens, toks)
		idx.docLengths = append(idx.docLengths, len(toks))
		total += len(toks)
		seen := map[string]bool{}
		for _, t := range toks {
			if !seen[t] {
				seen[t] = true
				idx.termDocFreq[t]++
			}
		}
	}
	if idx.n > 0 {
		idx.avgDocLen = float64(total) / float64(idx.n)
	}
	return idx
}

// Len returns the number of indexed chunks.
func (idx *Index) Len() int { return idx.n }

// Search returns the top-K chunks for a query, scored by BM25.
func (idx *Index) Search(query string, topK int) []Result {
	if idx.n == 0 {
		return nil
	}
	terms := tokenize(query)
	if len(terms) == 0 {
		return nil
	}
	scores := make([]float64, idx.n)
	for _, term := range terms {
		df := idx.termDocFreq[term]
		if df == 0 {
			continue
		}
		idf := math.Log((float64(idx.n)-float64(df)+0.5)/(float64(df)+0.5) + 1)
		for i := 0; i < idx.n; i++ {
			tf := countTerm(idx.docTokens[i], term)
			if tf == 0 {
				continue
			}
			docLen := float64(idx.docLengths[i])
			num := float64(tf) * (k1 + 1)
			den := float64(tf) + k1*(1-b+b*(docLen/idx.avgDocLen))
			scores[i] += idf * (num / den)
		}
	}
	// Collect positive-scored, sort desc, take topK.
	type sc struct {
		i int
		s float64
	}
	var ranked []sc
	for i, s := range scores {
		if s > 0 {
			ranked = append(ranked, sc{i, s})
		}
	}
	// simple insertion sort by score desc (topK small)
	for i := 1; i < len(ranked); i++ {
		for j := i; j > 0 && ranked[j].s > ranked[j-1].s; j-- {
			ranked[j], ranked[j-1] = ranked[j-1], ranked[j]
		}
	}
	if topK > len(ranked) {
		topK = len(ranked)
	}
	out := make([]Result, 0, topK)
	for i := 0; i < topK; i++ {
		out = append(out, Result{Chunk: idx.docs[ranked[i].i], Score: ranked[i].s})
	}
	return out
}

func countTerm(tokens []string, term string) int {
	c := 0
	for _, t := range tokens {
		if t == term {
			c++
		}
	}
	return c
}
