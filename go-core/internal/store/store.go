// Package store wraps the shared SQLite database (data/rainbow-ai.db) that the
// Node app uses. The Go core reads/writes the SAME tables (rainbow_messages,
// rainbow_conversation_state, rainbow_conversations) so the admin panel keeps
// working during migration. Timestamps are stored as TEXT ISO-8601
// (%Y-%m-%dT%H:%M:%fZ) to match the Node PG→SQLite shim.
package store

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// ISO is the timestamp format the Node shim writes (millisecond precision, UTC).
const ISO = "2006-01-02T15:04:05.000Z"

// NowISO returns the current time in the shim's format.
func NowISO() string { return time.Now().UTC().Format(ISO) }

// Store is a thin handle around the shared SQLite DB.
type Store struct {
	DB *sql.DB
}

// Open opens the SQLite DB at path with WAL + busy timeout (matches the Node
// better-sqlite3 pragmas) and verifies connectivity.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(0)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite single-writer: cap to avoid "database is locked" under WAL.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping %s: %w", path, err)
	}
	return &Store{DB: db}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// TableColumns returns column name→type for a table (for schema inspection/tests).
// table must be a bare identifier (letters, digits, underscore) — validated to
// prevent SQL injection via PRAGMA concatenation.
func (s *Store) TableColumns(table string) (map[string]string, error) {
	for _, c := range table {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return nil, fmt.Errorf("store: invalid table name %q", table)
		}
	}
	rows, err := s.DB.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := map[string]string{}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols[name] = ctype
	}
	return cols, rows.Err()
}
