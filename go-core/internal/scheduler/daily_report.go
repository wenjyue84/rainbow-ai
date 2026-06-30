package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Getter fetches JSON from the PMS (implemented by *digiman.Client).
type Getter interface {
	Get(ctx context.Context, path string) (json.RawMessage, error)
}

type unitData struct {
	Number  string `json:"number"`
	Section string `json:"section"`
}

type guestData struct {
	UnitNumber           string `json:"unitNumber"`
	Name                 string `json:"name"`
	IsPaid               bool   `json:"isPaid"`
	IsCheckedIn          *bool  `json:"isCheckedIn"`
	ExpectedCheckoutDate string `json:"expectedCheckoutDate"`
	Status               string `json:"status"`
	PaymentAmount        string `json:"paymentAmount"`
}

// BuildDailyReport fetches units + checked-in guests and formats an occupancy /
// unpaid / checkouts-today summary (Go port of lib/daily-report.ts, summary form).
func BuildDailyReport(ctx context.Context, pms Getter, now time.Time) (string, error) {
	unitsRaw, err := pms.Get(ctx, "/api/units")
	if err != nil {
		return "", fmt.Errorf("fetch units: %w", err)
	}
	guestsRaw, err := pms.Get(ctx, "/api/guests/checked-in?page=1&limit=100")
	if err != nil {
		return "", fmt.Errorf("fetch guests: %w", err)
	}

	var units []unitData
	json.Unmarshal(unitsRaw, &units)

	var guests []guestData
	if json.Unmarshal(guestsRaw, &guests) != nil || len(guests) == 0 {
		var wrap struct {
			Data []guestData `json:"data"`
		}
		if json.Unmarshal(guestsRaw, &wrap) == nil {
			guests = wrap.Data
		}
	}

	occupied := map[string]guestData{}
	for _, g := range guests {
		if g.IsCheckedIn == nil || *g.IsCheckedIn {
			occupied[g.UnitNumber] = g
		}
	}

	today := now.Format("2006-01-02")
	var unpaid, checkouts []string
	for _, g := range guests {
		if g.IsCheckedIn != nil && !*g.IsCheckedIn {
			continue
		}
		if !g.IsPaid {
			line := "  • " + g.UnitNumber + " — " + g.Name
			if amt, err := strconv.ParseFloat(g.PaymentAmount, 64); err == nil && amt > 0 {
				line += fmt.Sprintf(" (RM%.0f)", amt)
			}
			unpaid = append(unpaid, line)
		}
		if strings.HasPrefix(g.ExpectedCheckoutDate, today) {
			checkouts = append(checkouts, "  • "+g.UnitNumber+" — "+g.Name)
		}
	}
	sort.Strings(unpaid)
	sort.Strings(checkouts)

	var b strings.Builder
	b.WriteString("🏨 *PELANGI DAILY REPORT*\n\n")
	b.WriteString(fmt.Sprintf("Occupancy: *%d/%d* units\n\n", len(occupied), len(units)))
	if len(unpaid) > 0 {
		b.WriteString(fmt.Sprintf("❌ *Unpaid (%d):*\n%s\n\n", len(unpaid), strings.Join(unpaid, "\n")))
	} else {
		b.WriteString("✅ All checked-in guests paid.\n\n")
	}
	if len(checkouts) > 0 {
		b.WriteString(fmt.Sprintf("📤 *Checkouts today (%d):*\n%s\n\n", len(checkouts), strings.Join(checkouts, "\n")))
	}
	b.WriteString("———————————————\n")
	b.WriteString("📅 " + now.Format("02/01/2006 15:04"))
	return b.String(), nil
}
