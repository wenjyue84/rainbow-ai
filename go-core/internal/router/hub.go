package router

import (
	"context"
	"strings"

	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
)

// Hub routes inbound messages to the right per-profile Engine based on the
// WhatsApp instanceId (mirrors profile-registry.resolveProfile). Unmapped
// instances fall back to the default profile.
type Hub struct {
	engines         map[string]*Engine // by profileId
	instanceProfile map[string]string  // instanceId -> profileId
	defaultProfile  string
	// botNumbers are OUR OWN WhatsApp numbers (every linked instance). A message
	// whose sender resolves to one of them is another of our assistants, not a
	// guest: it is stored for visibility but never answered — two auto-replying
	// bots otherwise ping-pong forever (2026-09-08: Rainbow ↔ Rachel).
	botNumbers map[string]bool
}

// SetBotNumbers installs the set of our own numbers (digits only; JIDs and
// formatting are normalised). Safe to call at any time.
func (h *Hub) SetBotNumbers(nums []string) {
	m := map[string]bool{}
	for _, n := range nums {
		if d := config.NormalizePhone(n); d != "" {
			m[d] = true
		}
	}
	h.botNumbers = m
}

// isBotPeer reports whether the message comes from one of our own numbers.
// Uses the bridge-resolved PhoneNumber (privacy-ID peers) or From itself.
func (h *Hub) isBotPeer(msg contract.IncomingMessage) bool {
	if len(h.botNumbers) == 0 || msg.FromMe {
		return false
	}
	for _, cand := range []string{msg.PhoneNumber, msg.From} {
		if cand == "" || strings.HasSuffix(cand, "@lid") || strings.HasSuffix(cand, "@g.us") {
			continue
		}
		if h.botNumbers[config.NormalizePhone(cand)] {
			return true
		}
	}
	return false
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
	if h.isBotPeer(msg) {
		// Keep it visible in Live Chat (a human may be driving that bot), no AI.
		if text := strings.TrimSpace(msg.Text); text != "" && !msg.IsGroup {
			if msg.PhoneNumber != "" {
				eng.conv.SetContactPhone(msg.From, msg.PhoneNumber)
			}
			if _, err := eng.conv.GetOrCreate(msg.From, msg.PushName, eng.prof.ID); err == nil {
				_ = eng.conv.AddMessage(msg.From, "user", text, eng.prof.ID)
			}
		}
		return Result{Skipped: true, SkipReason: "bot-peer: message from one of our own numbers"}, nil
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

// Engine returns the engine for a profile id (default engine when unmapped).
func (h *Hub) Engine(profileID string) *Engine {
	if e, ok := h.engines[profileID]; ok {
		return e
	}
	return h.engines[h.defaultProfile]
}

// SetIgnoredNumbers hot-applies a profile's AI exception list. Returns false
// when the hub serves no engine for profileID (the caller should still have
// persisted the file; it takes effect on next restart).
func (h *Hub) SetIgnoredNumbers(profileID string, list []config.IgnoredNumber) bool {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	eng, ok := h.engines[profileID]
	if !ok || eng == nil {
		return false
	}
	eng.SetIgnoredNumbers(list)
	return true
}

// SetRetriever hot-swaps a profile's RAG retriever (KB API reload). Returns
// false when the hub serves no engine for profileID.
func (h *Hub) SetRetriever(profileID string, r Retriever) bool {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	eng, ok := h.engines[profileID]
	if !ok || eng == nil {
		return false
	}
	eng.SetRetriever(r)
	return true
}

// SetReplyMode hot-applies a profile's reply_mode / intro_message. Returns
// false when the hub serves no engine for profileID.
func (h *Hub) SetReplyMode(profileID, mode, intro string) bool {
	if profileID == "" {
		profileID = h.defaultProfile
	}
	eng, ok := h.engines[profileID]
	if !ok || eng == nil {
		return false
	}
	eng.SetReplyMode(mode, intro)
	return true
}

// Profiles returns the profile ids the hub serves.
func (h *Hub) Profiles() []string {
	out := make([]string, 0, len(h.engines))
	for id := range h.engines {
		out = append(out, id)
	}
	return out
}
