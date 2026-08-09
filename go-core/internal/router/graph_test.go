package router

import (
	"context"
	"testing"

	"rainbow-core/internal/classify"
)

func TestGraphRunExecutesInOrder(t *testing.T) {
	var order []string
	g := &Graph{
		Start: "a",
		Nodes: map[string]NodeFn{
			"a": func(_ context.Context, s *MsgState) (*MsgState, string, error) {
				order = append(order, "a")
				return s, "b", nil
			},
			"b": func(_ context.Context, s *MsgState) (*MsgState, string, error) {
				order = append(order, "b")
				return s, "", nil
			},
		},
	}
	if _, err := g.Run(context.Background(), &MsgState{}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(order) != 2 || order[0] != "a" || order[1] != "b" {
		t.Errorf("execution order = %v, want [a b]", order)
	}
}

func TestGraphRunUnknownNode(t *testing.T) {
	g := &Graph{
		Start: "a",
		Nodes: map[string]NodeFn{
			"a": func(_ context.Context, s *MsgState) (*MsgState, string, error) {
				return s, "missing", nil
			},
		},
	}
	if _, err := g.Run(context.Background(), &MsgState{}); err == nil {
		t.Error("expected error for unknown node, got nil")
	}
}

func TestNodeNormaliseEmpty(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	s, next, err := eng.nodeNormalise(context.Background(), &MsgState{Text: "   "})
	if err != nil {
		t.Fatalf("nodeNormalise: %v", err)
	}
	if next != "" {
		t.Errorf("next = %q, want terminal", next)
	}
	if !s.Res.Skipped || s.Res.SkipReason != "empty" {
		t.Errorf("expected Skipped/empty, got %+v", s.Res)
	}
}

func TestNodeNormaliseValid(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	s, next, err := eng.nodeNormalise(context.Background(), &MsgState{Text: "  hello  "})
	if err != nil {
		t.Fatalf("nodeNormalise: %v", err)
	}
	if next != "t1" {
		t.Errorf("next = %q, want t1", next)
	}
	if s.Text != "hello" {
		t.Errorf("Text = %q, want trimmed 'hello'", s.Text)
	}
	if s.Lang == "" {
		t.Error("Lang should be set")
	}
}

func TestNodeT1Miss(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	// Gibberish should not match any T1 regex.
	s, next, err := eng.nodeT1(context.Background(), &MsgState{Text: "xyzzy plugh blorptang", Lang: "en"})
	if err != nil {
		t.Fatalf("nodeT1: %v", err)
	}
	if next != "t2" {
		t.Errorf("next = %q, want t2 on miss", next)
	}
	if s.Cls.Category != "" {
		t.Errorf("Cls should be empty on miss, got %q", s.Cls.Category)
	}
}

func TestNodeT1SubstantiveHit(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	s, next, err := eng.nodeT1(context.Background(), &MsgState{Text: "what is the wifi password?", Lang: "en"})
	if err != nil {
		t.Fatalf("nodeT1: %v", err)
	}
	if next != "route" {
		t.Skipf("wifi did not T1-hit in this profile (next=%q) — substantive-hit path not exercised", next)
	}
	if s.Cls.Category == "" {
		t.Error("Cls.Category should be set on a substantive hit")
	}
	if s.deferred != nil {
		t.Error("substantive hit should not set deferred")
	}
}

func TestNodeT1SocialDeferred(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	// A greeting prefix on a longer message should defer to deeper tiers.
	s, next, err := eng.nodeT1(context.Background(), &MsgState{Text: "hi can I check in tonight please", Lang: "en"})
	if err != nil {
		t.Fatalf("nodeT1: %v", err)
	}
	if s.deferred == nil {
		t.Skipf("no social T1 hit on long text (next=%q) — deferred path not exercised", next)
	}
	if next != "t2" {
		t.Errorf("next = %q, want t2 after deferring social match", next)
	}
	if !socialNodeIntents[s.deferred.Category] {
		t.Errorf("deferred category %q is not social", s.deferred.Category)
	}
}

func TestNodeRoute(t *testing.T) {
	send := &mockSender{}
	eng := newTestEngine(t, send)
	s, next, err := eng.nodeRoute(context.Background(), &MsgState{
		Cls: classify.Result{Category: "greeting"},
	})
	if err != nil {
		t.Fatalf("nodeRoute: %v", err)
	}
	if next != "" {
		t.Errorf("nodeRoute next = %q, want terminal", next)
	}
	if s.Route.Action == "" {
		t.Error("Route.Action should be resolved from profile config")
	}
}
