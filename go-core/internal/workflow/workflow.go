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
		st.Data[storeAs] = normalizeSlot(storeAs, strings.TrimSpace(reply))
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

var (
	slotPhoneRe = regexp.MustCompile(`\+?\d[\d \-]{5,}\d`)
	slotIntRe   = regexp.MustCompile(`\d+`)
)

// normalizeSlot cleans slot values guests wrap in sentences before storing
// ("My phone number is 60127088789" → "60127088789"; "1 adult only." → "1").
// Unrecognized values are stored as-is.
func normalizeSlot(storeAs, reply string) string {
	switch {
	case strings.Contains(storeAs, "phone"):
		best := ""
		for _, m := range slotPhoneRe.FindAllString(reply, -1) {
			clean := strings.NewReplacer(" ", "", "-", "").Replace(m)
			if len(clean) > len(best) {
				best = clean
			}
		}
		if len(strings.TrimPrefix(best, "+")) >= 7 {
			return best
		}
	case strings.Contains(storeAs, "count"):
		if m := slotIntRe.FindString(reply); m != "" {
			return m
		}
		words := map[string]string{
			"one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
			"six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
			"satu": "1", "dua": "2", "tiga": "3", "empat": "4", "lima": "5",
		}
		low := strings.ToLower(reply)
		for w, n := range words {
			if strings.Contains(low, w) {
				return n
			}
		}
	case strings.Contains(strings.ToLower(storeAs), "date"):
		// Expand relative words ("today", "tmr", "esok", "the day after
		// tomorrow", 今天/明天/后天) and loose formats into a concrete
		// "2 Jan 2006 to 3 Jan 2006" range, so the workflow's date-format
		// regex, pastDateCheck, and the confirmation message all see real
		// calendar dates instead of re-prompting the guest.
		if in, out, ok := ParseDateRange(reply); ok {
			return in.Format("2 Jan 2006") + " to " + out.Format("2 Jan 2006")
		}
	}
	return reply
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

// relativeDateRe matches relative day phrases guests use instead of calendar
// dates ("today", "tmr", "the day after tomorrow", Malay "esok"/"lusa",
// Chinese 今天/明天/后天). Longest phrases come first so "day after tomorrow"
// wins over the trailing "tomorrow".
var relativeDateRe = regexp.MustCompile(`(?i)the day after tomorrow|day after tomorrow|day after tmr|esok lusa|hari ini|harini|today|tonight|tonite|tomorrow|tomorow|tmrw|tmr|esok|lusa|今天|今日|明天|明日|后天|後天`)

// relativeOffsetDays maps a relative day word to a day offset from today.
func relativeOffsetDays(word string) (int, bool) {
	switch strings.ToLower(strings.TrimSpace(word)) {
	case "today", "tonight", "tonite", "hari ini", "harini", "今天", "今日":
		return 0, true
	case "tomorrow", "tomorow", "tmr", "tmrw", "esok", "明天", "明日":
		return 1, true
	case "the day after tomorrow", "day after tomorrow", "day after tmr", "esok lusa", "lusa", "后天", "後天":
		return 2, true
	}
	return 0, false
}

// relativeDatesIn resolves relative day words in a guest reply to concrete
// local-midnight dates, in order of appearance (up to two). Callers use this
// only when no absolute calendar date is present, so "tonight 25/12" still
// keys off 25/12 rather than tonight.
func relativeDatesIn(s string) []time.Time {
	now := time.Now()
	base := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	var out []time.Time
	for _, loc := range relativeDateRe.FindAllStringIndex(s, -1) {
		if off, ok := relativeOffsetDays(s[loc[0]:loc[1]]); ok {
			out = append(out, base.AddDate(0, 0, off))
			if len(out) == 2 {
				break
			}
		}
	}
	return out
}

// ParseDateRange extracts the first two date-like tokens from free text
// ("Check-in: 25 Jul, Check-out: 26 Jul") as local-midnight times. When only
// one date parses, checkOut defaults to checkIn+1 night. ok=false when no
// date-like token parses at all.
func ParseDateRange(s string) (checkIn, checkOut time.Time, ok bool) {
	var dates []time.Time
	for _, tok := range dateTokenRe.FindAllString(s, -1) {
		tok = monthWordRe.ReplaceAllStringFunc(tok, func(m string) string { return m[:3] })
		if t, okTok := parseLooseDate(tok); okTok {
			dates = append(dates, t)
			if len(dates) == 2 {
				break
			}
		}
	}
	if len(dates) == 0 {
		// No absolute calendar date → fall back to relative words
		// ("today", "tmr", "esok", "the day after tomorrow", 今天/明天/后天).
		dates = relativeDatesIn(s)
	}
	if len(dates) == 0 {
		return time.Time{}, time.Time{}, false
	}
	checkIn = dates[0]
	if len(dates) > 1 && dates[1].After(dates[0]) {
		checkOut = dates[1]
	} else {
		checkOut = checkIn.AddDate(0, 0, 1)
	}
	return checkIn, checkOut, true
}

// firstDateIn extracts the first date-like token from free text ("Check-in:
// 8 Jul, Check-out: 9 Jul" → 8 Jul of the current year) and parses it.
func firstDateIn(s string) (time.Time, bool) {
	tok := dateTokenRe.FindString(s)
	if tok == "" {
		if ds := relativeDatesIn(s); len(ds) > 0 {
			return ds[0], true
		}
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
			hadYear := t.Year() != 0
			year := t.Year()
			if !hadYear {
				year = time.Now().Year()
			}
			// Normalize to local midnight — time.Parse yields UTC, and mixing
			// UTC dates with local "today" shifts the calendar day near
			// midnight MYT.
			t = time.Date(year, t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
			// No explicit year and the date passed more than a week ago →
			// the guest means the next occurrence ("15 Feb" said in July).
			// A date within the last few days stays past (likely a typo,
			// let the workflow re-prompt).
			if !hadYear && t.Before(time.Now().AddDate(0, 0, -7)) {
				t = t.AddDate(1, 0, 0)
			}
			return t, true
		}
	}
	return time.Time{}, false
}
