/**
 * Startup readiness gate (US-450).
 *
 * Exports a module-level `isReady` flag that starts as `false` and is set to
 * `true` only after DB, configStore, profileRegistry, and KnowledgeBase init
 * complete.  The `/health/ready` endpoint and admin API middleware use this
 * flag to return HTTP 503 until the server is fully initialised.
 */

let _isReady = false;
let _listenTimestamp: number | null = null;
let _readyTimestamp: number | null = null;

/** Returns true once all critical subsystems have finished initialising. */
export function isReady(): boolean {
  return _isReady;
}

/**
 * Call once from the startup flow after DB, configStore, profileRegistry,
 * and KnowledgeBase init have all completed.  Logs the time-to-ready.
 */
export function markReady(): void {
  if (_isReady) return;
  _isReady = true;
  _readyTimestamp = Date.now();
  const elapsed = _listenTimestamp ? _readyTimestamp - _listenTimestamp : null;
  console.log(
    `[Startup] Server is READY${elapsed != null ? ` (time-to-ready: ${elapsed}ms)` : ''}`
  );
}

/** Call from server.listen() callback to record when listening started. */
export function markListening(): void {
  _listenTimestamp = Date.now();
}

/** Returns time-to-ready in ms, or null if not yet ready. */
export function getTimeToReady(): number | null {
  if (_listenTimestamp == null || _readyTimestamp == null) return null;
  return _readyTimestamp - _listenTimestamp;
}
