// Package events is a tiny in-process pub/sub used to push live-chat updates
// (new messages) from the message write path to SSE subscribers in the admin
// API. It is deliberately dependency-free so the conversation package can
// publish without importing admin, and admin can subscribe without importing
// the router.
package events

import (
	"sync"
	"time"
)

// Event is one live-chat notification.
type Event struct {
	Type      string `json:"type"`                // "new_message"
	ProfileID string `json:"profileId,omitempty"` // business the row belongs to
	Phone     string `json:"phone"`               // conversation key (rainbow_messages.phone)
	Role      string `json:"role"`                // user | assistant | staff
	Timestamp int64  `json:"timestamp"`           // unix ms
	Preview   string `json:"preview,omitempty"`   // first ~80 chars (never logged)
}

// Bus fans events out to subscribers. Slow subscribers are dropped rather than
// blocking the publisher (the DB write path must never wait on a browser).
type Bus struct {
	mu   sync.RWMutex
	subs map[int]chan Event
	next int
}

// Default is the process-wide bus.
var Default = New()

// New creates an empty bus.
func New() *Bus { return &Bus{subs: map[int]chan Event{}} }

// Subscribe returns a channel that receives future events and a cancel func.
func (b *Bus) Subscribe(buffer int) (<-chan Event, func()) {
	if buffer < 1 {
		buffer = 16
	}
	ch := make(chan Event, buffer)
	b.mu.Lock()
	id := b.next
	b.next++
	b.subs[id] = ch
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if c, ok := b.subs[id]; ok {
			delete(b.subs, id)
			close(c)
		}
		b.mu.Unlock()
	}
}

// Publish delivers e to every subscriber without blocking; a subscriber whose
// buffer is full misses this event (its next poll catches up).
func (b *Bus) Publish(e Event) {
	if e.Timestamp == 0 {
		e.Timestamp = time.Now().UnixMilli()
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// Subscribers reports the current subscriber count (for /health and tests).
func (b *Bus) Subscribers() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subs)
}

// Publish on the default bus.
func Publish(e Event) { Default.Publish(e) }

// Subscribe on the default bus.
func Subscribe(buffer int) (<-chan Event, func()) { return Default.Subscribe(buffer) }

// Preview truncates s to at most n runes (never splits a UTF-8 sequence).
func Preview(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
