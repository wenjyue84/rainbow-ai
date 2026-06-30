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
