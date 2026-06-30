package classify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// TestFastTierAccuracy measures the Go classifier against the ground-truth
// intent-examples.json (the same labeled data the Node app ships). T4 (LLM) is
// unavailable offline, so this measures the FAST-TIER (T1 regex + T2 fuzzy)
// coverage: precision among matched examples and overall recall. It's a
// regression baseline — divergence here flags a classifier port bug.
func TestFastTierAccuracy(t *testing.T) {
	p := loadPelangi(t)
	c := New(p, nil) // no LLM → fast tiers only

	raw, err := os.ReadFile(filepath.Join(dataDir(), "intent-examples.json"))
	if err != nil {
		t.Skipf("no intent-examples.json: %v", err)
	}
	var doc struct {
		Intents []struct {
			Intent   string              `json:"intent"`
			Examples map[string][]string `json:"examples"`
		} `json:"intents"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse: %v", err)
	}

	// Legacy alias normalization: intent-examples.json uses older category names
	// for some intents than routing/keywords. Canonicalize both sides so naming
	// drift isn't counted as a classifier error.
	canon := func(s string) string {
		switch s {
		case "payment":
			return "payment_info"
		case "facilities":
			return "facilities_info"
		case "rules":
			return "rules_policy"
		case "theft":
			return "theft_report"
		case "complaint":
			return "general_complaint_in_stay"
		case "unit_conflict":
			return "capsule_conflict"
		}
		return s
	}

	var total, matched, correct int
	perIntentTotal := map[string]int{}
	perIntentCorrect := map[string]int{}
	type miss struct{ text, label, got, src string }
	var misses []miss

	for _, it := range doc.Intents {
		for _, exs := range it.Examples {
			for _, ex := range exs {
				total++
				perIntentTotal[it.Intent]++
				r := c.Classify(context.Background(), ex, nil)
				if r.Category == "unknown" {
					continue // would route to T4 LLM in production
				}
				matched++
				if canon(r.Category) == canon(it.Intent) {
					correct++
					perIntentCorrect[it.Intent]++
				} else if len(misses) < 60 {
					misses = append(misses, miss{ex, it.Intent, r.Category, string(r.Source)})
				}
			}
		}
	}

	recall := float64(matched) / float64(total)
	precision := 0.0
	if matched > 0 {
		precision = float64(correct) / float64(matched)
	}
	t.Logf("examples=%d  fast-tier matched=%d (recall=%.1f%%)  correct=%d (precision among matched=%.1f%%)",
		total, matched, recall*100, correct, precision*100)

	// Per-intent breakdown (sorted).
	intents := make([]string, 0, len(perIntentTotal))
	for i := range perIntentTotal {
		intents = append(intents, i)
	}
	sort.Strings(intents)
	for _, i := range intents {
		t.Logf("  %-28s %d/%d correct", i, perIntentCorrect[i], perIntentTotal[i])
	}
	if len(misses) > 0 {
		t.Logf("sample misclassifications (label → got [src]):")
		for _, m := range misses {
			t.Logf("  %-40q %s → %s [%s]", m.text, m.label, m.got, m.src)
		}
	}

	// Regression gates (fast-tier ONLY — T4 LLM resolves the ambiguous tail in
	// production, e.g. checkin_info vs check_in_arrival). These are baselines to
	// catch a port regression, not a quality bar. Tune DOWN only with evidence.
	if precision < 0.74 {
		t.Errorf("fast-tier precision %.1f%% below baseline 74%% — classifier port likely diverged", precision*100)
	}
	if recall < 0.55 {
		t.Errorf("fast-tier recall %.1f%% below baseline 55%% — keyword/regex coverage regressed", recall*100)
	}
}
