package router

import (
	"context"

	"rainbow-core/internal/contract"
)

// Hub routes inbound messages to the right per-profile Engine based on the
// WhatsApp instanceId (mirrors profile-registry.resolveProfile). Unmapped
// instances fall back to the default profile.
type Hub struct {
	engines         map[string]*Engine // by profileId
	instanceProfile map[string]string  // instanceId -> profileId
	defaultProfile  string
}

// NewHub builds a hub. engines is keyed by profileId; instanceProfile maps
// WhatsApp instance ids to profile ids; defaultProfile handles unmapped instances.
func NewHub(engines map[string]*Engine, instanceProfile map[string]string, defaultProfile string) *Hub {
	return &Hub{engines: engines, instanceProfile: instanceProfile, defaultProfile: defaultProfile}
}

// Process dispatches to the engine for the message's instance/profile.
func (h *Hub) Process(ctx context.Context, msg contract.IncomingMessage) (Result, error) {
	pid := h.defaultProfile
	if p, ok := h.instanceProfile[msg.InstanceID]; ok {
		pid = p
	}
	eng := h.engines[pid]
	if eng == nil {
		eng = h.engines[h.defaultProfile]
	}
	if eng == nil {
		return Result{Skipped: true, SkipReason: "no engine for profile " + pid}, nil
	}
	return eng.Process(ctx, msg)
}

// ProcessCapture dispatches to the right engine and captures replies (webchat).
// profileID selects the engine directly (webchat isn't tied to a WA instance).
func (h *Hub) ProcessCapture(ctx context.Context, profileID string, msg contract.IncomingMessage) ([]string, Result, error) {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	eng := h.engines[profileID]
	if eng == nil {
		eng = h.engines[h.defaultProfile]
	}
	if eng == nil {
		return nil, Result{Skipped: true, SkipReason: "no engine"}, nil
	}
	return eng.ProcessCapture(ctx, msg)
}

// Profiles returns the profile ids the hub serves.
func (h *Hub) Profiles() []string {
	out := make([]string, 0, len(h.engines))
	for id := range h.engines {
		out = append(out, id)
	}
	return out
}
