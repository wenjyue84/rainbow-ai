package scheduler

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"rainbow-core/internal/store"
)

func tempDB(t *testing.T) string {
	t.Helper()
	src := filepath.Join("..", "..", "..", "data", "rainbow-ai.db")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("no local DB: %v", err)
	}
	dst := filepath.Join(t.TempDir(), "test.db")
	in, _ := os.Open(src)
	defer in.Close()
	out, _ := os.Create(dst)
	io.Copy(out, in)
	out.Close()
	return dst
}

func TestRunRetention(t *testing.T) {
	st, err := store.Open(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	now := time.Now().UTC()
	recent := now.Format(store.ISO)
	old := now.AddDate(0, 0, -800).Format(store.ISO)         // > 730d → soft-delete
	longDeleted := now.AddDate(0, 0, -800).Format(store.ISO) // soft-deleted 800d ago → hard-delete

	// Seed: recent (keep), old/not-deleted (soft-delete), already-soft-deleted-long-ago (hard-delete).
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('R1','user','recent',?, 'pelangi')`, recent)
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id) VALUES ('R2','user','old',?, 'pelangi')`, old)
	st.DB.Exec(`INSERT INTO rainbow_messages (phone, role, content, timestamp, profile_id, deleted_at) VALUES ('R3','user','gone',?, 'pelangi', ?)`, old, longDeleted)

	rep, err := RunRetention(st, DefaultRetention(), now)
	if err != nil {
		t.Fatalf("RunRetention: %v", err)
	}
	if rep.MessagesSoftDeleted < 1 {
		t.Errorf("expected >=1 soft-deleted, got %d", rep.MessagesSoftDeleted)
	}
	if rep.MessagesHardDeleted < 1 {
		t.Errorf("expected >=1 hard-deleted, got %d", rep.MessagesHardDeleted)
	}

	// Recent message survives, untouched.
	var deletedAt *string
	st.DB.QueryRow(`SELECT deleted_at FROM rainbow_messages WHERE phone='R1'`).Scan(&deletedAt)
	if deletedAt != nil && *deletedAt != "" {
		t.Error("recent message should not be soft-deleted")
	}
	// Old message is now soft-deleted.
	st.DB.QueryRow(`SELECT deleted_at FROM rainbow_messages WHERE phone='R2'`).Scan(&deletedAt)
	if deletedAt == nil || *deletedAt == "" {
		t.Error("old message should be soft-deleted")
	}
	// Long-deleted message is gone.
	var cnt int
	st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone='R3'`).Scan(&cnt)
	if cnt != 0 {
		t.Errorf("long-soft-deleted message should be hard-deleted, found %d", cnt)
	}
}

func TestSchedulerEveryAndStop(t *testing.T) {
	s := New()
	var n int32
	fired := make(chan struct{}, 1)
	s.Every("test", 15*time.Millisecond, func(ctx context.Context) {
		atomic.AddInt32(&n, 1)
		select {
		case fired <- struct{}{}:
		default:
		}
	})
	select {
	case <-fired:
	case <-time.After(2 * time.Second):
		t.Fatal("job did not fire")
	}
	s.Stop()
	after := atomic.LoadInt32(&n)
	time.Sleep(40 * time.Millisecond)
	if atomic.LoadInt32(&n) != after {
		t.Error("job kept firing after Stop")
	}
}

func TestUntilNext(t *testing.T) {
	from := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	// 03:00 today already passed → next is tomorrow 03:00 (17h away).
	d := untilNext(from, 3, 0)
	if d <= 0 || d > 24*time.Hour {
		t.Errorf("untilNext = %v, want within (0,24h]", d)
	}
	// 23:00 today is in the future (13h away).
	d2 := untilNext(from, 23, 0)
	if d2 != 13*time.Hour {
		t.Errorf("untilNext(23:00) = %v, want 13h", d2)
	}
}
