// Go-native check suites backing the Testing tab (POST /tests/run {project} and
// POST /testing/run-all). The Node app spawned vitest; go-core runs equivalent
// config/consistency/classification checks in-process and reports them in the
// vitest JSON shape the SPA renders (numTotalTests, testFiles[].tests[]…).
package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"rainbow-core/internal/classify"
)

// ClassifyFunc runs the in-process tiered classifier (injected from main so the
// semantic suite exercises the SAME engine that serves guests).
type ClassifyFunc func(ctx context.Context, text string) classify.Result

// SetClassify supplies the classifier for the semantic check suite.
func (h *Handler) SetClassify(f ClassifyFunc) { h.classify = f }

type checkTest struct {
	Name            string   `json:"name"`
	Status          string   `json:"status"` // passed | failed | skipped
	Duration        int64    `json:"duration"`
	FailureMessages []string `json:"failureMessages"`
}

type checkFile struct {
	File     string      `json:"file"`
	Status   string      `json:"status"`
	Tests    []checkTest `json:"tests"`
	Duration int64       `json:"duration"`
}

// finishFile computes the file status from its tests.
func finishFile(f *checkFile) {
	f.Status = "passed"
	for _, t := range f.Tests {
		f.Duration += t.Duration
		if t.Status == "failed" {
			f.Status = "failed"
		}
	}
}

// suiteResult maps check files into the vitest JSON shape the SPA expects.
func suiteResult(project string, start time.Time, files []checkFile) map[string]any {
	total, passed, failed, pending := 0, 0, 0, 0
	for _, f := range files {
		for _, t := range f.Tests {
			total++
			switch t.Status {
			case "passed":
				passed++
			case "failed":
				failed++
			default:
				pending++
			}
		}
	}
	return map[string]any{
		"numTotalTests":   total,
		"numPassedTests":  passed,
		"numFailedTests":  failed,
		"numPendingTests": pending,
		"success":         failed == 0,
		"startTime":       start.UnixMilli(),
		"duration":        time.Since(start).Milliseconds(),
		"testFiles":       files,
		"project":         project,
	}
}

// pass/fail helpers.
func passT(name string, d time.Duration) checkTest {
	return checkTest{Name: name, Status: "passed", Duration: d.Milliseconds(), FailureMessages: []string{}}
}
func failT(name, msg string, d time.Duration) checkTest {
	return checkTest{Name: name, Status: "failed", Duration: d.Milliseconds(), FailureMessages: []string{msg}}
}

// ── unit suite: every config JSON parses ────────────────────────────────────

var unitFiles = []struct {
	Name     string
	Required bool
}{
	{"intents.json", true},
	{"intent-keywords.json", true},
	{"knowledge.json", true},
	{"routing.json", true},
	{"settings.json", true},
	{"workflows.json", true},
	{"templates.json", false},
	{"workflow.json", false},
	{"intent-tiers.json", false},
	{"llm-settings.json", false},
	{"intent-examples.json", false},
}

func (h *Handler) runUnitSuite(r *http.Request) []checkFile {
	f := checkFile{File: "config/parse.check.go", Tests: []checkTest{}}
	for _, uf := range unitFiles {
		t0 := time.Now()
		var v any
		ok := h.readDataJSONReq(r, uf.Name, &v)
		name := "parse " + uf.Name
		switch {
		case ok:
			f.Tests = append(f.Tests, passT(name, time.Since(t0)))
		case !uf.Required:
			f.Tests = append(f.Tests, passT(name+" (absent, optional)", time.Since(t0)))
		default:
			f.Tests = append(f.Tests, failT(name, uf.Name+" missing or invalid JSON", time.Since(t0)))
		}
	}
	finishFile(&f)
	return []checkFile{f}
}

// ── integration suite: cross-file reference consistency ─────────────────────

func (h *Handler) runIntegrationSuite(r *http.Request) []checkFile {
	f := checkFile{File: "config/references.check.go", Tests: []checkTest{}}

	var routing map[string]struct {
		Action     string `json:"action"`
		WorkflowID string `json:"workflow_id"`
	}
	h.readDataJSONReq(r, "routing.json", &routing)

	var wfs struct {
		Workflows []struct {
			ID          string `json:"id"`
			StartNodeID string `json:"startNodeId"`
			Nodes       []struct {
				ID   string          `json:"id"`
				Type string          `json:"type"`
				Next json.RawMessage `json:"next"`
			} `json:"nodes"`
		} `json:"workflows"`
	}
	h.readDataJSONReq(r, "workflows.json", &wfs)
	wfIDs := map[string]bool{}
	for _, wf := range wfs.Workflows {
		wfIDs[wf.ID] = true
	}

	// 1. routing workflow_id references exist.
	t0 := time.Now()
	var missing []string
	for intent, rt := range routing {
		if rt.WorkflowID != "" && !wfIDs[rt.WorkflowID] {
			missing = append(missing, intent+"→"+rt.WorkflowID)
		}
	}
	if len(missing) == 0 {
		f.Tests = append(f.Tests, passT("routing workflow_id references exist", time.Since(t0)))
	} else {
		f.Tests = append(f.Tests, failT("routing workflow_id references exist",
			"unknown workflows: "+strings.Join(missing, ", "), time.Since(t0)))
	}

	// 2. keyword intents are routed (known to the router).
	t0 = time.Now()
	var kw struct {
		Intents []struct {
			Intent string `json:"intent"`
		} `json:"intents"`
	}
	h.readDataJSONReq(r, "intent-keywords.json", &kw)
	var unrouted []string
	for _, it := range kw.Intents {
		if it.Intent != "" && routing != nil {
			if _, ok := routing[it.Intent]; !ok {
				unrouted = append(unrouted, it.Intent)
			}
		}
	}
	// Unrouted keyword intents are not an error — RouteFor defaults to llm_reply,
	// and cross-profile intents (MENU_*) are whitelist-filtered at runtime. Pass,
	// but surface the list so config drift stays visible.
	name2 := "keyword intents resolve (routing or llm_reply fallback)"
	if len(unrouted) > 0 {
		name2 += " — unrouted: " + strings.Join(unrouted, ", ")
	}
	f.Tests = append(f.Tests, passT(name2, time.Since(t0)))

	// 3. workflow node graphs have no dangling next targets.
	t0 = time.Now()
	var dangling []string
	for _, wf := range wfs.Workflows {
		nodeIDs := map[string]bool{}
		for _, n := range wf.Nodes {
			nodeIDs[n.ID] = true
		}
		if wf.StartNodeID != "" && !nodeIDs[wf.StartNodeID] {
			dangling = append(dangling, wf.ID+".start→"+wf.StartNodeID)
		}
		for _, n := range wf.Nodes {
			for _, target := range nextTargets(n.Next) {
				if target != "" && !nodeIDs[target] {
					dangling = append(dangling, wf.ID+"."+n.ID+"→"+target)
				}
			}
		}
	}
	if len(dangling) == 0 {
		f.Tests = append(f.Tests, passT("workflow next targets exist", time.Since(t0)))
	} else {
		f.Tests = append(f.Tests, failT("workflow next targets exist",
			"dangling targets: "+strings.Join(dangling, ", "), time.Since(t0)))
	}

	finishFile(&f)
	return []checkFile{f}
}

// nextTargets decodes a workflow node's next field (string | {success,error} |
// {trueNext,falseNext}) into the referenced node ids.
func nextTargets(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return []string{s}
	}
	var obj struct {
		Success   string `json:"success"`
		Error     string `json:"error"`
		TrueNext  string `json:"trueNext"`
		FalseNext string `json:"falseNext"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		return []string{obj.Success, obj.Error, obj.TrueNext, obj.FalseNext}
	}
	return nil
}

// ── semantic suite: classifier smoke scenarios ──────────────────────────────

// classifyScenario asserts that a guest message classifies into one of the
// accepted intents (multiple accepted where routing has sibling intents).
type classifyScenario struct {
	Name   string
	Text   string
	Accept []string
}

var classifyScenarios = []classifyScenario{
	{"book capsule (en)", "I want to book a capsule for tonight", []string{"booking"}},
	{"cancel booking guard (en)", "I want to cancel my booking", []string{"cancel_booking", "booking_cancellation"}},
	{"wifi password (en)", "what is the wifi password", []string{"wifi", "WIFI_PASSWORD"}},
	{"availability (en)", "do you have a capsule available this friday", []string{"availability"}},
	{"arrival check-in (en)", "I have arrived, please check me in", []string{"check_in_arrival", "checkin_info"}},
	{"checkout now (en)", "I want to check out now", []string{"checkout_now", "checkout_procedure", "checkout_info"}},
	{"pricing (ms)", "berapa harga satu malam", []string{"pricing"}},
	{"directions (zh)", "请问怎么去你们的旅馆", []string{"directions", "location_directions"}},
	{"aircon complaint (en)", "the air conditioning in my capsule is broken", []string{"climate_control_complaint", "facility_malfunction", "general_complaint_in_stay", "complaint"}},
	{"dirty capsule (en)", "my capsule is dirty, please clean it", []string{"cleanliness_complaint", "ROOM_CLEANING", "general_complaint_in_stay"}},
}

func (h *Handler) runSemanticSuite(ctx context.Context) []checkFile {
	f := checkFile{File: "classify/scenarios.check.go", Tests: []checkTest{}}
	if h.classify == nil {
		f.Tests = append(f.Tests, checkTest{
			Name: "classifier wired", Status: "skipped", Duration: 0,
			FailureMessages: []string{},
		})
		finishFile(&f)
		return []checkFile{f}
	}
	for _, sc := range classifyScenarios {
		t0 := time.Now()
		cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		res := h.classify(cctx, sc.Text)
		cancel()
		ok := false
		for _, a := range sc.Accept {
			if res.Category == a {
				ok = true
				break
			}
		}
		if ok {
			f.Tests = append(f.Tests, passT(sc.Name, time.Since(t0)))
		} else {
			f.Tests = append(f.Tests, failT(sc.Name,
				fmt.Sprintf("got intent %q (source=%s conf=%.2f), want one of %v", res.Category, res.Source, res.Confidence, sc.Accept),
				time.Since(t0)))
		}
	}
	finishFile(&f)
	return []checkFile{f}
}

// ── HTTP handlers ───────────────────────────────────────────────────────────

// testsRun serves POST /api/rainbow/tests/run {project: unit|integration|semantic}.
func (h *Handler) testsRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	var in struct {
		Project string `json:"project"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	start := time.Now()
	var files []checkFile
	switch in.Project {
	case "unit":
		files = h.runUnitSuite(r)
	case "integration":
		files = h.runIntegrationSuite(r)
	case "semantic":
		files = h.runSemanticSuite(r.Context())
	default:
		writeJSON(w, 400, map[string]any{"error": "project must be unit|integration|semantic"})
		return
	}
	writeJSON(w, 200, suiteResult(in.Project, start, files))
}

// testingRunAll serves POST /api/rainbow/testing/run-all — aggregates all three
// suites into one vitest-shaped result.
func (h *Handler) testingRunAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	start := time.Now()
	files := h.runUnitSuite(r)
	files = append(files, h.runIntegrationSuite(r)...)
	files = append(files, h.runSemanticSuite(r.Context())...)
	writeJSON(w, 200, suiteResult("all", start, files))
}
