package router

import (
	"context"
	"strings"

	"rainbow-core/internal/classify"
)

// socialNodeIntents mirrors classify.socialIntents — niceties whose T1/T2 match
// may defer to deeper tiers when the message has more substance.
var socialNodeIntents = map[string]bool{"greeting": true, "thanks": true, "farewell": true}

// nodeNormalise strips whitespace and detects language.
// Terminal on empty text (sets Res.Skipped).
func (e *Engine) nodeNormalise(_ context.Context, s *MsgState) (*MsgState, string, error) {
	s.Text = strings.TrimSpace(s.Text)
	if s.Text == "" {
		s.Res.Skipped = true
		s.Res.SkipReason = "empty"
		return s, "", nil
	}
	s.Lang = classify.DetectLanguage(s.Text)
	return s, "t1", nil
}

// nodeT1 runs the T1 regex tier.
// On a substantive hit: routes to "route".
// On a social hit with long text: saves as deferred, falls to "t2".
// On miss: falls to "t2".
func (e *Engine) nodeT1(_ context.Context, s *MsgState) (*MsgState, string, error) {
	r := e.clf.MatchT1(s.Text)
	if r == nil {
		return s, "t2", nil
	}
	if socialNodeIntents[r.Category] && len(strings.Fields(s.Text)) > 3 {
		s.deferred = r
		return s, "t2", nil
	}
	s.Cls = *r
	return s, "route", nil
}

// nodeT2 runs the T2 fuzzy tier.
// On a substantive hit: routes to "route".
// On a social hit with long text: saves as deferred (if not already set), falls to "t3".
// On miss: falls to "t3".
func (e *Engine) nodeT2(_ context.Context, s *MsgState) (*MsgState, string, error) {
	r := e.clf.MatchT2(s.Text, s.Lang)
	if r == nil {
		return s, "t3", nil
	}
	if socialNodeIntents[r.Category] && len(strings.Fields(s.Text)) > 3 {
		if s.deferred == nil {
			s.deferred = r
		}
		return s, "t3", nil
	}
	s.Cls = *r
	return s, "route", nil
}

// nodeT3 runs the optional T3 semantic tier.
// Routes to "route" on hit, "t4" when absent or miss.
func (e *Engine) nodeT3(ctx context.Context, s *MsgState) (*MsgState, string, error) {
	r := e.clf.MatchT3(ctx, s.Text, s.Lang)
	if r == nil {
		return s, "t4", nil
	}
	if socialNodeIntents[r.Category] && len(strings.Fields(s.Text)) > 3 {
		if s.deferred == nil {
			s.deferred = r
		}
		return s, "t4", nil
	}
	s.Cls = *r
	return s, "route", nil
}

// nodeT4 runs the T4 LLM tier.
// When the LLM returns a social category and a deferred match exists, uses deferred.
// On LLM miss or error, falls to "deferred" to surface any deferred match.
func (e *Engine) nodeT4(ctx context.Context, s *MsgState) (*MsgState, string, error) {
	r, err := e.clf.MatchT4(ctx, s.Text, s.Lang, s.History)
	if err != nil || r.Category == "" {
		return s, "deferred", nil
	}
	if socialNodeIntents[r.Category] && s.deferred != nil {
		s.Cls = *s.deferred
		return s, "route", nil
	}
	if r.Category == "unknown" && s.deferred != nil {
		s.Cls = *s.deferred
		return s, "route", nil
	}
	s.Cls = r
	return s, "route", nil
}

// nodeDeferred returns the deferred social match, or unknown when none.
// Terminal for classification (routes to "route").
func (e *Engine) nodeDeferred(_ context.Context, s *MsgState) (*MsgState, string, error) {
	if s.deferred != nil {
		s.Cls = *s.deferred
	} else {
		s.Cls = classify.Result{Category: "unknown", Confidence: 0, Source: classify.SrcLLM, Lang: s.Lang}
	}
	return s, "route", nil
}

// nodeRoute resolves the profile's configured action for the classified intent.
func (e *Engine) nodeRoute(_ context.Context, s *MsgState) (*MsgState, string, error) {
	s.Route = e.prof.RouteFor(s.Cls.Category)
	return s, "", nil // terminal — caller dispatches
}
