// Package workflow is the Go port of the node-graph workflow engine
// (assistant/workflow-executor-node.ts + workflows.json). A workflow is a graph
// of typed nodes (message / whatsapp_send / wait_reply / condition / pelangi_api)
// with {{...}} interpolation. State (current node + collected data) is persisted in
// the conversation's workflow_state_json so a multi-turn flow survives restarts.
//
// PMS-dependent steps (pelangi_api nodes, and the dateConflict/dbAvailabilityCheck
// condition operators) are not guessed by the core — they escalate to staff with
// the collected data, which is safer than fabricating availability.
package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Node is one workflow node. Config/Next are decoded per-type at execution time.
type Node struct {
	ID      string                     `json:"id"`
	Type    string                     `json:"type"`
	Label   string                     `json:"label"`
	Config  map[string]json.RawMessage `json:"config"`
	Next    json.RawMessage            `json:"next"`    // string | {success,error} | {trueNext,falseNext}
	Outputs map[string]string          `json:"outputs"` // pelangi_api: outputName -> dataKey
}

// PMS is the digiman/PMS dispatcher backing pelangi_api nodes. Do returns
// ok=false for unimplemented actions (the executor then escalates to staff).
type PMS interface {
	Do(ctx context.Context, action string, params map[string]string) (outputs map[string]string, ok bool, err error)
}

// Workflow is a node graph.
type Workflow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ProfileID   string `json:"profileId"`
	StartNodeID string `json:"startNodeId"`
	Nodes       []Node `json:"nodes"`
	byID        map[string]*Node
}

func (w *Workflow) node(id string) *Node { return w.byID[id] }

// Registry holds all workflows by id.
type Registry struct {
	byID map[string]*Workflow
}

// Load reads workflows.json from the data dir.
func Load(dataDir string) (*Registry, error) {
	b, err := os.ReadFile(filepath.Join(dataDir, "workflows.json"))
	if err != nil {
		return nil, err
	}
	return LoadBytes(b)
}

// LoadBytes parses a workflows.json document from bytes.
func LoadBytes(b []byte) (*Registry, error) {
	var doc struct {
		Workflows []*Workflow `json:"workflows"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("parse workflows.json: %w", err)
	}
	r := &Registry{byID: map[string]*Workflow{}}
	for _, wf := range doc.Workflows {
		wf.byID = map[string]*Node{}
		for i := range wf.Nodes {
			wf.byID[wf.Nodes[i].ID] = &wf.Nodes[i]
		}
		r.byID[wf.ID] = wf
	}
	return r, nil
}

// Get returns a workflow by id (nil if absent).
func (r *Registry) Get(id string) *Workflow { return r.byID[id] }

// State is the persisted per-conversation workflow execution state.
type State struct {
	WorkflowID string            `json:"workflowId"`
	NodeID     string            `json:"nodeId"` // current wait_reply when Awaiting
	Data       map[string]string `json:"data"`
	Awaiting   bool              `json:"awaiting"`
}

// RunContext carries the per-execution dependencies.
type RunContext struct {
	GuestPhone string
	GuestName  string
	Lang       string
	InstanceID string
	AdminPhone string
	// Send delivers a message to a phone (guest or staff).
	Send func(ctx context.Context, phone, text, instanceID string) error
	// PMS backs pelangi_api nodes (nil = always escalate PMS steps).
	PMS PMS
}

// Outcome reports how a Run ended.
type Outcome struct {
	Paused    bool // waiting for the guest's next reply
	Done      bool // workflow finished
	Escalated bool // handed off to staff (PMS step or error)
}

const maxSteps = 50

// Start begins a workflow, returning the (possibly paused) state + outcome.
func (r *Registry) Start(ctx context.Context, workflowID string, rc RunContext) (*State, Outcome, error) {
	wf := r.Get(workflowID)
	if wf == nil {
		return nil, Outcome{}, fmt.Errorf("unknown workflow %q", workflowID)
	}
	st := &State{WorkflowID: workflowID, Data: map[string]string{}}
	out, err := r.run(ctx, wf, st, wf.StartNodeID, rc)
	return st, out, err
}

// Resume continues a paused workflow with the guest's reply.
func (r *Registry) Resume(ctx context.Context, st *State, reply string, rc RunContext) (Outcome, error) {
	wf := r.Get(st.WorkflowID)
	if wf == nil {
		return Outcome{}, fmt.Errorf("unknown workflow %q", st.WorkflowID)
	}
	cur := wf.node(st.NodeID)
	if cur == nil || cur.Type != "wait_reply" {
		return Outcome{}, fmt.Errorf("resume: node %q is not a wait_reply", st.NodeID)
	}
	if st.Data == nil {
		st.Data = map[string]string{}
	}
	if storeAs := decodeString(cur.Config["storeAs"]); storeAs != "" {
		st.Data[storeAs] = strings.TrimSpace(reply)
	}
	st.Awaiting = false
	next := decodeStringNext(cur.Next)
	return r.run(ctx, wf, st, next, rc)
}

// run executes nodes starting at startID until a wait_reply (pause), terminal
// (done), or an escalation.
func (r *Registry) run(ctx context.Context, wf *Workflow, st *State, startID string, rc RunContext) (Outcome, error) {
	cur := startID
	for steps := 0; steps < maxSteps; steps++ {
		if cur == "" {
			return Outcome{Done: true}, nil
		}
		node := wf.node(cur)
		if node == nil {
			return Outcome{Done: true}, fmt.Errorf("node %q not found", cur)
		}
		switch node.Type {
		case "message":
			msg := r.interp(decodeLangMap(node.Config["message"], rc.Lang), st, rc)
			if msg != "" {
				_ = rc.Send(ctx, rc.GuestPhone, msg, rc.InstanceID)
			}
			cur = decodeStringNext(node.Next)

		case "whatsapp_send":
			receiver := r.interp(decodeString(node.Config["receiver"]), st, rc)
			content := r.interp(decodeLangMap(node.Config["content"], rc.Lang), st, rc)
			if receiver != "" && content != "" {
				_ = rc.Send(ctx, normalizePhone(receiver), content, rc.InstanceID)
			}
			cur = decodeStringNext(node.Next)

		case "wait_reply":
			prompt := r.interp(decodeLangMap(node.Config["prompt"], rc.Lang), st, rc)
			if prompt != "" {
				_ = rc.Send(ctx, rc.GuestPhone, prompt, rc.InstanceID)
			}
			st.NodeID = cur
			st.Awaiting = true
			return Outcome{Paused: true}, nil

		case "condition":
			res, escalate := r.evalCondition(node, st, rc)
			if escalate {
				return r.escalate(ctx, st, rc), nil
			}
			tn, fn := decodeBranch(node.Config)
			if res {
				cur = tn
			} else {
				cur = fn
			}

		case "pelangi_api":
			if rc.PMS == nil {
				return r.escalate(ctx, st, rc), nil
			}
			action := decodeString(node.Config["action"])
			params := r.interpParams(node.Config["params"], st, rc)
			outputs, ok, err := rc.PMS.Do(ctx, action, params)
			succ, errNext := decodeSuccessError(node.Next)
			if succ == "" && errNext == "" {
				// Bare-string `next` (e.g. sr_log_request → sr_confirm_msg): an
				// implemented action whose node uses a plain string still advances.
				succ = decodeStringNext(node.Next)
			}
			if err != nil {
				if errNext != "" {
					cur = errNext
					continue
				}
				return r.escalate(ctx, st, rc), nil
			}
			if !ok {
				// Unimplemented PMS action — escalate (safer than Node's no-op).
				return r.escalate(ctx, st, rc), nil
			}
			for k, v := range outputs {
				st.Data[k] = v
			}
			for outName, dataKey := range node.Outputs {
				if v, ok := outputs[dataKey]; ok {
					st.Data[outName] = v
				}
			}
			cur = succ

		default:
			cur = decodeStringNext(node.Next)
		}
	}
	return Outcome{Done: true}, fmt.Errorf("workflow %q exceeded %d steps", wf.ID, maxSteps)
}

// escalate hands the conversation to staff with the collected workflow data.
func (r *Registry) escalate(ctx context.Context, st *State, rc RunContext) Outcome {
	name := rc.GuestName
	if name == "" {
		name = "Guest"
	}
	var b strings.Builder
	b.WriteString("🔔 *Booking/Workflow needs staff*\n")
	b.WriteString("Guest: " + name + " (" + rc.GuestPhone + ")\n")
	b.WriteString("Workflow: " + st.WorkflowID + "\n")
	if len(st.Data) > 0 {
		b.WriteString("Collected:\n")
		for k, v := range st.Data {
			b.WriteString("  • " + k + ": " + v + "\n")
		}
	}
	b.WriteString("\nPlease continue with the guest in the PMS.")
	if rc.AdminPhone != "" {
		_ = rc.Send(ctx, normalizePhone(rc.AdminPhone), b.String(), rc.InstanceID)
	}
	// Guest acknowledgement.
	ack := map[string]string{
		"en": "Thank you! Our staff will confirm the details and get back to you shortly. 🙏",
		"ms": "Terima kasih! Staf kami akan sahkan butiran dan hubungi anda sebentar lagi. 🙏",
		"zh": "谢谢！我们的工作人员会确认详情并尽快回复您。🙏",
	}
	msg := ack[rc.Lang]
	if msg == "" {
		msg = ack["en"]
	}
	_ = rc.Send(ctx, rc.GuestPhone, msg, rc.InstanceID)
	return Outcome{Escalated: true, Done: true}
}

// evalCondition returns (result, escalate). PMS-backed operators escalate.
func (r *Registry) evalCondition(node *Node, st *State, rc RunContext) (bool, bool) {
	field := r.interp(decodeString(node.Config["field"]), st, rc)
	op := decodeString(node.Config["operator"])
	value := decodeString(node.Config["value"])
	switch op {
	case "regex":
		re, err := regexp.Compile("(?i)" + value)
		if err != nil {
			return false, false
		}
		return re.MatchString(field), false
	case "eq":
		return strings.EqualFold(strings.TrimSpace(field), strings.TrimSpace(value)), false
	case "neq":
		return !strings.EqualFold(strings.TrimSpace(field), strings.TrimSpace(value)), false
	case "exists":
		return strings.TrimSpace(field) != "", false
	case "empty":
		return strings.TrimSpace(field) == "", false
	case "gt", "lt":
		fa, _ := strconv.ParseFloat(strings.TrimSpace(field), 64)
		fb, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if op == "lt" {
			return fa < fb, false
		}
		return fa > fb, false
	case "pastDateCheck":
		// Branch semantics from workflows.json: trueNext = dates OK (continue
		// booking), falseNext = reject as past. Same-day check-in is valid —
		// most guests message "tonight". The field is the guest's raw reply
		// ("Check-in: 8 Jul, Check-out: 9 Jul"), so extract the first date
		// (check-in) rather than parsing the whole string.
		if t, ok := firstDateIn(field); ok {
			today := time.Now().Truncate(24 * time.Hour)
			return !t.Before(today), false
		}
		return true, false // unparseable → continue; PMS/staff steps catch bad dates
	case "dateConflict", "dbAvailabilityCheck":
		return false, true // needs PMS → escalate
	default:
		return false, false
	}
}

// ─── interpolation ───────────────────────────────────────────────────────────

var interpRe = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

func (r *Registry) interp(s string, st *State, rc RunContext) string {
	if s == "" {
		return s
	}
	return interpRe.ReplaceAllStringFunc(s, func(m string) string {
		key := interpRe.FindStringSubmatch(m)[1]
		switch {
		case strings.HasPrefix(key, "workflow.data."):
			return st.Data[strings.TrimPrefix(key, "workflow.data.")]
		case key == "guest.name":
			return rc.GuestName
		case key == "guest.phone":
			return rc.GuestPhone
		case key == "system.admin_phone":
			return rc.AdminPhone
		default:
			return ""
		}
	})
}

// ─── decode helpers ──────────────────────────────────────────────────────────

func decodeString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

func decodeLangMap(raw json.RawMessage, lang string) string {
	if len(raw) == 0 {
		return ""
	}
	// May be a bare string or a {en,ms,zh,ta} map.
	if s := decodeString(raw); s != "" {
		return s
	}
	var m map[string]string
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if v, ok := m[lang]; ok && v != "" {
		return v
	}
	if v, ok := m["en"]; ok {
		return v
	}
	for _, v := range m {
		return v
	}
	return ""
}

// decodeStringNext decodes a node's `next` when it's a plain string.
func decodeStringNext(raw json.RawMessage) string { return decodeString(raw) }

// decodeSuccessError reads {success,error} from a pelangi_api node's `next`.
func decodeSuccessError(raw json.RawMessage) (success, errNext string) {
	if len(raw) == 0 {
		return "", ""
	}
	var m struct {
		Success string `json:"success"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(raw, &m) == nil {
		return m.Success, m.Error
	}
	return "", ""
}

// interpParams interpolates a pelangi_api node's params map.
func (r *Registry) interpParams(raw json.RawMessage, st *State, rc RunContext) map[string]string {
	out := map[string]string{}
	if len(raw) == 0 {
		return out
	}
	var m map[string]string
	if json.Unmarshal(raw, &m) != nil {
		return out
	}
	for k, v := range m {
		out[k] = r.interp(v, st, rc)
	}
	return out
}

// decodeBranch reads trueNext/falseNext from a condition node's config.
func decodeBranch(cfg map[string]json.RawMessage) (trueNext, falseNext string) {
	return decodeString(cfg["trueNext"]), decodeString(cfg["falseNext"])
}

func normalizePhone(p string) string {
	p = strings.TrimSpace(p)
	if p == "" || strings.Contains(p, "@") {
		return p
	}
	return p // engine's sender adds the @s.whatsapp.net suffix
}

// dateTokenRe finds date-like tokens inside free text: "8 Jul", "15 Feb 2026",
// "15/2/2026", "15/2", "2026-07-08".
var dateTokenRe = regexp.MustCompile(`(?i)\b(\d{1,2}\s?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s?\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?\d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b`)

// monthWordRe truncates long month words ("february" → "feb") so the loose
// layouts can parse them.
var monthWordRe = regexp.MustCompile(`(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]+`)

// firstDateIn extracts the first date-like token from free text ("Check-in:
// 8 Jul, Check-out: 9 Jul" → 8 Jul of the current year) and parses it.
func firstDateIn(s string) (time.Time, bool) {
	tok := dateTokenRe.FindString(s)
	if tok == "" {
		return time.Time{}, false
	}
	tok = monthWordRe.ReplaceAllStringFunc(tok, func(m string) string { return m[:3] })
	return parseLooseDate(tok)
}

// looseMonthRe title-cases a 3-letter month so Go's "Jan" layout matches.
var looseMonthRe = regexp.MustCompile(`\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b`)

// parseLooseDate parses common "15 Feb" / "15/2/2026" forms; ok=false if unknown.
func parseLooseDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(strings.ToLower(s))
	// Go layouts use the reference month "Jan" — title-case the month token.
	s = looseMonthRe.ReplaceAllStringFunc(s, func(m string) string {
		return strings.ToUpper(m[:1]) + m[1:]
	})
	layouts := []string{"2 Jan", "2 Jan 2006", "2Jan", "02/01/2006", "2/1/2006", "2/1", "02-01-2006", "2006-01-02", "Jan 2"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			if t.Year() == 0 {
				t = t.AddDate(time.Now().Year(), 0, 0)
				// No explicit year and the date passed more than a week ago →
				// the guest means the next occurrence ("15 Feb" said in July).
				// A date within the last few days stays past (likely a typo,
				// let the workflow re-prompt).
				if t.Before(time.Now().AddDate(0, 0, -7)) {
					t = t.AddDate(1, 0, 0)
				}
			}
			return t, true
		}
	}
	return time.Time{}, false
}
