// Package digiman is the Go core's REST client to the digiman/PMS admin API
// (the Node app's lib/http-client.ts → DIGIMAN_API_URL). It backs the workflow
// engine's pelangi_api nodes and (later) pricing/availability tools.
package digiman

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rainbow-core/internal/workflow"
)

// Client talks to the digiman/PMS REST API and (when configured via SetMCP)
// the PMS2 MCP JSON-RPC endpoint for reservation lookup/create.
type Client struct {
	baseURL string
	token   string
	mcpURL  string
	mcpKey  string
	http    *http.Client
}

// New builds a client. baseURL e.g. http://127.0.0.1:5000 ; token is the bearer.
func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

// Configured reports whether a base URL is set.
func (c *Client) Configured() bool { return c != nil && c.baseURL != "" }

func (c *Client) do(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		raw = []byte("(body unreadable)")
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("digiman %s %s -> %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	return raw, nil
}

// Get performs a GET and returns the raw JSON body.
func (c *Client) Get(ctx context.Context, path string) (json.RawMessage, error) {
	return c.do(ctx, http.MethodGet, path, nil)
}

// Post performs a POST with a JSON body and returns the raw JSON body.
func (c *Client) Post(ctx context.Context, path string, body any) (json.RawMessage, error) {
	return c.do(ctx, http.MethodPost, path, body)
}

// ─── Workflow action dispatch (implements workflow.PMS) ──────────────────────

// Do maps a pelangi_api action to a real PMS call. It returns ok=false for
// actions that are not implemented (the caller then escalates to staff — which is
// safer than the Node enhancer, where unimplemented actions silently no-op and the
// workflow proceeds with blank data). On a real API error it returns err.
func (c *Client) Do(ctx context.Context, action string, params map[string]string) (outputs map[string]string, ok bool, err error) {
	outputs = map[string]string{}
	switch action {
	case "check_availability":
		raw, err := c.Get(ctx, "/api/units/available")
		if err != nil {
			return nil, true, err
		}
		units := parseUnits(raw)
		outputs["available_count"] = fmt.Sprintf("%d", len(units))
		outputs["available"] = boolStr(len(units) > 0)
		if len(units) > 0 {
			outputs["unit_number"] = units[0]
		}
		return outputs, true, nil

	case "assign_capsule", "book_capsule", "book_unit":
		unit := first(params["unitNumber"], params["unit_number"])
		guest := first(params["guestName"], params["guest_name"])
		raw, err := c.Post(ctx, "/api/units/assign", map[string]string{"unitNumber": unit, "guestName": guest})
		if err != nil {
			return nil, true, err
		}
		outputs["assigned"] = "true"
		mergeStringFields(raw, outputs)
		return outputs, true, nil

	case "create_checkin_link":
		guest := first(params["guestName"], params["guest_name"])
		phone := first(params["phoneNumber"], params["phone"])
		raw, err := c.Post(ctx, "/api/guest-tokens/internal", map[string]string{"guestName": guest, "phoneNumber": phone})
		if err != nil {
			return nil, true, err
		}
		mergeStringFields(raw, outputs)
		return outputs, true, nil

	case "log_service_request":
		body := map[string]string{
			"unitNumber":  first(params["unitNumber"], params["unit_number"]),
			"description": first(params["description"], params["details"], params["request_details"]),
			"reportedBy":  first(params["reportedBy"], params["guestName"], params["guest_name"], params["phone"]),
			"urgency":     first(params["urgency"], "normal"),
			"source":      "whatsapp",
		}
		raw, err := c.Post(ctx, "/api/problems", body)
		if err != nil {
			return nil, true, err // ok=true so the workflow can take its error branch / escalate
		}
		outputs["logged"] = "true"
		mergeStringFields(raw, outputs) // picks up id / status if returned
		return outputs, true, nil

	case "create_reservation":
		// Booking-workflow completion → PENDING reservation in PMS2 via MCP.
		// No unit auto-assignment; the human admin confirms. Failures are soft
		// (ok=true + err) so the workflow's error branch still notifies the
		// admin instead of derailing the guest flow.
		if !c.MCPConfigured() {
			return nil, true, fmt.Errorf("create_reservation: PMS MCP not configured")
		}
		guest := first(params["guestName"], params["guest_name"])
		if strings.TrimSpace(guest) == "" {
			return nil, true, fmt.Errorf("create_reservation: missing guest name")
		}
		rawDates := first(params["bookingDates"], params["booking_dates"], params["dates"])
		in, out, okDates := workflow.ParseDateRange(rawDates)
		if !okDates {
			return nil, true, fmt.Errorf("create_reservation: cannot parse dates %q", rawDates)
		}
		args := map[string]any{
			"guestName":    guest,
			"checkInDate":  in.Format("2006-01-02"),
			"checkOutDate": out.Format("2006-01-02"),
			// "direct_web" is valid in both the MCP tool schema and the PMS2
			// REST zod enum (reservation-validation.ts, verified 2026-07-19).
			"source":          "direct_web",
			"status":          "pending",
			"specialRequests": "Booked via Rainbow webchat — pending admin confirmation. Dates as given: " + rawDates,
		}
		if phone := cleanPhone(first(params["guestPhone"], params["phoneNumber"], params["phone"])); phone != "" {
			args["guestPhone"] = phone
		}
		if n, convErr := strconv.Atoi(strings.TrimSpace(first(params["guestCount"], params["numberOfGuests"]))); convErr == nil && n > 0 {
			args["numberOfGuests"] = n
		}
		// NOTE (2026-07-19): totalAmount is intentionally NOT sent. The deployed
		// PMS2 has a schema deadlock — MCP validate-input requires a number while
		// the REST zod requires a string — so any totalAmount value 400s the
		// create. The receipt-OCR gate prices the stay via pelangi_get_rates
		// (read-only) instead. Revisit when PMS2 fixes the coercion.
		m, err := c.mcpCall(ctx, "pelangi_create_reservation", args)
		if err != nil {
			return nil, true, err
		}
		outputs["reservation_created"] = "true"
		outputs["confirmation_number"] = strField(m, "confirmationNumber")
		outputs["reservation_id"] = strField(m, "id")
		return outputs, true, nil

	case "find_reservation", "find_active_reservation":
		// Reservation lookup via MCP pelangi_lookup_reservation (cancelled
		// bookings are filtered out server-side). Without MCP, keep the old
		// escalate-to-staff behavior (ok=false).
		if !c.MCPConfigured() {
			return nil, false, nil
		}
		name := strings.TrimSpace(first(params["guestName"], params["guest_name"], params["name"]))
		phone := cleanPhone(first(params["phoneNumber"], params["guestPhone"], params["phone"]))
		if name == "" && phone == "" {
			return nil, true, fmt.Errorf("find_reservation: no guest name or phone to search")
		}
		var m map[string]any
		var err error
		if name != "" {
			m, err = c.mcpCall(ctx, "pelangi_lookup_reservation", map[string]any{"guestName": name})
		}
		// Fall back to a phone search when the name search errs or finds nothing.
		if phone != "" && (err != nil || m == nil || m["found"] != true) {
			if m2, err2 := c.mcpCall(ctx, "pelangi_lookup_reservation", map[string]any{"guestPhone": phone}); err2 == nil {
				m, err = m2, nil
			}
		}
		if err != nil {
			return nil, true, err
		}
		found, _ := m["found"].(bool)
		outputs["reservationFound"] = boolStr(found)
		if list, _ := m["reservations"].([]any); found && len(list) > 0 {
			if r, _ := list[0].(map[string]any); r != nil {
				outputs["reservationId"] = strField(r, "id")
				outputs["confirmationNumber"] = strField(r, "confirmationNumber")
				outputs["unitNumber"] = strField(r, "unitNumber")
				// Alias: checkout/checkin templates use {{pelangi.assignedCapsule}}.
				outputs["assignedCapsule"] = strField(r, "unitNumber")
				outputs["pmsCheckInDate"] = strField(r, "checkInDate")
				outputs["pmsCheckOutDate"] = strField(r, "checkOutDate")
				outputs["reservationStatus"] = strField(r, "status")
			}
		}
		return outputs, true, nil

	case "process_checkout":
		if !c.MCPConfigured() {
			return nil, false, nil
		}
		name := strings.TrimSpace(first(params["guestName"], params["guest_name"], params["name"]))
		unit := strings.TrimSpace(first(params["capsuleNumber"], params["capsule_number"]))
		if name == "" {
			return outputs, true, fmt.Errorf("process_checkout: no guest name")
		}
		sr, err := c.mcpCall(ctx, "pelangi_search_guests", map[string]any{"query": name})
		if err != nil {
			outputs["checkoutStatus"] = "error"
			return outputs, true, fmt.Errorf("process_checkout: search failed: %w", err)
		}
		guestID := findActiveGuestID(sr, unit)
		if guestID == "" {
			outputs["checkoutStatus"] = "not_found"
			return outputs, true, nil
		}
		_, err = c.mcpCall(ctx, "pelangi_checkout_guest", map[string]any{"id": guestID})
		if err != nil {
			outputs["checkoutStatus"] = "error"
			return outputs, true, fmt.Errorf("process_checkout: checkout failed: %w", err)
		}
		outputs["checkoutStatus"] = "success"
		return outputs, true, nil

	default:
		return nil, false, nil
	}
}

// findActiveGuestID scans a pelangi_search_guests result for a currently
// checked-in guest, optionally filtered by unit number.
func findActiveGuestID(sr map[string]any, unit string) string {
	data, _ := sr["data"].([]any)
	for _, item := range data {
		g, ok := item.(map[string]any)
		if !ok {
			continue
		}
		checked, _ := g["isCheckedIn"].(bool)
		if !checked {
			continue
		}
		if unit != "" {
			gUnit, _ := g["unitNumber"].(string)
			if gUnit != unit {
				continue
			}
		}
		if id, _ := g["id"].(string); id != "" {
			return id
		}
	}
	return ""
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func parseUnits(raw json.RawMessage) []string {
	// Response is either an array of units or { units: [...] }.
	var arr []map[string]any
	if json.Unmarshal(raw, &arr) != nil {
		var wrap struct {
			Units []map[string]any `json:"units"`
		}
		if json.Unmarshal(raw, &wrap) != nil {
			return nil
		}
		arr = wrap.Units
	}
	out := make([]string, 0, len(arr))
	for _, u := range arr {
		for _, k := range []string{"unitNumber", "unit_number", "number", "name", "id"} {
			if v, ok := u[k]; ok {
				out = append(out, fmt.Sprintf("%v", v))
				break
			}
		}
	}
	return out
}

func mergeStringFields(raw json.RawMessage, out map[string]string) {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return
	}
	for k, v := range m {
		switch v.(type) {
		case string, float64, bool:
			out[k] = fmt.Sprintf("%v", v)
		}
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func first(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
