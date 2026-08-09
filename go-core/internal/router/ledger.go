// Receipt replay-protection ledger (Jay, 2026-07-19).
//
// A verified payment receipt may only ever release a capsule ONCE. The ledger
// persists the identity of every accepted receipt — keyed on the OCR-extracted
// reference number, with an amount+date+payer hash fallback — so the same
// (genuine) receipt image cannot be reused for a different booking.
//
//   - Key priority: "ref:<normalized reference>"; fallback
//     "alt:<sha256(amount|date|payer)>" when the reference is unreadable.
//   - If neither identity is derivable, the caller must NOT release — route the
//     guest to Maya instead (handled in tryPaymentReceipt).
//   - Re-sending the same receipt for the SAME reservation is allowed (retry
//     after a transient assign failure is not abuse).
//   - Entries older than 30 days are pruned on load (receipts must be dated
//     today MYT to verify, so old entries can never match again anyway).
//   - Single-process concurrency safety via mutex; persisted as JSON at
//     RAINBOW_DATA_DIR/receipt-ledger.json (atomic tmp+rename write).
package router

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

const ledgerMaxAge = 30 * 24 * time.Hour

// ledgerEntry records one accepted (verified) receipt.
type ledgerEntry struct {
	Key           string  `json:"key"`
	Reference     string  `json:"reference,omitempty"`
	Amount        float64 `json:"amount,omitempty"`
	Date          string  `json:"date,omitempty"`
	Payer         string  `json:"payer,omitempty"`
	ReservationID string  `json:"reservationId,omitempty"`
	Confirmation  string  `json:"confirmation,omitempty"`
	Session       string  `json:"session,omitempty"`
	UsedAtMs      int64   `json:"usedAtMs"`
}

// receiptLedger is a persistent used-receipt store. All methods are nil-safe
// (a nil ledger behaves as empty and never persists).
type receiptLedger struct {
	mu      sync.Mutex
	path    string // "" = in-memory only
	entries map[string]ledgerEntry
}

// ledgerRegistry dedups ledger instances by file path so multiple engines
// (one per profile) sharing RAINBOW_DATA_DIR also share one mutex + cache.
var (
	ledgerRegMu sync.Mutex
	ledgerReg   = map[string]*receiptLedger{}
)

// newReceiptLedger loads (or creates) the ledger at path, pruning stale
// entries. path "" returns a fresh in-memory ledger.
func newReceiptLedger(path string) *receiptLedger {
	if path == "" {
		return &receiptLedger{entries: map[string]ledgerEntry{}}
	}
	ledgerRegMu.Lock()
	defer ledgerRegMu.Unlock()
	if l, ok := ledgerReg[path]; ok {
		return l
	}
	l := &receiptLedger{path: path, entries: map[string]ledgerEntry{}}
	if raw, err := os.ReadFile(path); err == nil {
		var list []ledgerEntry
		if json.Unmarshal(raw, &list) == nil {
			cutoff := time.Now().Add(-ledgerMaxAge).UnixMilli()
			for _, e := range list {
				if e.Key != "" && e.UsedAtMs >= cutoff {
					l.entries[e.Key] = e
				}
			}
		}
	}
	ledgerReg[path] = l
	return l
}

// normalizeRef keeps alphanumerics uppercased; "" if nothing usable remains.
func normalizeRef(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(strings.TrimSpace(s)) {
		if (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// receiptLedgerKey derives the dedup identity of a receipt.
// ok=false means the receipt carries no usable identity (no reference AND the
// amount+date+payer fallback is incomplete) — the caller must not release.
func receiptLedgerKey(o receiptOCR) (key string, ok bool) {
	if ref := normalizeRef(o.Reference); len(ref) >= 4 {
		return "ref:" + ref, true
	}
	payer := strings.ToLower(strings.Join(strings.Fields(o.Payer), " "))
	if o.Amount > 0 && o.Date != "" && payer != "" {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%.2f|%s|%s", o.Amount, o.Date, payer)))
		return "alt:" + hex.EncodeToString(sum[:8]), true
	}
	return "", false
}

// Lookup returns the recorded entry for key, or nil.
func (l *receiptLedger) Lookup(key string) *ledgerEntry {
	if l == nil || key == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if e, ok := l.entries[key]; ok {
		return &e
	}
	return nil
}

// Record stores an accepted receipt and persists the ledger. Re-recording the
// same key for the same reservation just refreshes the timestamp.
func (l *receiptLedger) Record(e ledgerEntry) error {
	if l == nil || e.Key == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	e.UsedAtMs = time.Now().UnixMilli()
	l.entries[e.Key] = e
	return l.saveLocked()
}

// saveLocked writes the ledger to disk (caller holds l.mu). Prunes stale
// entries on every save so the file never grows unbounded.
func (l *receiptLedger) saveLocked() error {
	if l.path == "" {
		return nil
	}
	cutoff := time.Now().Add(-ledgerMaxAge).UnixMilli()
	list := make([]ledgerEntry, 0, len(l.entries))
	for k, e := range l.entries {
		if e.UsedAtMs < cutoff {
			delete(l.entries, k)
			continue
		}
		list = append(list, e)
	}
	raw, err := json.MarshalIndent(list, "", " ")
	if err != nil {
		return err
	}
	tmp := l.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, l.path)
}
