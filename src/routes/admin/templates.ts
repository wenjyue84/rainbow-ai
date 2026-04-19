/**
 * Template API Routes
 * Serves HTML templates for dynamic loading
 */

import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { notFound, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /api/rainbow/templates/:name
 * Serve HTML template by name.
 * Uses process.cwd() so path resolution works in both tsx dev mode and
 * esbuild-bundled production builds (where __dirname resolves to dist/).
 */
router.get('/:name', (req, res) => {
  const { name } = req.params;

  // Sanitize template name (prevent directory traversal)
  const safeName = name.replace(/[^a-z0-9_-]/gi, '');

  // In production, always use dist/ (src/ may be stale or absent on the server).
  // In development (tsx watch mode), prefer src/ for live edits without a rebuild.
  const srcPath = join(process.cwd(), 'src', 'public', 'templates', 'tabs', `${safeName}.html`);
  const distPath = join(process.cwd(), 'dist', 'public', 'templates', 'tabs', `${safeName}.html`);
  const isProd = process.env.NODE_ENV === 'production';
  const templatePath = isProd
    ? (existsSync(distPath) ? distPath : srcPath)
    : (existsSync(srcPath) ? srcPath : distPath);

  if (!existsSync(templatePath)) {
    return notFound(res, 'Template');
  }

  try {
    const template = readFileSync(templatePath, 'utf-8');
    res.type('html').send(template);
  } catch (err) {
    serverError(res, 'Failed to load template');
  }
});

export default router;
