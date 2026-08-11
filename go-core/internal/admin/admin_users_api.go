// admin_users_api.go — CRUD endpoints for admin_users table.
//
// GET    /api/rainbow/admin-users          list users (scoped to session tenants)
// POST   /api/rainbow/admin-users          create user
// PUT    /api/rainbow/admin-users/{id}     update user
// DELETE /api/rainbow/admin-users/{id}     delete user
package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"golang.org/x/crypto/scrypt"
)

// scryptHash produces a Node-parity "salthex:keyhex" hash. The salt is stored
// as its hex string (UTF-8 bytes), matching scryptVerify in auth_session.go.
func scryptHash(password string) (string, error) {
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(saltBytes)
	dk, err := scrypt.Key([]byte(password), []byte(saltHex), 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return saltHex + ":" + hex.EncodeToString(dk), nil
}

// adminUser is the safe public representation (no password_hash).
type adminUser struct {
	ID             int64    `json:"id"`
	Username       string   `json:"username"`
	Role           string   `json:"role"`
	AllowedTenants []string `json:"allowedTenants"` // nil/empty = unrestricted
}

// parseTenants decodes a nullable JSON column value into a []string.
func parseTenants(raw *string) []string {
	if raw == nil || *raw == "" {
		return nil
	}
	var t []string
	_ = json.Unmarshal([]byte(*raw), &t)
	return t
}

// tenantsJSON encodes []string for storage; nil → SQL NULL.
func tenantsJSON(t []string) *string {
	if len(t) == 0 {
		return nil
	}
	b, _ := json.Marshal(t)
	s := string(b)
	return &s
}

// overlapsWith reports whether any element of target appears in allowed.
func overlapsWith(allowed, target []string) bool {
	set := make(map[string]struct{}, len(allowed))
	for _, a := range allowed {
		set[a] = struct{}{}
	}
	for _, t := range target {
		if _, ok := set[t]; ok {
			return true
		}
	}
	return false
}

// ── GET /api/rainbow/admin-users ─────────────────────────────────────────────

func (h *Handler) adminUsersGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	sess := sessionFrom(r)

	rows, err := h.st.DB.Query(
		`SELECT id, username, role, allowed_tenants FROM admin_users ORDER BY id`,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()

	users := []adminUser{}
	for rows.Next() {
		var u adminUser
		var rawTenants *string
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &rawTenants); err != nil {
			continue
		}
		u.AllowedTenants = parseTenants(rawTenants)
		// Scoped session: only return users whose tenants overlap with this session's tenants.
		if sess.Scoped() {
			if len(u.AllowedTenants) == 0 {
				continue // unrestricted user — not visible to scoped operator
			}
			if !overlapsWith(sess.Tenants, u.AllowedTenants) {
				continue
			}
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"users": users})
}

// ── POST /api/rainbow/admin-users ────────────────────────────────────────────

func (h *Handler) adminUsersCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	sess := sessionFrom(r)

	var body struct {
		Username       string   `json:"username"`
		Password       string   `json:"password"`
		Role           string   `json:"role"`
		AllowedTenants []string `json:"allowedTenants"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON"})
		return
	}
	if body.Username == "" || body.Password == "" {
		writeJSON(w, 400, map[string]any{"error": "username and password required"})
		return
	}
	role := body.Role
	if role == "" {
		role = "operator"
	}

	// Scoped session: cannot create unrestricted accounts; tenants must overlap.
	if sess.Scoped() {
		if len(body.AllowedTenants) == 0 {
			writeJSON(w, 403, map[string]any{"error": "forbidden: scoped session cannot create unrestricted accounts"})
			return
		}
		if !overlapsWith(sess.Tenants, body.AllowedTenants) {
			writeJSON(w, 403, map[string]any{"error": "forbidden: cannot create users for tenants outside your access"})
			return
		}
	}

	hash, err := scryptHash(body.Password)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "failed to hash password"})
		return
	}

	res, err := h.st.DB.Exec(
		`INSERT INTO admin_users (username, password_hash, role, allowed_tenants)
		 VALUES (?, ?, ?, ?)`,
		body.Username, hash, role, tenantsJSON(body.AllowedTenants),
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeJSON(w, 409, map[string]any{"error": "username already exists"})
			return
		}
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, 201, map[string]any{
		"user": adminUser{
			ID:             id,
			Username:       body.Username,
			Role:           role,
			AllowedTenants: body.AllowedTenants,
		},
	})
}

// ── PUT /api/rainbow/admin-users/{id} ────────────────────────────────────────

func (h *Handler) adminUsersUpdate(w http.ResponseWriter, r *http.Request, id int64) {
	sess := sessionFrom(r)

	var body struct {
		Username       *string  `json:"username"`
		Password       *string  `json:"password"`
		Role           *string  `json:"role"`
		AllowedTenants []string `json:"allowedTenants"`
		ClearTenants   bool     `json:"clearTenants"` // explicitly set to unrestricted
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON"})
		return
	}

	// Fetch existing user to enforce scoping.
	var existing adminUser
	var rawTenants *string
	if err := h.st.DB.QueryRow(
		`SELECT id, username, role, allowed_tenants FROM admin_users WHERE id=?`, id,
	).Scan(&existing.ID, &existing.Username, &existing.Role, &rawTenants); err != nil {
		writeJSON(w, 404, map[string]any{"error": "user not found"})
		return
	}
	existing.AllowedTenants = parseTenants(rawTenants)

	if sess.Scoped() {
		// Scoped session can only edit users within own tenants.
		if len(existing.AllowedTenants) == 0 || !overlapsWith(sess.Tenants, existing.AllowedTenants) {
			writeJSON(w, 403, map[string]any{"error": "forbidden: not authorized to edit this user"})
			return
		}
		// Cannot escalate to unrestricted.
		if body.ClearTenants || (body.AllowedTenants != nil && len(body.AllowedTenants) == 0) {
			writeJSON(w, 403, map[string]any{"error": "forbidden: scoped session cannot create unrestricted accounts"})
			return
		}
		// New tenants must still overlap.
		if len(body.AllowedTenants) > 0 && !overlapsWith(sess.Tenants, body.AllowedTenants) {
			writeJSON(w, 403, map[string]any{"error": "forbidden: cannot assign tenants outside your access"})
			return
		}
	}

	// Build update.
	newUsername := existing.Username
	if body.Username != nil && *body.Username != "" {
		newUsername = *body.Username
	}
	newRole := existing.Role
	if body.Role != nil && *body.Role != "" {
		newRole = *body.Role
	}
	newTenants := existing.AllowedTenants
	if body.ClearTenants {
		newTenants = nil
	} else if body.AllowedTenants != nil {
		newTenants = body.AllowedTenants
	}

	if body.Password != nil && *body.Password != "" {
		hash, err := scryptHash(*body.Password)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": "failed to hash password"})
			return
		}
		if _, err := h.st.DB.Exec(
			`UPDATE admin_users SET username=?, password_hash=?, role=?, allowed_tenants=? WHERE id=?`,
			newUsername, hash, newRole, tenantsJSON(newTenants), id,
		); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
	} else {
		if _, err := h.st.DB.Exec(
			`UPDATE admin_users SET username=?, role=?, allowed_tenants=? WHERE id=?`,
			newUsername, newRole, tenantsJSON(newTenants), id,
		); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
	}

	writeJSON(w, 200, map[string]any{
		"user": adminUser{
			ID:             id,
			Username:       newUsername,
			Role:           newRole,
			AllowedTenants: newTenants,
		},
	})
}

// ── DELETE /api/rainbow/admin-users/{id} ─────────────────────────────────────

func (h *Handler) adminUsersDelete(w http.ResponseWriter, r *http.Request, id int64, callerUsername string) {
	sess := sessionFrom(r)

	// Fetch existing user for scoping and self-delete prevention.
	var existing adminUser
	var rawTenants *string
	if err := h.st.DB.QueryRow(
		`SELECT id, username, role, allowed_tenants FROM admin_users WHERE id=?`, id,
	).Scan(&existing.ID, &existing.Username, &existing.Role, &rawTenants); err != nil {
		writeJSON(w, 404, map[string]any{"error": "user not found"})
		return
	}
	existing.AllowedTenants = parseTenants(rawTenants)

	// Prevent deleting self.
	if existing.Username == callerUsername {
		writeJSON(w, 400, map[string]any{"error": "cannot delete your own account"})
		return
	}

	if sess.Scoped() {
		if len(existing.AllowedTenants) == 0 || !overlapsWith(sess.Tenants, existing.AllowedTenants) {
			writeJSON(w, 403, map[string]any{"error": "forbidden: not authorized to delete this user"})
			return
		}
	}

	if _, err := h.st.DB.Exec(`DELETE FROM admin_users WHERE id=?`, id); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Router ────────────────────────────────────────────────────────────────────

// adminUsersRouter dispatches /api/rainbow/admin-users and /api/rainbow/admin-users/{id}.
func (h *Handler) adminUsersRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/rainbow/admin-users")
	path = strings.TrimPrefix(path, "/")

	if path == "" {
		// /api/rainbow/admin-users
		switch r.Method {
		case http.MethodGet:
			h.adminUsersGet(w, r)
		case http.MethodPost:
			h.adminUsersCreate(w, r)
		default:
			writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		}
		return
	}

	// /api/rainbow/admin-users/{id}
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid user id"})
		return
	}

	// Resolve caller identity for self-delete guard.
	callerUsername := ""
	if sess := sessionFrom(r); sess != nil {
		callerUsername = sess.Username
	}

	switch r.Method {
	case http.MethodPut:
		h.adminUsersUpdate(w, r, id)
	case http.MethodDelete:
		h.adminUsersDelete(w, r, id, callerUsername)
	default:
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}
