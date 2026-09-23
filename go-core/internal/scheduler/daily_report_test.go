package scheduler

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

type fakeGetter struct {
	units  string
	guests string
}

func (f fakeGetter) Get(_ context.Context, path string) (json.RawMessage, error) {
	if strings.HasPrefix(path, "/api/units") {
		return json.RawMessage(f.units), nil
	}
	return json.RawMessage(f.guests), nil
}

func TestBuildDailyReport(t *testing.T) {
	now := time.Date(2026, 6, 30, 11, 30, 0, 0, time.UTC)
	g := fakeGetter{
		units: `[{"number":"C11","section":"A"},{"number":"C12","section":"A"},{"number":"C13","section":"A"}]`,
		guests: `[
			{"unitNumber":"C11","name":"Alice","isPaid":true,"expectedCheckoutDate":"2026-07-02"},
			{"unitNumber":"C12","name":"Bob","isPaid":false,"paymentAmount":"40","expectedCheckoutDate":"2026-06-30"}
		]`,
	}
	report, err := BuildDailyReport(context.Background(), g, now)
	if err != nil {
		t.Fatalf("BuildDailyReport: %v", err)
	}
	if !strings.Contains(report, "2/3") {
		t.Errorf("expected occupancy 2/3, report:\n%s", report)
	}
	if !strings.Contains(report, "Bob") || !strings.Contains(report, "RM40") {
		t.Errorf("expected unpaid Bob RM40, report:\n%s", report)
	}
	if !strings.Contains(report, "Checkouts today") || !strings.Contains(report, "C12") {
		t.Errorf("expected Bob (C12) in today's checkouts, report:\n%s", report)
	}
	if strings.Contains(report, "Alice") && strings.Contains(report, "Unpaid") &&
		strings.Index(report, "Alice") > strings.Index(report, "Unpaid") &&
		strings.Index(report, "Alice") < strings.Index(report, "Checkouts") {
		t.Error("paid guest Alice should not be in the unpaid list")
	}
}

// TestBuildDailyReportPaymentStatusContract covers the 2026-09-22 PMS2 contract:
// "needs chasing" = paymentStatus == "owing", never isPaid alone.
//   - C1: isPaid=false, outstandingAmount=0, paymentStatus="settled" -> must NOT be listed
//     (this exact shape was the 2026-09-22 false positive).
//   - isPaid=true, outstandingAmount=550, paymentStatus="owing" -> must be listed with RM550.
func TestBuildDailyReportPaymentStatusContract(t *testing.T) {
	now := time.Date(2026, 6, 30, 11, 30, 0, 0, time.UTC)
	g := fakeGetter{
		units: `[{"number":"C11","section":"A"},{"number":"C12","section":"A"}]`,
		guests: `[
			{"unitNumber":"C11","name":"Dara","isPaid":false,"outstandingAmount":0,"paymentStatus":"settled","expectedCheckoutDate":"2026-07-05"},
			{"unitNumber":"C12","name":"Emir","isPaid":true,"outstandingAmount":550,"paymentStatus":"owing","expectedCheckoutDate":"2026-07-05"}
		]`,
	}
	report, err := BuildDailyReport(context.Background(), g, now)
	if err != nil {
		t.Fatalf("BuildDailyReport: %v", err)
	}
	if strings.Contains(report, "Dara") {
		t.Errorf("C1 false-positive: isPaid=false/paymentStatus=settled guest Dara must not be listed as unpaid, report:\n%s", report)
	}
	if !strings.Contains(report, "Emir") || !strings.Contains(report, "RM550") {
		t.Errorf("expected owing guest Emir with RM550, report:\n%s", report)
	}
}

func TestBuildDailyReportWrappedGuests(t *testing.T) {
	now := time.Date(2026, 6, 30, 11, 30, 0, 0, time.UTC)
	g := fakeGetter{
		units:  `[{"number":"C11","section":"A"}]`,
		guests: `{"data":[{"unitNumber":"C11","name":"Cara","isPaid":true,"expectedCheckoutDate":"2026-07-01"}]}`,
	}
	report, err := BuildDailyReport(context.Background(), g, now)
	if err != nil {
		t.Fatalf("BuildDailyReport: %v", err)
	}
	if !strings.Contains(report, "1/1") {
		t.Errorf("expected 1/1 occupancy (wrapped {data:[]} guests), report:\n%s", report)
	}
	if !strings.Contains(report, "All checked-in guests paid") {
		t.Errorf("expected all-paid note, report:\n%s", report)
	}
}
