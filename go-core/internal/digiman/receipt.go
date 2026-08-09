// Receipt-verification and post-check-in support helpers over the PMS2 MCP:
// pending-reservation lookup (with totalAmount), available-unit listing,
// reservation unit assignment (pelangi_update_reservation — verified present in
// tools/list 2026-07-19), and per-unit maintenance problems
// (pelangi_list_problems). All calls are read-only except AssignReservationUnit.
package digiman

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// Reservation is the subset of a PMS2 reservation the receipt/arrival flows need.
type Reservation struct {
	ID                 string
	ConfirmationNumber string
	GuestName          string
	Status             string
	UnitNumber         string
	CheckInDate        string
	CheckOutDate       string
	TotalAmount        float64
}

// Problem is one active maintenance record for a unit.
type Problem struct {
	UnitNumber  string
	Description string
	ReportedAt  string
	IsResolved  bool
}

func numField(m map[string]any, key string) float64 {
	switch v := m[key].(type) {
	case float64:
		return v
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f
	}
	return 0
}

func decodeReservation(r map[string]any) *Reservation {
	if r == nil {
		return nil
	}
	return &Reservation{
		ID:                 strField(r, "id"),
		ConfirmationNumber: strField(r, "confirmationNumber"),
		GuestName:          strField(r, "guestName"),
		Status:             strField(r, "status"),
		UnitNumber:         strField(r, "unitNumber"),
		CheckInDate:        strField(r, "checkInDate"),
		CheckOutDate:       strField(r, "checkOutDate"),
		TotalAmount:        numField(r, "totalAmount"),
	}
}

// FindReservationByGuest looks up the guest's active (non-cancelled) reservation
// via pelangi_lookup_reservation, trying name then phone. Returns nil, nil when
// nothing is found.
func (c *Client) FindReservationByGuest(ctx context.Context, name, phone string) (*Reservation, error) {
	if !c.MCPConfigured() {
		return nil, fmt.Errorf("PMS MCP not configured")
	}
	tryLookup := func(args map[string]any) *Reservation {
		m, err := c.mcpCall(ctx, "pelangi_lookup_reservation", args)
		if err != nil || m == nil || m["found"] != true {
			return nil
		}
		list, _ := m["reservations"].([]any)
		for _, it := range list {
			r, _ := it.(map[string]any)
			res := decodeReservation(r)
			if res != nil && !strings.EqualFold(res.Status, "cancelled") {
				return res
			}
		}
		return nil
	}
	name = strings.TrimSpace(name)
	if name != "" {
		if r := tryLookup(map[string]any{"guestName": name}); r != nil {
			return r, nil
		}
	}
	if p := cleanPhone(phone); p != "" {
		if r := tryLookup(map[string]any{"guestPhone": p}); r != nil {
			return r, nil
		}
	}
	return nil, nil
}

// RateTotal prices a stay via pelangi_get_rates (read-only). Used by the
// receipt-OCR gate when the reservation carries no totalAmount (the deployed
// PMS2 cannot accept totalAmount on MCP create — schema deadlock, 2026-07-19).
func (c *Client) RateTotal(ctx context.Context, checkInDate, checkOutDate string) (float64, error) {
	if !c.MCPConfigured() {
		return 0, fmt.Errorf("PMS MCP not configured")
	}
	m, err := c.mcpCall(ctx, "pelangi_get_rates", map[string]any{
		"checkInDate":  checkInDate,
		"checkOutDate": checkOutDate,
	})
	if err != nil {
		return 0, err
	}
	return numField(m, "totalAmount"), nil
}

// AvailableUnits returns the unit numbers currently free for assignment
// (pelangi_check_availability → JSON array of unit objects with "number").
func (c *Client) AvailableUnits(ctx context.Context) ([]string, error) {
	if !c.MCPConfigured() {
		return nil, fmt.Errorf("PMS MCP not configured")
	}
	text, err := c.mcpCallText(ctx, "pelangi_check_availability", map[string]any{})
	if err != nil {
		return nil, err
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(text), &arr); err != nil {
		// Some deployments wrap in {units:[...]} / {data:[...]}
		var wrap map[string]any
		if json.Unmarshal([]byte(text), &wrap) != nil {
			return nil, fmt.Errorf("check_availability: unexpected payload")
		}
		for _, k := range []string{"units", "data"} {
			if list, ok := wrap[k].([]any); ok {
				for _, it := range list {
					if m, ok := it.(map[string]any); ok {
						arr = append(arr, m)
					}
				}
				break
			}
		}
	}
	var out []string
	for _, u := range arr {
		avail, hasAvail := u["isAvailable"].(bool)
		if hasAvail && !avail {
			continue
		}
		if n := strField(u, "number"); n != "" {
			out = append(out, n)
		} else if n := strField(u, "unitNumber"); n != "" {
			out = append(out, n)
		}
	}
	return out, nil
}

// AssignReservationUnit sets the unit on a reservation via
// pelangi_update_reservation and appends an internal audit note. It does NOT
// change the reservation status — admin confirmation stays a human action.
func (c *Client) AssignReservationUnit(ctx context.Context, reservationID, unitNumber, note string) error {
	if !c.MCPConfigured() {
		return fmt.Errorf("PMS MCP not configured")
	}
	args := map[string]any{
		"reservationId": reservationID,
		"unitNumber":    unitNumber,
	}
	if note != "" {
		args["internalNotes"] = note
	}
	_, err := c.mcpCall(ctx, "pelangi_update_reservation", args)
	return err
}

// ActiveProblemUnits returns the set of unit numbers that currently have an
// active (unresolved) maintenance problem — one pelangi_list_problems call.
// Used to keep auto-assignment away from units with open issues. Keys are
// stored both raw and uppercased for cheap case-insensitive lookups.
func (c *Client) ActiveProblemUnits(ctx context.Context) (map[string]bool, error) {
	if !c.MCPConfigured() {
		return nil, fmt.Errorf("PMS MCP not configured")
	}
	m, err := c.mcpCall(ctx, "pelangi_list_problems", map[string]any{"activeOnly": true})
	if err != nil {
		return nil, err
	}
	list, _ := m["data"].([]any)
	if list == nil {
		list, _ = m["problems"].([]any)
	}
	out := map[string]bool{}
	for _, it := range list {
		p, _ := it.(map[string]any)
		if p == nil {
			continue
		}
		if resolved, _ := p["isResolved"].(bool); resolved {
			continue // defensive: activeOnly should already filter these
		}
		if u := strings.TrimSpace(strField(p, "unitNumber")); u != "" {
			out[u] = true
			out[strings.ToUpper(u)] = true
		}
	}
	return out, nil
}

// MarkPaymentPending flags a reservation in PMS as payment-received-pending-
// staff-confirmation (paymentPendingConfirmation=true). Called by the receipt-
// OCR gate after a successful AI verification so the PMS dashboard shows a
// ⏳ indicator prompting staff to confirm and finalise the booking record.
func (c *Client) MarkPaymentPending(ctx context.Context, reservationID string) error {
	if !c.MCPConfigured() {
		return fmt.Errorf("PMS MCP not configured")
	}
	_, err := c.mcpCall(ctx, "pelangi_update_reservation", map[string]any{
		"reservationId":              reservationID,
		"paymentPendingConfirmation": true,
	})
	return err
}

// UnitProblems returns the ACTIVE maintenance problems recorded for one unit
// (pelangi_list_problems, activeOnly). Only what the PMS actually reports —
// callers must not embellish (anti-fabrication rule).
func (c *Client) UnitProblems(ctx context.Context, unitNumber string) ([]Problem, error) {
	if !c.MCPConfigured() {
		return nil, fmt.Errorf("PMS MCP not configured")
	}
	m, err := c.mcpCall(ctx, "pelangi_list_problems", map[string]any{"activeOnly": true})
	if err != nil {
		return nil, err
	}
	list, _ := m["data"].([]any)
	if list == nil {
		list, _ = m["problems"].([]any)
	}
	var out []Problem
	for _, it := range list {
		p, _ := it.(map[string]any)
		if p == nil {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(strField(p, "unitNumber")), strings.TrimSpace(unitNumber)) {
			continue
		}
		resolved, _ := p["isResolved"].(bool)
		out = append(out, Problem{
			UnitNumber:  strField(p, "unitNumber"),
			Description: strField(p, "description"),
			ReportedAt:  strField(p, "reportedAt"),
			IsResolved:  resolved,
		})
	}
	return out, nil
}
