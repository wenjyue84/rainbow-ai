/**
 * session-key.ts — Profile-scoped composite session key helpers
 *
 * All in-memory session stores MUST key their Maps with a composite key
 * of `profileId:sessionId` to prevent cross-profile state contamination.
 */

/** Returns a profile-scoped composite key: "profileId:sessionId" */
export const sessionKey = (profileId: string, sessionId: string): string =>
  `${profileId}:${sessionId}`;

/** Parse a composite key back into its components. */
export const parseSessionKey = (key: string): { profileId: string; sessionId: string } => {
  const idx = key.indexOf(':');
  if (idx === -1) return { profileId: '', sessionId: key };
  return { profileId: key.slice(0, idx), sessionId: key.slice(idx + 1) };
};
