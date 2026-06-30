package store

import (
	"os"
	"testing"
)

func TestProbeValues(t *testing.T) {
	if _, err := os.Stat(dbPath()); err != nil {
		t.Skipf("no local DB: %v", err)
	}
	s, err := Open(dbPath())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	var phone, role, content string
	var ts int64
	row := s.DB.QueryRow(`SELECT phone, role, substr(content,1,40), timestamp FROM rainbow_messages ORDER BY timestamp DESC LIMIT 1`)
	if err := row.Scan(&phone, &role, &content, &ts); err != nil {
		t.Logf("no messages: %v", err)
	} else {
		t.Logf("latest msg: phone=%s role=%s ts=%d content=%q", phone, role, ts, content)
		// epoch seconds ~1.7e9, epoch ms ~1.7e12
		if ts > 1e12 {
			t.Logf("=> timestamp is epoch MILLISECONDS")
		} else if ts > 1e9 {
			t.Logf("=> timestamp is epoch SECONDS")
		}
	}

	var cnt int
	s.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_conversation_state`).Scan(&cnt)
	t.Logf("conversation_state rows: %d", cnt)
	rows, _ := s.DB.Query(`SELECT phone, language, unknown_count, created_at, last_active_at, COALESCE(slots_json,''), COALESCE(last_intent,'') FROM rainbow_conversation_state LIMIT 3`)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var ph, lang, slots, li string
			var uc int
			var ca, la int64
			rows.Scan(&ph, &lang, &uc, &ca, &la, &slots, &li)
			t.Logf("state: phone=%s lang=%s unknown=%d created=%d active=%d lastIntent=%s slots=%.60s", ph, lang, uc, ca, la, li, slots)
		}
	}
}
