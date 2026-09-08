package kb

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDirFor(t *testing.T) {
	if got := DirFor("/kb", "senai-app"); got != filepath.Join("/kb", ".rainbow-kb-senai") {
		t.Fatalf("senai-app dir = %q", got)
	}
	if got := DirFor("/kb", "pelangi"); got != filepath.Join("/kb", ".rainbow-kb") {
		t.Fatalf("pelangi dir = %q", got)
	}
	if got := DirFor("/kb", "new-one"); got != filepath.Join("/kb", ".rainbow-kb-new-one") {
		t.Fatalf("unknown dir = %q", got)
	}
	if DirFor("/kb", "") != "" {
		t.Fatal("empty profile should give empty dir")
	}
}

func TestSafePath(t *testing.T) {
	dir := t.TempDir()
	for _, bad := range []string{"../x.md", "a/../../x.md", "x.txt", ".hidden.md", "a/b/c.md", "", "x.md/"} {
		if _, err := SafePath(dir, bad); err == nil {
			t.Errorf("SafePath accepted %q", bad)
		}
	}
	for _, good := range []string{"tenants.md", "memory/2026-09-08.md", "a-b_c.md"} {
		if _, err := SafePath(dir, good); err != nil {
			t.Errorf("SafePath rejected %q: %v", good, err)
		}
	}
}

func TestValidateBoundary(t *testing.T) {
	ok := Entry("Wan 151r15 personality", "2026-09-08", "Jesi DM", "", "Talks a lot, promises then goes quiet. Prefers BM, replies late evening.")
	if err := Validate(ok); err != nil {
		t.Fatalf("valid entry rejected: %v", err)
	}
	cases := map[string]string{
		"missing_as_of":  "## x\nsource: Jesi\nbody",
		"missing_source": "## x\nas_of: 2026-09-08\nbody",
		"belongs_in_app": Entry("x", "2026-09-08", "Jesi", "", "He still owes RM400 for August"),
	}
	for code, content := range cases {
		err := Validate(content)
		ve, _ := err.(*ValidationError)
		if ve == nil || ve.Code != code {
			t.Errorf("%s: got %v", code, err)
		}
	}
	for _, bad := range []string{"deposit refund pending", "sudah bayar bulan 8", "151r15 ... 1180", "他的押金还没退", "baki 920"} {
		if err := Validate(Entry("x", "2026-09-08", "Jesi", "", bad)); err == nil {
			t.Errorf("money-ish body accepted: %q", bad)
		}
	}
}

func TestWriteAppendListStale(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".rainbow-kb-senai")
	if _, err := Write(dir, "tenants.md", Entry("A", "2026-01-01", "Jesi", "2026-03-01", "old one")); err != nil {
		t.Fatal(err)
	}
	if err := Append(dir, "tenants.md", Entry("B", "2026-09-08", "Ah Ying", "", "fresh one")); err != nil {
		t.Fatal(err)
	}
	if err := Append(dir, "memory/2026-09-08.md", "## note\nas_of: 2026-09-08 · source: Jay\nhi"); err != nil {
		t.Fatal(err)
	}
	files, err := List(dir)
	if err != nil || len(files) != 2 {
		t.Fatalf("List = %v, %v", files, err)
	}
	content, _ := Read(dir, "tenants.md")
	if !strings.Contains(content, "## A") || !strings.Contains(content, "## B") || !strings.Contains(content, "\n\n## B") {
		t.Fatalf("append layout wrong:\n%s", content)
	}
	backup, err := Write(dir, "tenants.md", Entry("C", "2026-09-08", "Jay", "", "replaced"))
	if err != nil || backup != "tenants.md.bak" {
		t.Fatalf("backup = %q err=%v", backup, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "tenants.md.bak")); err != nil {
		t.Fatal("backup file missing")
	}
	// stale: memory note has no review_by and as_of today → not stale; write an old one
	_ = Append(dir, "houses.md", Entry("Old", "2026-01-01", "Jesi", "2026-02-01", "expired"))
	today := time.Date(2026, 9, 8, 0, 0, 0, 0, time.UTC)
	st, err := Stale(dir, today, 90*24*time.Hour)
	if err != nil || len(st) != 1 || st[0].Title != "Old" || st[0].Why != "review_by passed" {
		t.Fatalf("Stale = %+v err=%v", st, err)
	}
	if _, err := List(filepath.Join(dir, "does-not-exist")); err != nil {
		t.Fatalf("List missing dir should be empty, got %v", err)
	}
}
