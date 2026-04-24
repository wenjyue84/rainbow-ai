/**
 * peer-proxy.ts — Transparent proxy to cloud peer for standby instances
 *
 * When this instance is in standby mode (not active) and RAINBOW_PEER_URL +
 * RAINBOW_PEER_ADMIN_KEY are configured, conversation read/write API calls are
 * forwarded to the cloud peer so the local admin panel shows real data.
 *
 * During failover (local becomes active): shouldProxyToPeer() returns false
 * and all calls are served from the local DB as normal.
 */

import type { Request, Response } from 'express';
import { failoverCoordinator } from './failover-coordinator.js';

/**
 * Returns true when this instance should proxy conversation requests to the peer.
 * Proxy is active only when:
 *  - This instance is standby (not active / not in failover)
 *  - RAINBOW_PEER_URL is configured (peer address known)
 *  - RAINBOW_PEER_ADMIN_KEY is configured (auth key for cloud API)
 */
export function shouldProxyToPeer(): boolean {
  return (
    !failoverCoordinator.isActive() &&
    !!process.env.RAINBOW_PEER_URL &&
    !!process.env.RAINBOW_PEER_ADMIN_KEY
  );
}

/**
 * Proxy req → peer, pipe response back to res.
 * Supports GET, POST, PATCH, DELETE with JSON bodies.
 * For multipart (send-media): reconstructs FormData from req.file.
 *
 * @param req     - Incoming Express request
 * @param res     - Express response to write result into
 * @param pathOverride - Optional path override (defaults to req.path)
 */
export async function proxyToPeer(
  req: Request,
  res: Response,
  pathOverride?: string,
): Promise<void> {
  const peerUrl = process.env.RAINBOW_PEER_URL!;
  const peerKey = process.env.RAINBOW_PEER_ADMIN_KEY!;

  const targetPath = pathOverride ?? req.path;
  const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
  const url = `${peerUrl}/api/rainbow${targetPath}${queryString ? `?${queryString}` : ''}`;

  const headers: Record<string, string> = {
    'x-admin-key': peerKey,
  };

  // Forward profile header so cloud serves the correct profile's data
  const profileId = req.headers['x-profile-id'] as string | undefined;
  if (profileId) headers['x-profile-id'] = profileId;

  let body: BodyInit | undefined;

  // Multipart upload (send-media): req.file was parsed by multer — rebuild FormData
  if (req.file) {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname);
    if (req.body?.caption) fd.append('caption', req.body.caption);
    if (req.body?.instanceId) fd.append('instanceId', req.body.instanceId);
    body = fd as unknown as BodyInit;
    // Let fetch set the correct multipart Content-Type with boundary
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.body);
  }

  try {
    const peerRes = await fetch(url, {
      method: req.method,
      headers,
      body,
    });

    const contentType = peerRes.headers.get('content-type') ?? 'application/json';
    res.status(peerRes.status);
    res.setHeader('content-type', contentType);

    if (contentType.includes('application/json')) {
      const data = await peerRes.json();
      res.json(data);
    } else {
      const buffer = await peerRes.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (err) {
    console.error('[PeerProxy] Failed to reach peer:', (err as Error).message);
    res.status(502).json({ error: 'peer unavailable', detail: (err as Error).message });
  }
}
