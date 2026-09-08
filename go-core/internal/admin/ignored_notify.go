package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"rainbow-core/internal/config"
)

// Exception-list courtesy notice.
//
// When a phone is ADDED to a profile's AI exception list (PUT
// /settings/ignored-numbers), that person should be told the bot will no
// longer auto-reply to them. Sends go through the profile's bridge, which
// treats a message to a number that has not written to us recently as a
// "cold" send and rejects it during quiet hours (22:00–08:00 local,
// reason=quiet_hours) or when a cap/warm-up applies.
//
// So the notice is never sent inline from the PUT. It is appended to a
// durable queue (<dataDir>/ignored-notify-queue.json) and a single worker
// drains it: one message at a time, and after every successful send it
// sleeps a random 30–90 s before the next one. While the bridge says the
// gate is closed the item stays queued and the worker re-checks every
// minute, so the notices go out one by one once the gate opens — never as a
// burst at 08:00.

const (
	ignoredNotifyQueueFile = "ignored-notify-queue.json"
	ignoredNotifyMinGap    = 30 * time.Second
	ignoredNotifyMaxGap    = 90 * time.Second
	ignoredNotifyRetry     = 60 * time.Second
	ignoredNotifyMaxTries  = 8 // hard failures (not gate rejections) before drop
)

// gateReasons are bridge rejections that mean "not now" rather than "never".
var gateReasons = map[string]bool{
	"quiet_hours": true, "warmup": true, "cold_cap": true, "hourly_cap": true,
	"daily_cap": true, "no_instance": true, "queue_full": true, "jid_rate_limit": true,
}

type ignoredNotifyItem struct {
	Profile   string    `json:"profile"`
	Phone     string    `json:"phone"`
	Label     string    `json:"label,omitempty"`
	QueuedAt  time.Time `json:"queuedAt"`
	Attempts  int       `json:"attempts,omitempty"`
	LastError string    `json:"lastError,omitempty"`
	LastTry   time.Time `json:"lastTry,omitempty"`
}

type ignoredNotifier struct {
	h     *Handler
	mu    sync.Mutex
	queue []ignoredNotifyItem
	wake  chan struct{}
	// sendFn is the bridge call; swapped in tests.
	sendFn func(ctx context.Context, bridgeURL, phone, text string) (ok bool, reason string, err error)
	// now/sleep are injectable for tests.
	now   func() time.Time
	sleep func(context.Context, time.Duration)
}

func newIgnoredNotifier(h *Handler) *ignoredNotifier {
	n := &ignoredNotifier{h: h, wake: make(chan struct{}, 1), now: time.Now}
	n.sendFn = bridgeSendText
	n.sleep = func(ctx context.Context, d time.Duration) {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
		case <-t.C:
		case <-n.wake:
		}
	}
	n.load()
	return n
}

// StartIgnoredNotifier loads the pending queue from disk and runs the drain
// worker until ctx is cancelled. Safe to call once from main.
func (h *Handler) StartIgnoredNotifier(ctx context.Context) {
	if h.dataDir == "" {
		return
	}
	if h.ignoredNotifier == nil {
		h.ignoredNotifier = newIgnoredNotifier(h)
	}
	go h.ignoredNotifier.run(ctx)
}

// enqueueIgnoredNotices diffs old→new and queues one notice per newly added
// phone. Returns the phones queued (for the PUT response / log).
func (h *Handler) enqueueIgnoredNotices(profileID string, before, after []config.IgnoredNumber) []string {
	if h.ignoredNotifier == nil {
		if h.dataDir == "" {
			return nil
		}
		h.ignoredNotifier = newIgnoredNotifier(h)
	}
	old := make(map[string]bool, len(before))
	for _, n := range before {
		old[n.Phone] = true
	}
	var added []string
	for _, n := range after {
		if !old[n.Phone] {
			added = append(added, n.Phone)
			h.ignoredNotifier.add(ignoredNotifyItem{Profile: profileID, Phone: n.Phone, Label: n.Label, QueuedAt: h.ignoredNotifier.now()})
		}
	}
	return added
}

func (n *ignoredNotifier) path() string {
	return filepath.Join(n.h.dataDir, ignoredNotifyQueueFile)
}

func (n *ignoredNotifier) load() {
	b, err := os.ReadFile(n.path())
	if err != nil {
		return
	}
	var q []ignoredNotifyItem
	if json.Unmarshal(b, &q) == nil {
		n.queue = q
	}
}

// persist writes the queue; caller holds mu.
func (n *ignoredNotifier) persist() {
	if n.h.dataDir == "" {
		return
	}
	if len(n.queue) == 0 {
		_ = os.Remove(n.path())
		return
	}
	b, err := json.MarshalIndent(n.queue, "", "  ")
	if err != nil {
		return
	}
	if err := os.WriteFile(n.path(), append(b, '\n'), 0o644); err != nil {
		log.Printf("[ignored-notify] persist failed: %v", err)
	}
}

func (n *ignoredNotifier) add(it ignoredNotifyItem) {
	n.mu.Lock()
	for _, q := range n.queue {
		if q.Profile == it.Profile && q.Phone == it.Phone {
			n.mu.Unlock()
			return // already pending
		}
	}
	n.queue = append(n.queue, it)
	n.persist()
	n.mu.Unlock()
	select {
	case n.wake <- struct{}{}:
	default:
	}
}

// Pending returns a copy of the queue (admin/status use).
func (n *ignoredNotifier) Pending() []ignoredNotifyItem {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := make([]ignoredNotifyItem, len(n.queue))
	copy(out, n.queue)
	return out
}

func (n *ignoredNotifier) run(ctx context.Context) {
	for ctx.Err() == nil {
		it, ok := n.head()
		if !ok {
			n.sleep(ctx, 10*time.Minute) // wake channel cuts this short
			continue
		}
		// Drop if the number was removed from the list before we got to it.
		if !n.stillListed(it) {
			n.remove(it)
			continue
		}
		text := n.message(it)
		url := n.h.bridgeURLFor(it.Profile)
		if url == "" {
			log.Printf("[ignored-notify] no bridge for profile=%q; dropping notice to %s", it.Profile, it.Phone)
			n.remove(it)
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		ok, reason, err := n.sendFn(cctx, url, it.Phone, text)
		cancel()
		switch {
		case ok:
			log.Printf("[ignored-notify] sent profile=%s phone=%s label=%q", it.Profile, it.Phone, it.Label)
			n.remove(it)
			n.sleep(ctx, ignoredNotifyMinGap+time.Duration(rand.Int63n(int64(ignoredNotifyMaxGap-ignoredNotifyMinGap))))
		case gateReasons[reason]:
			// Gate closed (quiet hours etc). Keep queued, do not count as a failure.
			n.touch(it, reason, false)
			log.Printf("[ignored-notify] gated (%s) profile=%s phone=%s; %d queued, retry in %s", reason, it.Profile, it.Phone, n.count(), ignoredNotifyRetry)
			n.sleep(ctx, ignoredNotifyRetry)
		default:
			msg := reason
			if err != nil {
				msg = err.Error()
			}
			n.touch(it, msg, true)
			if it.Attempts+1 >= ignoredNotifyMaxTries {
				log.Printf("[ignored-notify] giving up profile=%s phone=%s after %d attempts: %s", it.Profile, it.Phone, it.Attempts+1, msg)
				n.remove(it)
			} else {
				log.Printf("[ignored-notify] send failed profile=%s phone=%s (%s); retry in %s", it.Profile, it.Phone, msg, ignoredNotifyRetry)
			}
			n.sleep(ctx, ignoredNotifyRetry)
		}
	}
}

func (n *ignoredNotifier) head() (ignoredNotifyItem, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.queue) == 0 {
		return ignoredNotifyItem{}, false
	}
	return n.queue[0], true
}

func (n *ignoredNotifier) count() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.queue)
}

func (n *ignoredNotifier) remove(it ignoredNotifyItem) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for i, q := range n.queue {
		if q.Profile == it.Profile && q.Phone == it.Phone {
			n.queue = append(n.queue[:i], n.queue[i+1:]...)
			break
		}
	}
	n.persist()
}

// touch records the last attempt; countAttempt=false for gate rejections.
// A gated item is rotated to the back so one blocked bridge never starves
// another profile's queue.
func (n *ignoredNotifier) touch(it ignoredNotifyItem, reason string, countAttempt bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for i := range n.queue {
		q := &n.queue[i]
		if q.Profile == it.Profile && q.Phone == it.Phone {
			q.LastError = reason
			q.LastTry = n.now()
			if countAttempt {
				q.Attempts++
			}
			if !countAttempt && len(n.queue) > 1 {
				moved := *q
				n.queue = append(n.queue[:i], n.queue[i+1:]...)
				n.queue = append(n.queue, moved)
			}
			break
		}
	}
	n.persist()
}

// stillListed re-reads the profile's settings file so a phone removed while
// queued is not messaged.
func (n *ignoredNotifier) stillListed(it ignoredNotifyItem) bool {
	name := "settings.json"
	def := n.h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	if it.Profile != "" && it.Profile != def {
		name = profileVariant(name, it.Profile)
	}
	var doc struct {
		IgnoredNumbers []config.IgnoredNumber `json:"ignoredNumbers"`
	}
	if !n.h.readDataJSON(name, &doc) {
		return true // unreadable: don't silently drop
	}
	for _, x := range config.NormalizeIgnored(doc.IgnoredNumbers) {
		if x.Phone == it.Phone {
			return true
		}
	}
	return false
}

// businessName reads a human name for the profile from its settings file
// (businessName | business.name | name), falling back to the profile id.
func (n *ignoredNotifier) businessName(profile string) string {
	name := "settings.json"
	def := n.h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	if profile != "" && profile != def {
		name = profileVariant(name, profile)
	}
	doc := map[string]any{}
	if n.h.readDataJSON(name, &doc) {
		for _, k := range []string{"businessName", "business_name", "name"} {
			if s, ok := doc[k].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
		if b, ok := doc["business"].(map[string]any); ok {
			if s, ok := b["name"].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	if profile == "" {
		profile = def
	}
	// "dental-world" → "Dental World"
	parts := strings.FieldsFunc(profile, func(r rune) bool { return r == '-' || r == '_' })
	for i, p := range parts {
		if p != "" {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

func (n *ignoredNotifier) message(it ignoredNotifyItem) string {
	who := strings.TrimSpace(it.Label)
	greet := "Hi"
	if who != "" {
		greet = "Hi " + who
	}
	biz := n.businessName(it.Profile)
	return greet + "! This is Rainbow, the AI assistant for " + biz + ".\n\n" +
		"Your number has been added to our team exception list, so I will no longer auto-reply to your messages on this number. " +
		"Anything you send here goes straight to the team.\n\n" +
		"If this was a mistake, just tell the team and they can remove you from the list. 🙏"
}

// bridgeSendText POSTs a send_text op and returns the bridge's ok/reason.
// Unlike bridge.Client it reads the body on 503 so the caller can tell a
// closed gate (quiet_hours) from a real failure.
func bridgeSendText(ctx context.Context, bridgeURL, phone, text string) (bool, string, error) {
	body, _ := json.Marshal(map[string]any{"op": "send_text", "phone": phone, "text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(bridgeURL, "/")+"/send", bytes.NewReader(body))
	if err != nil {
		return false, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, "bridge_unreachable", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	var out struct {
		OK     bool   `json:"ok"`
		Reason string `json:"reason"`
		Error  string `json:"error"`
	}
	_ = json.Unmarshal(raw, &out)
	if out.OK {
		return true, "", nil
	}
	reason := out.Reason
	if reason == "" {
		reason = "http_" + itoa(resp.StatusCode)
	}
	if out.Error != "" {
		return false, reason, &bridgeErr{reason: reason, msg: out.Error}
	}
	return false, reason, &bridgeErr{reason: reason, msg: "bridge /send http " + itoa(resp.StatusCode)}
}

type bridgeErr struct{ reason, msg string }

func (e *bridgeErr) Error() string { return e.msg }
