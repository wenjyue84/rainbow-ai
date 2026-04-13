/**
 * conversation-limiter.ts — Per-profile conversation turn limit enforcement
 *
 * Enforces per-profile conversation turn limits and automatically escalates
 * to human handoff when exceeded, preventing endless chatbot loops.
 *
 * Story: US-571
 */

import type { ConversationState } from '../types.js';
import { logEscalationEvent } from '../../lib/escalation-events.js';
import { getTemplate } from '../formatter.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Profile limits: maps profile ID to max turn count
 */
interface ProfileLimit {
  maxTurns: number;
}

type ProfileLimitsConfig = Record<string, ProfileLimit>;

let profileLimitsCache: ProfileLimitsConfig | null = null;

/**
 * Load profile limits from JSON file on first use
 */
function loadProfileLimits(): ProfileLimitsConfig {
  if (profileLimitsCache) return profileLimitsCache;

  try {
    const limitsPath = path.join(__dirname, '../data/profile-limits.json');
    const content = fs.readFileSync(limitsPath, 'utf-8');
    const data = JSON.parse(content);
    // Filter out non-profile entries like schema_version
    profileLimitsCache = Object.fromEntries(
      Object.entries(data).filter(([key]) => key !== 'schema_version')
    );
    console.log(`[ConversationLimiter] Loaded profile limits: ${JSON.stringify(profileLimitsCache)}`);
    return profileLimitsCache;
  } catch (err: any) {
    console.error(`[ConversationLimiter] Failed to load profile limits:`, err.message);
    // Fallback to safe defaults
    return {
      'data-pelangi': { maxTurns: 20 },
      'data-makan': { maxTurns: 15 },
      'data-southern': { maxTurns: 18 },
    };
  }
}

/**
 * Load recovery messages from JSON file
 */
function loadRecoveryMessages(): Record<string, any> {
  try {
    const messagesPath = path.join(__dirname, '../data/recovery-messages.json');
    const content = fs.readFileSync(messagesPath, 'utf-8');
    return JSON.parse(content);
  } catch (err: any) {
    console.error(`[ConversationLimiter] Failed to load recovery messages:`, err.message);
    return {};
  }
}

/**
 * Get recovery message for escalation-turn-limit with profile name substitution
 */
function getEscalationMessage(language: string, profileName: string): string {
  const messages = loadRecoveryMessages();
  const escalationTemplate = messages['escalation-turn-limit']?.[language];
  if (!escalationTemplate) {
    // Fallback to English or generic message
    return (
      messages['escalation-turn-limit']?.['en'] ||
      `Let me connect you with our team for assistance.`
    );
  }
  // Replace {{profile}} placeholder with profile name
  return escalationTemplate.replace(/\{\{profile\}\}/g, profileName);
}

export interface EscalationResult {
  escalated: boolean;
  reason?: string;
}

/**
 * Enforce per-profile conversation turn limit
 *
 * AC1: Check if conversation.messages.length exceeds profile's maxTurns
 * AC2: If exceeded, log escalation event and post recovery message
 * AC3: Set conversation.escalated=true
 *
 * @param conversation  Current conversation state
 * @param profile       Profile ID (e.g., "data-pelangi")
 * @param sendMessage   Function to send recovery message
 * @returns             Result indicating if escalation occurred
 */
export async function enforceConversationLimit(
  conversation: ConversationState,
  profile: string,
  sendMessage: (phone: string, text: string) => Promise<void>
): Promise<EscalationResult> {
  const limits = loadProfileLimits();
  const limit = limits[profile];

  if (!limit) {
    console.warn(`[ConversationLimiter] No limit defined for profile: ${profile}`);
    return { escalated: false };
  }

  const turnCount = conversation.messages.length;

  // Check if turn count exceeds limit
  if (turnCount <= limit.maxTurns) {
    return { escalated: false };
  }

  console.log(
    `[ConversationLimiter] Turn limit exceeded for ${conversation.phone}: ` +
    `${turnCount} turns > ${limit.maxTurns} max (profile: ${profile})`
  );

  // AC2: Log escalation event to database
  logEscalationEvent({
    jid: conversation.phone,
    profileId: profile,
    trigger: 'turn_limit_exceeded',
    count: turnCount,
    metadata: {
      maxTurns: limit.maxTurns,
      profileId: profile,
    },
  });

  // AC2: Post recovery message with profile name
  const profileDisplayName = profile.replace('data-', '').toUpperCase();
  const recoveryMessage = getEscalationMessage(conversation.language, profileDisplayName);

  try {
    await sendMessage(conversation.phone, recoveryMessage);
  } catch (err: any) {
    console.error(
      `[ConversationLimiter] Failed to send recovery message to ${conversation.phone}:`,
      err.message
    );
  }

  // AC3: Mark conversation as escalated (caller should use this to skip further processing)
  return {
    escalated: true,
    reason: `Turn limit exceeded: ${turnCount}/${limit.maxTurns}`,
  };
}
