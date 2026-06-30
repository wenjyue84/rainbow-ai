package store

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func dbPath() string {
	return filepath.Join("..", "..", "..", "data", "rainbow-ai.db")
}

func TestInspectSchema(t *testing.T) {
	if _, err := os.Stat(dbPath()); err != nil {
		t.Skipf("no local DB: %v", err)
	}
	s, err := Open(dbPath())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()
	for _, tbl := range []string{"rainbow_messages", "rainbow_conversation_state", "rainbow_conversations"} {
		cols, err := s.TableColumns(tbl)
		if err != nil {
			t.Errorf("%s: %v", tbl, err)
			continue
		}
		names := make([]string, 0, len(cols))
		for n := range cols {
			names = append(names, n+":"+cols[n])
		}
		sort.Strings(names)
		t.Logf("%s (%d cols): %v", tbl, len(cols), names)
	}
}
