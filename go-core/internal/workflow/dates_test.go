package workflow

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFirstDateIn(t *testing.T) {
	year := time.Now().Year()
	cases := []struct {
		in    string
		ok    bool
		day   int
		month time.Month
	}{
		{"Check-in: 8 Jul, Check-out: 9 Jul", true, 8, time.July},
		{"check in 15 feb check out 17 feb", true, 15, time.February},
		{"15/2/2026 to 17/2/2026", true, 15, time.February},
		{"tonight please", false, 0, 0},
		{"8 July to 10 July", true, 8, time.July},
		{"2026-07-08", true, 8, time.July},
	}
	for _, c := range cases {
		got, ok := firstDateIn(c.in)
		if ok != c.ok {
			t.Fatalf("%q: ok=%v want %v", c.in, ok, c.ok)
		}
		if !ok {
			continue
		}
		if got.Day() != c.day || got.Month() != c.month {
			t.Fatalf("%q: got %v want day=%d month=%v", c.in, got, c.day, c.month)
		}
		if got.Year() < year {
			t.Fatalf("%q: year %d in the past", c.in, got.Year())
		}
	}
}

func TestPastDateCheckSemantics(t *testing.T) {
	r := &Registry{}
	today := time.Now().Format("2 Jan")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2 Jan")
	tomorrow := time.Now().AddDate(0, 0, 1).Format("2 Jan")

	mk := func(field string) *Node {
		return &Node{Type: "condition", Config: map[string]json.RawMessage{
			"field":    json.RawMessage(`"` + field + `"`),
			"operator": json.RawMessage(`"pastDateCheck"`),
		}}
	}
	st := &State{Data: map[string]string{}}
	rc := RunContext{}

	// today and tomorrow are valid check-in dates → true (continue booking)
	for _, d := range []string{"Check-in: " + today, "Check-in: " + tomorrow, "no date at all"} {
		res, esc := r.evalCondition(mk(d), st, rc)
		if !res || esc {
			t.Fatalf("%q: expected valid (true,false), got (%v,%v)", d, res, esc)
		}
	}
	// yesterday is past → false (reject)
	res, esc := r.evalCondition(mk("Check-in: "+yesterday), st, rc)
	if res || esc {
		t.Fatalf("yesterday: expected (false,false), got (%v,%v)", res, esc)
	}
}
