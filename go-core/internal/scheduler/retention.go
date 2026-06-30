// Package scheduler ports the Node background jobs (lib/data-retention.ts et al.)
// as Go goroutines. Job logic is separated from scheduling so it stays unit-testable.
package scheduler

import (
	"time"

	"rainbow-core/internal/store"
)

// RetentionConfig mirrors the Node retention settings (US-419 / US-907).
type RetentionConfig struct {
	RetentionDays   int // soft-delete cutoff (PDPA 2024 default: 730 = 24 months)
	GracePeriodDays int // hard-delete cutoff after soft-delete (default: 30)
}

// DefaultRetention returns the Node defaults.
func DefaultRetention() RetentionConfig {
	return RetentionConfig{RetentionDays: 730, GracePeriodDays: 30}
}

// RetentionReport is the outcome of one retention pass.
type RetentionReport struct {
	MessagesSoftDeleted      int64
	MessagesHardDeleted      int64
	ConversationsSoftDeleted int64
	ConversationsHardDeleted int64
}

// RunRetention soft-deletes records older than RetentionDays and hard-deletes
// records soft-deleted longer than RetentionDays+GracePeriodDays ago. Timestamps
// are ISO-8601 text, which compares lexicographically, so plain `<` works.
func RunRetention(st *store.Store, cfg RetentionConfig, now time.Time) (RetentionReport, error) {
	var rep RetentionReport
	softCutoff := now.UTC().AddDate(0, 0, -cfg.RetentionDays).Format(store.ISO)
	hardCutoff := now.UTC().AddDate(0, 0, -(cfg.RetentionDays + cfg.GracePeriodDays)).Format(store.ISO)
	nowISO := now.UTC().Format(store.ISO)

	// NOTE: these timestamp columns have INTEGER affinity but store ISO-8601 TEXT.
	// A bare `col < ?` comparison would apply NUMERIC affinity and truncate both
	// sides to the leading year — so we CAST(... AS TEXT) to force the correct
	// lexicographic ISO comparison.

	// Messages: soft-delete old, then hard-delete long-soft-deleted.
	if r, err := st.DB.Exec(
		`UPDATE rainbow_messages SET deleted_at = ? WHERE CAST(timestamp AS TEXT) < ? AND (deleted_at IS NULL OR deleted_at = '')`,
		nowISO, softCutoff); err == nil {
		rep.MessagesSoftDeleted, _ = r.RowsAffected()
	} else {
		return rep, err
	}
	if r, err := st.DB.Exec(
		`DELETE FROM rainbow_messages WHERE deleted_at IS NOT NULL AND deleted_at <> '' AND CAST(deleted_at AS TEXT) < ?`,
		hardCutoff); err == nil {
		rep.MessagesHardDeleted, _ = r.RowsAffected()
	} else {
		return rep, err
	}

	// Conversations: same policy on updated_at / deleted_at.
	if r, err := st.DB.Exec(
		`UPDATE rainbow_conversations SET deleted_at = ? WHERE CAST(updated_at AS TEXT) < ? AND (deleted_at IS NULL OR deleted_at = '')`,
		nowISO, softCutoff); err == nil {
		rep.ConversationsSoftDeleted, _ = r.RowsAffected()
	}
	if r, err := st.DB.Exec(
		`DELETE FROM rainbow_conversations WHERE deleted_at IS NOT NULL AND deleted_at <> '' AND CAST(deleted_at AS TEXT) < ?`,
		hardCutoff); err == nil {
		rep.ConversationsHardDeleted, _ = r.RowsAffected()
	}

	return rep, nil
}
