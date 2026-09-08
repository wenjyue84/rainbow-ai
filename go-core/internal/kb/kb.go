// Package kb is the per-profile markdown knowledge base on disk: which
// directory a profile's KB lives in, safe read/write/append of *.md files
// inside it, and the Senai "knowledge boundary" validator (2026-09-08).
//
// Boundary rule (Jay, 2026-09-08): anything that will be used to compute money
// or build a report — rent, deposits, payment status, room state, tenant
// identity, maintenance tickets — lives ONLY in senai.wenjyue.com. The KB holds
// soft, one-off, interpersonal knowledge (tenant temperament, disputes, verbal
// promises, staff habits). Strict profiles reject writes that look like money
// or payment state so the boundary is enforced server-side, not by convention.
package kb

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// profileDir maps a profile id to its KB sub-directory under RAINBOW_KB_ROOT.
// Mirrors profiles.json kbDir. Unknown profiles get ".rainbow-kb-<id>".
var profileDir = map[string]string{
	"pelangi":      ".rainbow-kb",
	"southern":     ".rainbow-kb-southern",
	"makan":        ".rainbow-kb-makan",
	"dental-world": ".rainbow-kb-dental-world",
	"yoongmei":     ".rainbow-kb-yoongmei",
	"kb-aircond":   ".rainbow-kb-kb-aircond",
	"senai-app":    ".rainbow-kb-senai",
	"jayson-pa":    ".rainbow-kb-jayson-pa",
}

// DirFor returns the KB directory for a profile ("" when profile is empty).
func DirFor(root, profile string) string {
	profile = strings.TrimSpace(strings.ToLower(profile))
	if profile == "" {
		return ""
	}
	sub, ok := profileDir[profile]
	if !ok {
		sub = ".rainbow-kb-" + profile
	}
	return filepath.Join(root, sub)
}

// strictProfiles are the profiles whose KB writes must pass Validate.
var strictProfiles = map[string]bool{"senai-app": true}

// Strict reports whether writes to profile's KB are validated against the
// knowledge boundary.
func Strict(profile string) bool { return strictProfiles[strings.ToLower(profile)] }

// FileInfo describes one KB markdown file.
type FileInfo struct {
	Name     string `json:"name"`     // relative path inside the KB dir, forward slashes
	Size     int64  `json:"size"`     // bytes
	Modified string `json:"modified"` // RFC3339
}

var nameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)?\.md$`)

// ErrBadName is returned for a file name outside the allowed shape.
var ErrBadName = errors.New("file name must be <name>.md (letters, digits, . _ -, optional one-level sub-dir)")

// SafePath resolves name inside dir, refusing traversal and non-.md names.
func SafePath(dir, name string) (string, error) {
	name = strings.TrimSpace(strings.ReplaceAll(name, "\\", "/"))
	if dir == "" || !nameRe.MatchString(name) || strings.Contains(name, "..") {
		return "", ErrBadName
	}
	full := filepath.Clean(filepath.Join(dir, filepath.FromSlash(name)))
	rel, err := filepath.Rel(dir, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", ErrBadName
	}
	return full, nil
}

// List returns every *.md file under dir (one sub-dir level, e.g. memory/),
// sorted by name. A missing dir is an empty list, not an error.
func List(dir string) ([]FileInfo, error) {
	if dir == "" {
		return nil, errors.New("no kb dir")
	}
	var out []FileInfo
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) && path == dir {
				return filepath.SkipAll
			}
			return nil
		}
		if d.IsDir() {
			if path != dir && strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".md") {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		if strings.Count(rel, string(filepath.Separator)) > 1 {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		out = append(out, FileInfo{Name: filepath.ToSlash(rel), Size: info.Size(), Modified: info.ModTime().UTC().Format(time.RFC3339)})
		return nil
	})
	if err != nil && !errors.Is(err, filepath.SkipAll) {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	if out == nil {
		out = []FileInfo{}
	}
	return out, nil
}

// Read returns a file's content. Missing file → os.ErrNotExist.
func Read(dir, name string) (string, error) {
	p, err := SafePath(dir, name)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Write replaces a file (creating the dir). Keeps one .bak of the previous
// version next to it so an accidental overwrite is recoverable.
func Write(dir, name, content string) (backup string, err error) {
	p, err := SafePath(dir, name)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", err
	}
	if old, rerr := os.ReadFile(p); rerr == nil {
		backup = p + ".bak"
		_ = os.WriteFile(backup, old, 0o644)
	}
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	if backup != "" {
		backup = filepath.Base(backup)
	}
	return backup, os.WriteFile(p, []byte(content), 0o644)
}

// Append adds one entry (a "## heading" block) to the end of a file, creating
// it when absent. A blank line always separates entries.
func Append(dir, name, entry string) error {
	p, err := SafePath(dir, name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	entry = strings.TrimRight(entry, "\n") + "\n"
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if st, serr := f.Stat(); serr == nil && st.Size() > 0 {
		entry = "\n" + entry
	}
	_, err = f.WriteString(entry)
	return err
}

// ── Knowledge boundary validator ────────────────────────────────────────────

// Entry builds the canonical entry block:
//
//	## <title>
//	as_of: YYYY-MM-DD · source: <src> · review_by: YYYY-MM-DD
//	<body>
//
// reviewBy defaults to as_of + 90 days.
func Entry(title, asOf, source, reviewBy, body string) string {
	if reviewBy == "" {
		if t, err := time.Parse("2006-01-02", asOf); err == nil {
			reviewBy = t.AddDate(0, 0, 90).Format("2006-01-02")
		}
	}
	var sb strings.Builder
	sb.WriteString("## " + strings.TrimSpace(title) + "\n")
	sb.WriteString("as_of: " + asOf + " · source: " + strings.TrimSpace(source))
	if reviewBy != "" {
		sb.WriteString(" · review_by: " + reviewBy)
	}
	sb.WriteString("\n" + strings.TrimSpace(body) + "\n")
	return sb.String()
}

var (
	asOfRe   = regexp.MustCompile(`(?m)^\s*as_of:\s*\d{4}-\d{2}-\d{2}`)
	sourceRe = regexp.MustCompile(`(?mi)(^|·|\|)\s*source:\s*\S`)
	// Money / payment-state / ledger-like content that belongs in the app.
	moneyRes = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bRM\s?\d`),
		regexp.MustCompile(`(?i)\bdeposit\b`),
		regexp.MustCompile(`(?i)\b(paid|unpaid|bayar|sudah bayar|belum bayar|tunggakan|arrears|baki)\b`),
		regexp.MustCompile(`(?i)\b(16|112|114|151|172|175)r\d+\b.*\d{3,}`),
		regexp.MustCompile(`押金|已付|未付|欠租|租金\s*\d`),
	}
)

// ValidationError explains why a write was rejected (HTTP 422).
type ValidationError struct {
	Code   string `json:"code"`   // "missing_as_of" | "missing_source" | "belongs_in_app"
	Reason string `json:"reason"` // human text
	Match  string `json:"match,omitempty"`
}

func (e *ValidationError) Error() string { return e.Reason }

// Validate enforces the Senai KB contract on content about to be written:
// every entry carries as_of + source, and nothing that looks like money,
// deposits or payment status is present ("belongs in senai.wenjyue.com").
func Validate(content string) error {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	if !asOfRe.MatchString(content) {
		return &ValidationError{Code: "missing_as_of", Reason: "every entry needs a line 'as_of: YYYY-MM-DD · source: <who/where>'"}
	}
	if !sourceRe.MatchString(content) {
		return &ValidationError{Code: "missing_source", Reason: "every entry needs 'source: <who/where>' on its as_of line"}
	}
	for _, re := range moneyRes {
		if m := re.FindString(content); m != "" {
			return &ValidationError{
				Code:   "belongs_in_app",
				Reason: fmt.Sprintf("belongs in senai.wenjyue.com (money / deposit / payment state / room ledger): %q", m),
				Match:  m,
			}
		}
	}
	return nil
}

// Stale lists entries whose review_by is before today or whose as_of is older
// than maxAge. Used by the daily brief's "KB 待审" section.
type StaleEntry struct {
	File     string `json:"file"`
	Title    string `json:"title"`
	AsOf     string `json:"as_of"`
	ReviewBy string `json:"review_by"`
	Why      string `json:"why"`
}

var (
	headRe     = regexp.MustCompile(`(?m)^##\s+(.+)$`)
	asOfValRe  = regexp.MustCompile(`as_of:\s*(\d{4}-\d{2}-\d{2})`)
	reviewByRe = regexp.MustCompile(`review_by:\s*(\d{4}-\d{2}-\d{2})`)
)

// Stale scans every file in dir.
func Stale(dir string, today time.Time, maxAge time.Duration) ([]StaleEntry, error) {
	files, err := List(dir)
	if err != nil {
		return nil, err
	}
	var out []StaleEntry
	for _, f := range files {
		content, rerr := Read(dir, f.Name)
		if rerr != nil {
			continue
		}
		locs := headRe.FindAllStringSubmatchIndex(content, -1)
		for i, loc := range locs {
			end := len(content)
			if i+1 < len(locs) {
				end = locs[i+1][0]
			}
			block := content[loc[0]:end]
			title := strings.TrimSpace(content[loc[2]:loc[3]])
			asOf, reviewBy := "", ""
			if m := asOfValRe.FindStringSubmatch(block); m != nil {
				asOf = m[1]
			}
			if m := reviewByRe.FindStringSubmatch(block); m != nil {
				reviewBy = m[1]
			}
			why := ""
			if reviewBy != "" {
				if t, perr := time.Parse("2006-01-02", reviewBy); perr == nil && t.Before(today) {
					why = "review_by passed"
				}
			}
			if why == "" && asOf != "" {
				if t, perr := time.Parse("2006-01-02", asOf); perr == nil && today.Sub(t) > maxAge {
					why = "as_of older than " + fmt.Sprintf("%d days", int(maxAge.Hours()/24))
				}
			}
			if why == "" && asOf == "" {
				why = "no as_of"
			}
			if why != "" {
				out = append(out, StaleEntry{File: f.Name, Title: title, AsOf: asOf, ReviewBy: reviewBy, Why: why})
			}
		}
	}
	if out == nil {
		out = []StaleEntry{}
	}
	return out, nil
}
