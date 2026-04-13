/**
 * KB Upload & Extraction Route (US-538)
 *
 * POST /api/admin/kb/:profile/upload
 *
 * Accepts multipart/form-data with:
 * - file: Required uploaded document (PDF, DOCX, PNG, etc.)
 * - filename: Optional custom filename for the KB file (defaults to sanitized original name)
 *
 * Calls kreuzberg to extract markdown, writes to .rainbow-kb directory, then reindexes RAG.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { promises as fsPromises } from 'fs';
import path from 'path';
import multer from 'multer';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { extractToMarkdown, KBExtractorError } from '../../lib/kb-extractor.js';
import { badRequest, serverError, validateFilename } from './http-utils.js';

const router = Router();

// ─── Multer Configuration ──────────────────────────────────────────────
// Store uploaded files in memory to avoid disk writes before extraction
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// ─── Profile Mapping ───────────────────────────────────────────────────
// Map user-facing profile names (from URL param) to internal profile IDs
const PROFILE_MAPPING: Record<string, string> = {
  'pelangi': 'pelangi',
  'southern': 'southern',
  'makan': 'makan-moments',
};

/**
 * Sanitize a filename to prevent path traversal and normalize it.
 * Converts filename to lowercase, removes special chars, adds .md extension.
 */
function sanitizeFilename(filename: string): string {
  // Remove leading/trailing whitespace
  let sanitized = filename.trim();

  // Remove extension if present (we'll add .md)
  sanitized = sanitized.replace(/\.(md|pdf|docx|xlsx|txt|png|jpg|jpeg)$/i, '');

  // Convert to lowercase, replace spaces with hyphens
  sanitized = sanitized.toLowerCase().replace(/\s+/g, '-');

  // Remove non-alphanumeric characters except hyphens
  sanitized = sanitized.replace(/[^a-z0-9\-]/g, '');

  // Remove consecutive hyphens
  sanitized = sanitized.replace(/\-+/g, '-');

  // Remove leading/trailing hyphens
  sanitized = sanitized.replace(/^\-+|\-+$/g, '');

  // Default to 'untitled' if empty
  if (!sanitized) sanitized = 'untitled';

  // Add .md extension
  return `${sanitized}.md`;
}

// ─── Routes ───────────────────────────────────────────────────────────

/**
 * POST /kb/:profile/upload
 * Upload a document file, extract markdown, and add to KB
 */
router.post(
  '/:profile/upload',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      // ─── Validate profile ──────────────────────────────────────────
      const urlProfile = req.params.profile as string;
      const profileId = PROFILE_MAPPING[urlProfile];

      if (!profileId) {
        badRequest(res, `Invalid profile: ${urlProfile}. Must be one of: pelangi, southern, makan`);
        return;
      }

      // ─── Validate file was uploaded ────────────────────────────────
      if (!req.file) {
        badRequest(res, 'file (multipart) required');
        return;
      }

      // ─── Get profile instance ──────────────────────────────────────
      const profile = profileRegistry.getProfile(profileId);
      if (!profile) {
        serverError(res, `Profile ${profileId} not found`);
        return;
      }

      // ─── Determine KB filename ─────────────────────────────────────
      const customFilename = req.body.filename;
      let kbFilename: string;

      if (customFilename) {
        // Validate custom filename
        const fnErr = validateFilename(customFilename);
        if (fnErr) {
          badRequest(res, fnErr);
          return;
        }
        // Ensure it ends with .md
        kbFilename = customFilename.endsWith('.md') ? customFilename : `${customFilename}.md`;
      } else {
        // Generate filename from original upload name
        kbFilename = sanitizeFilename(req.file.originalname);
      }

      // ─── Write temp file for extraction ────────────────────────────
      const tempPath = path.join(process.cwd(), `temp-upload-${Date.now()}-${req.file.fieldname}`);
      await fsPromises.writeFile(tempPath, req.file.buffer);

      try {
        // ─── Extract markdown using kreuzberg ──────────────────────
        let markdown: string;
        try {
          markdown = await extractToMarkdown(tempPath);
        } catch (extractErr: any) {
          // Extraction failed (unsupported format, corruption, etc.)
          res.status(422).json({
            error: extractErr instanceof KBExtractorError
              ? extractErr.message
              : `Extraction failed: ${extractErr.message}`
          });
          return;
        }

        // ─── Write extracted markdown to KB directory ──────────────
        const kbFilePath = path.join(profile.kb.kbDir, kbFilename);
        await fsPromises.writeFile(kbFilePath, markdown, 'utf-8');
        console.log(`[KB:${profileId}] Written extracted markdown to ${kbFilename}`);

        // ─── Reload the KB file in memory ──────────────────────────
        profile.kb.reloadKBFile(kbFilename);
        console.log(`[KB:${profileId}] Reloaded KB file: ${kbFilename}`);

        // ─── Rebuild RAG index ────────────────────────────────────
        let ragRebuilt = false;
        try {
          // Call public reindexKB() method (US-538/US-542)
          await profile.kb.reindexKB();
          ragRebuilt = true;
          console.log(`[KB:${profileId}] RAG index rebuilt after KB upload`);
        } catch (ragErr: any) {
          console.warn(`[KB:${profileId}] RAG rebuild failed (but KB file written): ${ragErr.message}`);
          // Don't fail the upload if RAG rebuild fails
        }

        // ─── Success response ──────────────────────────────────────
        res.json({
          success: true,
          kbFile: kbFilename,
          extractedChars: markdown.length,
          ragRebuilt,
        });
      } finally {
        // ─── Cleanup temp file ───────────────────────────────────
        try {
          await fsPromises.unlink(tempPath);
        } catch {}
      }
    } catch (err: any) {
      serverError(res, err);
    }
  }
);

export default router;
