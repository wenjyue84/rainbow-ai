package router

import (
	"context"
	"fmt"

	"rainbow-core/internal/classify"
	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
)

// MsgState carries all mutable data through a message-processing graph.
// The engine pointer provides access to dependencies (classifier, conv store, sender)
// without threading them as separate parameters through every node.
type MsgState struct {
	// engine is the per-profile pipeline; set once when the graph is seeded.
	engine *Engine

	// Input (set by the caller before Run).
	Msg       contract.IncomingMessage
	Phone     string
	Text      string
	History   []string
	ConvState *conversation.State

	// Derived by normalise node.
	Lang string

	// Classification pipeline state.
	Cls      classify.Result
	deferred *classify.Result // social-intent hit deferred to deeper tiers

	// Routing (set by route node).
	Route config.Route

	// Output (set by dispatch/escalate nodes).
	Reply     string
	Escalated bool

	// Result is the final outcome, mirroring Engine.Result.
	Res Result
}

// NodeFn is a graph processing node: transforms state and returns the next
// node's name. Returning "" halts execution (terminal state).
type NodeFn func(ctx context.Context, s *MsgState) (*MsgState, string, error)

// Graph is a set of named NodeFn entries with a declared entry point.
type Graph struct {
	Nodes map[string]NodeFn
	Start string
}

// Run executes the graph from g.Start until a terminal node (next == "").
// It propagates the first error immediately.
func (g *Graph) Run(ctx context.Context, s *MsgState) (*MsgState, error) {
	current := g.Start
	for current != "" {
		fn, ok := g.Nodes[current]
		if !ok {
			return s, fmt.Errorf("graph: unknown node %q", current)
		}
		prev := current
		var err error
		s, current, err = fn(ctx, s)
		if err != nil {
			return s, fmt.Errorf("graph: node %q: %w", prev, err)
		}
	}
	return s, nil
}

// NewClassifyGraph builds the T1→T2→T3→T4 classify graph for e.
// Call g.Run(ctx, seed) where seed has engine, Phone, Text, ConvState, History set.
// This graph does NOT send messages or update conversation state — it only
// populates s.Cls and s.Route for the caller to act on.
func (e *Engine) NewClassifyGraph() *Graph {
	return &Graph{
		Start: "normalise",
		Nodes: map[string]NodeFn{
			"normalise": e.nodeNormalise,
			"t1":        e.nodeT1,
			"t2":        e.nodeT2,
			"t3":        e.nodeT3,
			"t4":        e.nodeT4,
			"deferred":  e.nodeDeferred,
			"route":     e.nodeRoute,
		},
	}
}
