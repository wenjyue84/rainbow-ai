/**
 * upsell-tracker.ts — Track upsell suggestions per session (US-857)
 *
 * Prevents duplicate upsell suggestions by tracking whether an upsell has been
 * offered in the current session. Limited to one upsell per session.
 */

interface UpsellSession {
  offered: boolean;
  offeredAt?: number;
}

const upsellSessions = new Map<string, UpsellSession>();

const UPSELL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup stale upsell sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of upsellSessions) {
    if (session.offeredAt && now - session.offeredAt > UPSELL_TTL_MS) {
      upsellSessions.delete(key);
    }
  }
}, 60 * 60 * 1000);

/**
 * Check if an upsell has already been offered in this session.
 */
export function hasUpsellBeenOffered(sessionId: string): boolean {
  return upsellSessions.get(sessionId)?.offered ?? false;
}

/**
 * Mark that an upsell has been offered in this session (once per session).
 */
export function markUpsellOffered(sessionId: string): void {
  upsellSessions.set(sessionId, {
    offered: true,
    offeredAt: Date.now(),
  });
}

/**
 * Category-based upsell suggestions when FnB MCP is unavailable.
 * Maps item categories to suggested add-ons.
 */
const UPSELL_MAP: Record<string, { suggested: string; message: string }> = {
  // Mains (rice, noodles)
  rice: {
    suggested: 'a drink',
    message: 'Great choice! Would you like a drink to go with that?',
  },
  noodles: {
    suggested: 'a drink',
    message: 'Great choice! Would you like a refreshing drink with that?',
  },
  mains: {
    suggested: 'a drink',
    message: 'Great choice! Can we interest you in a drink?',
  },

  // Desserts
  desserts: {
    suggested: 'a drink',
    message: 'Great choice! How about a drink to complete your meal?',
  },
  cake: {
    suggested: 'a coffee',
    message: 'Lovely! Would a coffee or tea pair well with that?',
  },

  // Drinks (suggest snacks or desserts)
  drinks: {
    suggested: 'a snack',
    message: 'Perfect! Any snack or dessert to enjoy with that drink?',
  },

  // Default
  _default: {
    suggested: 'something else',
    message: 'Great! Anything else to go with that?',
  },
};

/**
 * Get an upsell suggestion based on item category.
 * Returns suggested item name and conversational message.
 */
export function getUpsellSuggestion(category?: string): { suggested: string; message: string } {
  if (!category) {
    return UPSELL_MAP._default;
  }

  const normalized = category.toLowerCase().trim();
  return UPSELL_MAP[normalized] || UPSELL_MAP._default;
}
