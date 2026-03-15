/**
 * festive-stickers.ts — Admin API for sticker management
 * US-923: WhatsApp sticker response for Malaysian festive season engagement
 */
import express from 'express';
import multer from 'multer';
import {
  uploadSticker,
  listStickers,
  getStickerForIntent,
  mapStickerToIntent,
  toggleStickerResponse,
  deleteStickerIntent,
} from '../../lib/sticker-manager.js';
import { ok, badRequest, serverError } from './http-utils.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 }, // 150KB max for safety
  fileFilter(req, file, cb) {
    if (!file.originalname.endsWith('.webp')) {
      return cb(new Error('Only WebP stickers are supported'));
    }
    cb(null, true);
  },
});

// POST /admin/stickers/upload — Upload a festive sticker
router.post('/stickers/upload', upload.single('file'), async (req, res) => {
  try {
    const { stickerName } = req.body;
    const profileId = (res.locals.store || {}).profile_id || 'pelangi';

    if (!stickerName) {
      return badRequest(res, 'stickerName is required');
    }
    if (!req.file) {
      return badRequest(res, 'No file uploaded');
    }

    const result = await uploadSticker(
      profileId,
      stickerName,
      req.file.buffer,
      req.file.originalname,
      (res.locals.user as any)?.email || 'admin'
    );

    ok(res, { stickerId: result.id, fileName: result.fileName, fileSize: result.fileSize });
  } catch (e: any) {
    console.error('[Admin] Sticker upload failed:', e.message);
    if (e.message?.includes('≤100KB') || e.message?.includes('WebP')) {
      badRequest(res, e.message);
    } else {
      serverError(res, e);
    }
  }
});

// GET /admin/stickers — List stickers for profile
router.get('/stickers', async (req, res) => {
  try {
    const profileId = (res.locals.store || {}).profile_id || 'pelangi';
    const stickers = await listStickers(profileId, true);

    ok(res, { stickers });
  } catch (e: any) {
    console.error('[Admin] List stickers failed:', e.message);
    serverError(res, e);
  }
});

// POST /admin/stickers/:stickerId/map-intent — Map sticker to festive intent
router.post('/stickers/:stickerId/map-intent', express.json(), async (req, res) => {
  try {
    const { stickerId } = req.params;
    const { intent, greetingText } = req.body;
    const profileId = (res.locals.store || {}).profile_id || 'pelangi';

    if (!intent || !greetingText) {
      return badRequest(res, 'intent and greetingText are required');
    }

    const result = await mapStickerToIntent(profileId, intent, stickerId, greetingText);

    ok(res, { mappingId: result.id, message: 'Sticker mapped to intent' });
  } catch (e: any) {
    console.error('[Admin] Map sticker to intent failed:', e.message);
    serverError(res, e);
  }
});

// GET /admin/stickers/intent/:intent — Get sticker for a specific intent
router.get('/stickers/intent/:intent', async (req, res) => {
  try {
    const { intent } = req.params;
    const profileId = (res.locals.store || {}).profile_id || 'pelangi';

    const result = await getStickerForIntent(profileId, intent);

    ok(res, { sticker: result?.sticker || null, greeting: result?.greeting || null });
  } catch (e: any) {
    console.error('[Admin] Get sticker for intent failed:', e.message);
    serverError(res, e);
  }
});

// PATCH /admin/stickers/:intent/toggle — Toggle sticker response for intent
router.patch('/stickers/:intent/toggle', express.json(), async (req, res) => {
  try {
    const { intent } = req.params;
    const { enabled } = req.body;
    const profileId = (res.locals.store || {}).profile_id || 'pelangi';

    if (typeof enabled !== 'boolean') {
      return badRequest(res, 'enabled must be a boolean');
    }

    await toggleStickerResponse(profileId, intent, enabled);

    ok(res, { message: `Sticker response ${enabled ? 'enabled' : 'disabled'} for ${intent}` });
  } catch (e: any) {
    console.error('[Admin] Toggle sticker response failed:', e.message);
    serverError(res, e);
  }
});

// DELETE /admin/stickers/:intent — Delete sticker mapping for intent
router.delete('/stickers/:intent', async (req, res) => {
  try {
    const { intent } = req.params;
    const profileId = (res.locals.store || {}).profile_id || 'pelangi';

    await deleteStickerIntent(profileId, intent);

    ok(res, { message: `Sticker mapping deleted for ${intent}` });
  } catch (e: any) {
    console.error('[Admin] Delete sticker intent failed:', e.message);
    serverError(res, e);
  }
});

export default router;
