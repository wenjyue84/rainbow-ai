package config

import (
	"path/filepath"
	"testing"
)

func dataDir() string { return filepath.Join("..", "..", "..", "src", "assistant", "data") }

func TestLoadAllProfiles(t *testing.T) {
	for _, p := range []string{"pelangi", "southern", "makan"} {
		prof, err := Load(dataDir(), p)
		if err != nil {
			t.Errorf("%s: load error: %v", p, err)
			continue
		}
		t.Logf("%-10s patterns=%d keywords=%d routes=%d static=%d whitelist=%d providers=%d",
			p, len(prof.Patterns), len(prof.Keywords), len(prof.Routing), len(prof.Static), len(prof.Allowed), len(prof.Providers))
		if len(prof.Keywords) == 0 {
			t.Errorf("%s: no keywords loaded", p)
		}
		if len(prof.Routing) == 0 {
			t.Errorf("%s: no routing loaded", p)
		}
	}
}
