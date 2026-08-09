package digiman

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// mockMCP serves a minimal JSON-RPC tools/call endpoint recording requests.
func mockMCP(t *testing.T, handler func(tool string, args map[string]any) (string, *string)) (*httptest.Server, *[]string) {
	t.Helper()
	var tools []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-key" {
			http.Error(w, "unauthorized", 401)
			return
		}
		var req struct {
			Params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			} `json:"params"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		tools = append(tools, req.Params.Name)
		text, rpcErr := handler(req.Params.Name, req.Params.Arguments)
		w.Header().Set("Content-Type", "application/json")
		if rpcErr != nil {
			json.NewEncoder(w).Encode(map[string]any{
				"jsonrpc": "2.0", "id": 1,
				"error": map[string]any{"code": -32603, "message": *rpcErr},
			})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0", "id": 1,
			"result": map[string]any{"content": []map[string]string{{"type": "text", "text": text}}},
		})
	}))
	t.Cleanup(srv.Close)
	return srv, &tools
}

func TestCreateReservationViaMCP(t *testing.T) {
	var gotArgs map[string]any
	srv, _ := mockMCP(t, func(tool string, args map[string]any) (string, *string) {
		if tool != "pelangi_create_reservation" {
			s := "unexpected tool " + tool
			return "", &s
		}
		gotArgs = args
		return `{"id":"uuid-1","confirmationNumber":"PLG-20260719-009","status":"pending"}`, nil
	})
	c := New("", "")
	c.SetMCP(srv.URL, "test-key")

	out, ok, err := c.Do(context.Background(), "create_reservation", map[string]string{
		"guestName":    "TEST Loop Guest",
		"guestPhone":   "60127088789",
		"guestCount":   "2",
		"bookingDates": "Check-in: 25 Jul, Check-out: 27 Jul",
	})
	if err != nil || !ok {
		t.Fatalf("Do: ok=%v err=%v", ok, err)
	}
	if out["confirmation_number"] != "PLG-20260719-009" || out["reservation_created"] != "true" {
		t.Errorf("outputs = %v", out)
	}
	// PMS2 zod enum accepts direct_web (shared/validation/reservation-validation.ts:74);
	// webchat bookings are tagged direct_web so analytics can tell them from walk-ins.
	if gotArgs["status"] != "pending" || gotArgs["source"] != "direct_web" {
		t.Errorf("must create as pending/direct_web, got %v", gotArgs)
	}
	if gotArgs["unitNumber"] != nil {
		t.Errorf("must NOT auto-assign a unit, got %v", gotArgs["unitNumber"])
	}
	ci, _ := gotArgs["checkInDate"].(string)
	co, _ := gotArgs["checkOutDate"].(string)
	if !strings.HasSuffix(ci, "-07-25") || !strings.HasSuffix(co, "-07-27") {
		t.Errorf("dates not parsed: in=%q out=%q", ci, co)
	}
	if gotArgs["numberOfGuests"] != float64(2) {
		t.Errorf("numberOfGuests = %v", gotArgs["numberOfGuests"])
	}
}

func TestCreateReservationSoftFailure(t *testing.T) {
	srv, _ := mockMCP(t, func(string, map[string]any) (string, *string) {
		s := "Create reservation: API Error: 400 Bad Request"
		return "", &s
	})
	c := New("", "")
	c.SetMCP(srv.URL, "test-key")
	_, ok, err := c.Do(context.Background(), "create_reservation", map[string]string{
		"guestName": "X", "bookingDates": "25 Jul to 26 Jul",
	})
	if !ok || err == nil {
		t.Errorf("API failure must be soft (ok=true, err!=nil): ok=%v err=%v", ok, err)
	}
	// Unparseable dates are also soft failures.
	_, ok, err = c.Do(context.Background(), "create_reservation", map[string]string{
		"guestName": "X", "bookingDates": "whenever lah",
	})
	if !ok || err == nil {
		t.Errorf("bad dates must be soft failure: ok=%v err=%v", ok, err)
	}
}

func TestFindReservationViaMCP(t *testing.T) {
	found := `{"found":true,"count":1,"reservations":[{"id":"uuid-2","confirmationNumber":"PLG-20260719-010","guestName":"Alice","unitNumber":"C7","checkInDate":"2026-07-19","checkOutDate":"2026-07-20","status":"confirmed"}]}`
	srv, calls := mockMCP(t, func(tool string, args map[string]any) (string, *string) {
		if args["guestName"] == "Alice" {
			return found, nil
		}
		return `{"found":false,"message":"No reservation found matching the provided details"}`, nil
	})
	c := New("", "")
	c.SetMCP(srv.URL, "test-key")

	out, ok, err := c.Do(context.Background(), "find_reservation", map[string]string{
		"guestName": "Alice", "phoneNumber": "web:sess-123",
	})
	if err != nil || !ok {
		t.Fatalf("Do: ok=%v err=%v", ok, err)
	}
	if out["reservationFound"] != "true" || out["unitNumber"] != "C7" || out["confirmationNumber"] != "PLG-20260719-010" {
		t.Errorf("outputs = %v", out)
	}
	if len(*calls) != 1 {
		t.Errorf("webchat pseudo-phone must not trigger a phone lookup, calls=%v", *calls)
	}

	// Unknown guest → found=false, no escalation, no error.
	out, ok, err = c.Do(context.Background(), "find_reservation", map[string]string{"guestName": "Nobody"})
	if err != nil || !ok || out["reservationFound"] != "false" {
		t.Errorf("not-found: ok=%v err=%v out=%v", ok, err, out)
	}
}

func TestFindReservationPhoneFallback(t *testing.T) {
	srv, calls := mockMCP(t, func(tool string, args map[string]any) (string, *string) {
		if args["guestPhone"] == "60176701102" {
			return `{"found":true,"count":1,"reservations":[{"id":"u3","confirmationNumber":"PLG-3","unitNumber":"","checkInDate":"2026-07-19","checkOutDate":"2026-07-21","status":"pending"}]}`, nil
		}
		return `{"found":false}`, nil
	})
	c := New("", "")
	c.SetMCP(srv.URL, "test-key")
	out, ok, err := c.Do(context.Background(), "find_reservation", map[string]string{
		"guestName": "Misspelled Name", "phoneNumber": "60176701102@s.whatsapp.net",
	})
	if err != nil || !ok {
		t.Fatalf("Do: ok=%v err=%v", ok, err)
	}
	if out["reservationFound"] != "true" || out["confirmationNumber"] != "PLG-3" {
		t.Errorf("phone fallback failed: out=%v calls=%v", out, *calls)
	}
	if fmt.Sprint(*calls) != "[pelangi_lookup_reservation pelangi_lookup_reservation]" {
		t.Errorf("expected name then phone lookup, calls=%v", *calls)
	}
}

func TestCleanPhone(t *testing.T) {
	cases := map[string]string{
		"60127088789":                "60127088789",
		"+60 12-708 8789":            "60127088789",
		"60127088789@s.whatsapp.net": "60127088789",
		"web:abc12345678":            "",
		"web:1729384756@x":           "",
		"12345":                      "",
		"John Tan":                   "",
	}
	for in, want := range cases {
		if got := cleanPhone(in); got != want {
			t.Errorf("cleanPhone(%q) = %q, want %q", in, got, want)
		}
	}
}
