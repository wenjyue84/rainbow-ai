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
	AdminPhone  string
	MayaPhone   string
	AlstonPhone string
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
	reply = strings.TrimSpace(reply)
	storeAs := decodeString(cur.Config["storeAs"])
	st.Awaiting = false

	// Typed slot classifier (booking flow, FIX 1): route the guest's reply to the
	// slot it matches by PATTERN, not by turn order, then prompt for whatever is
	// still missing. Scoped to the booking flow so single-slot flows (checkin_full
	// → guest_name, service_request_handler → request_details) keep turn-order.
	if isBookingSlotFlow(st.WorkflowID) {
		return r.resumeBooking(ctx, wf, st, cur, reply, storeAs, rc)
	}

	if storeAs != "" {
		st.Data[storeAs] = normalizeSlot(storeAs, reply)
	}
	next := decodeStringNext(cur.Next)
	return r.run(ctx, wf, st, next, rc)
}

// run executes nodes starting at startID until a wait_reply (pause), terminal
// (done), or an escalation.
func (r *Registry) run(ctx context.Context, wf *Workflow, st *State, startID string, rc RunContext) (Outcome, error) {
	if rc.Send == nil {
		rc.Send = func(_ context.Context, _, _, _ string) error { return nil }
	}
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
			// Booking flow: if the slot this node fills was already captured by an
			// out-of-order answer, don't re-prompt — skip to the next node so the
			// guest is only asked for what's still missing.
			if isBookingSlotFlow(st.WorkflowID) {
				if slot := decodeString(node.Config["storeAs"]); slot != "" && strings.TrimSpace(st.Data[slot]) != "" {
					cur = decodeStringNext(node.Next)
					continue
				}
			}
			prompt := r.interp(decodeLangMap(node.Config["prompt"], rc.Lang), st, rc)
			if prompt != "" {
				_ = rc.Send(ctx, rc.GuestPhone, prompt, rc.InstanceID)
			}
			st.NodeID = cur
			st.Awaiting = true
			return Outcome{Paused: true}, nil

		case "condition":
			res, escalate := r.evalCondition(ctx, node, st, rc)
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
	b.WriteString("Guest: " + guestContactLine(rc.GuestPhone, name) + "\n")
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

// evalCondition returns (result, escalate). PMS-backed operators query the PMS
// dispatcher when available and only escalate when it is missing or errors.
func (r *Registry) evalCondition(ctx context.Context, node *Node, st *State, rc RunContext) (bool, bool) {
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
			// Compare calendar days in local time — Truncate(24h) works on the
			// UTC timeline and marks "yesterday" as today between 00:00 and
			// 08:00 MYT.
			now := time.Now()
			today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			return !t.Before(today), false
		}
		return true, false // unparseable → continue; PMS/staff steps catch bad dates
	case "dateConflict", "dbAvailabilityCheck":
		// Branch semantics (workflows.json): trueNext = dates OK / units
		// available (continue booking), falseNext = conflict / fully booked.
		// A capsule hostel has interchangeable units, so "any unit free" is
		// the availability signal for both operators.
		if rc.PMS == nil {
			return false, true // no PMS wired → escalate (old behavior)
		}
		outputs, ok, err := rc.PMS.Do(ctx, "check_availability", nil)
		if err != nil || !ok {
			return false, true // PMS unreachable/unimplemented → escalate
		}
		n, convErr := strconv.Atoi(strings.TrimSpace(outputs["available_count"]))
		if convErr != nil {
			return outputs["available"] == "true", false
		}
		return n > 0, false
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
		case strings.HasPrefix(key, "pelangi."):
			// pelangi_api node outputs (find_reservation etc.) are stored in
			// st.Data by their raw output key (workflow.go:223-224). Templates
			// reference them as {{pelangi.<key>}} — resolve from the same map.
			return st.Data[strings.TrimPrefix(key, "pelangi.")]
		case key == "guest.name":
			return rc.GuestName
		case key == "guest.phone":
			return rc.GuestPhone
		case key == "guest.phone_number":
			p := rc.GuestPhone
			if at := strings.Index(p, "@"); at > 0 {
				return p[:at]
			}
			return p
		case key == "guest.phone_display":
			// Returns a human-readable contact string.
			// WhatsApp privacy LIDs end in "@lid" — they are not dialable numbers.
			// In that case emit a fixed advisory so admin notifications never show
			// raw "@lid" values or unrendered ternary template syntax.
			p := rc.GuestPhone
			if strings.HasSuffix(p, "@lid") {
				return "(WhatsApp privacy ID — reply via admin panel)"
			}
			if at := strings.Index(p, "@"); at > 0 {
				return p[:at]
			}
			return p
		case key == "system.admin_phone":
			return rc.AdminPhone
		case key == "system.maya_phone":
			return rc.MayaPhone
		case key == "system.alston_phone":
			return rc.AlstonPhone
		default:
			return ""
		}
	})
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

// guestContactLine converts a Baileys JID to a human-readable staff notification line.
func guestContactLine(jid, name string) string {
	if at := strings.Index(jid, "@"); at > 0 {
		host := jid[at+1:]
		num := jid[:at]
		if host == "s.whatsapp.net" && len(num) >= 8 {
			return name + " — +" + num
		}
	}
	return name + " (reply in this WhatsApp chat)"
}
