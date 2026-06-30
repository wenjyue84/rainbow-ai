package digiman

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func mockPMS(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/units/available":
			w.Write([]byte(`[{"unitNumber":"C12"},{"unitNumber":"C13"}]`))
		case "/api/units/assign":
			w.Write([]byte(`{"assigned":true,"unitNumber":"C12"}`))
		case "/api/guest-tokens/internal":
			w.Write([]byte(`{"token":"abc123","url":"https://x/checkin/abc123"}`))
		default:
			http.Error(w, "not found", 404)
		}
	}))
}

func TestCheckAvailability(t *testing.T) {
	srv := mockPMS(t)
	defer srv.Close()
	c := New(srv.URL, "tok")
	out, ok, err := c.Do(context.Background(), "check_availability", nil)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if out["available"] != "true" || out["available_count"] != "2" || out["unit_number"] != "C12" {
		t.Errorf("outputs = %v", out)
	}
}

func TestAssignCapsule(t *testing.T) {
	srv := mockPMS(t)
	defer srv.Close()
	c := New(srv.URL, "tok")
	out, ok, err := c.Do(context.Background(), "assign_capsule", map[string]string{"unitNumber": "C12", "guestName": "Al"})
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if out["assigned"] != "true" {
		t.Errorf("outputs = %v", out)
	}
}

func TestCreateCheckinLink(t *testing.T) {
	srv := mockPMS(t)
	defer srv.Close()
	c := New(srv.URL, "tok")
	out, ok, err := c.Do(context.Background(), "create_checkin_link", map[string]string{"guestName": "Al", "phoneNumber": "60123"})
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if out["token"] != "abc123" {
		t.Errorf("outputs = %v", out)
	}
}

func TestUnimplementedActionReturnsNotOk(t *testing.T) {
	srv := mockPMS(t)
	defer srv.Close()
	c := New(srv.URL, "tok")
	// find_reservation is not implemented (matches Node) → ok=false → caller escalates.
	_, ok, err := c.Do(context.Background(), "find_reservation", nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if ok {
		t.Error("find_reservation should return ok=false (unimplemented → escalate)")
	}
}

func TestAPIErrorPropagates(t *testing.T) {
	srv := mockPMS(t)
	defer srv.Close()
	c := New(srv.URL, "wrong-token") // 401
	_, _, err := c.Do(context.Background(), "check_availability", nil)
	if err == nil {
		t.Error("expected error on 401")
	}
}
