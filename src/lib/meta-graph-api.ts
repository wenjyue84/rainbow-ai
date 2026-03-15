/**
 * Meta Graph API Configuration (US-961)
 *
 * Centralizes the Graph API version used across all Meta/WhatsApp API calls.
 * Configurable via META_GRAPH_API_VERSION environment variable.
 *
 * Meta follows a quarterly major release cycle with rolling 2-version deprecation:
 * - v19.0 deprecated Feb 2025
 * - v20.0 deprecated May 2025
 * - v21.0 is current stable (as of Mar 2026)
 */

/** Minimum supported Graph API version (below this will trigger warnings). */
const MIN_SUPPORTED_VERSION = 21;

/**
 * The Graph API version string (e.g. "v21.0").
 * Override via META_GRAPH_API_VERSION env var.
 */
export const META_GRAPH_API_VERSION: string =
  process.env.META_GRAPH_API_VERSION || 'v21.0';

/**
 * Build a Meta Graph API base URL for a given path.
 * @example metaGraphUrl('12345/subscribed_apps') => 'https://graph.facebook.com/v21.0/12345/subscribed_apps'
 */
export function metaGraphUrl(path: string): string {
  return `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${path}`;
}

/**
 * Validate the configured API version on startup.
 * Logs a warning if the version is below the minimum supported.
 */
export function validateGraphApiVersion(): void {
  const match = META_GRAPH_API_VERSION.match(/^v(\d+)\.\d+$/);
  if (!match) {
    console.warn(
      `[MetaGraphAPI] Invalid META_GRAPH_API_VERSION format: "${META_GRAPH_API_VERSION}" — expected "vXX.0"`,
    );
    return;
  }

  const major = parseInt(match[1], 10);
  if (major < MIN_SUPPORTED_VERSION) {
    console.warn(
      `[MetaGraphAPI] META_GRAPH_API_VERSION=${META_GRAPH_API_VERSION} is below minimum supported v${MIN_SUPPORTED_VERSION}.0. ` +
        `Meta has deprecated versions below v${MIN_SUPPORTED_VERSION}.0. Update to avoid API errors.`,
    );
  } else {
    console.log(`[MetaGraphAPI] Using Graph API ${META_GRAPH_API_VERSION}`);
  }
}
