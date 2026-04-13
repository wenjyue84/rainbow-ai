/**
 * intent-prompts.ts — Admin endpoint for managing per-intent custom system prompts
 * POST /api/admin/intents/{intent_type}/prompt
 */

import { Router, Request, Response } from 'express';
import { intentPromptManager } from '../../assistant/intent-prompt-manager.js';

const router = Router();

/**
 * POST /api/admin/intents/:intent_type/prompt
 * Update custom system prompt for a specific intent
 *
 * Request body: { system_prompt: string }
 * Response: { success: true, intent_type, system_prompt }
 */
router.post('/:intent_type/prompt', (req: Request, res: Response) => {
  try {
    const { intent_type } = req.params;
    const { system_prompt } = req.body;

    // Validate input
    if (!intent_type || typeof intent_type !== 'string') {
      res.status(400).json({ error: 'Invalid intent type' });
      return;
    }

    if (!system_prompt || typeof system_prompt !== 'string' || system_prompt.trim().length === 0) {
      res.status(400).json({ error: 'System prompt must be a non-empty string' });
      return;
    }

    // Update the prompt (this is atomic)
    intentPromptManager.setPrompt(intent_type, system_prompt);

    res.json({
      success: true,
      intent_type,
      system_prompt: intentPromptManager.getPrompt(intent_type, system_prompt)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[IntentPrompts] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/admin/intents/:intent_type/prompt
 * Get custom system prompt for a specific intent (if configured)
 * Response: { intent_type, system_prompt } or { intent_type, system_prompt: null }
 */
router.get('/:intent_type/prompt', (req: Request, res: Response) => {
  try {
    const { intent_type } = req.params;

    if (!intent_type || typeof intent_type !== 'string') {
      res.status(400).json({ error: 'Invalid intent type' });
      return;
    }

    const customPrompt = intentPromptManager.getCustomPrompt(intent_type);

    res.json({
      intent_type,
      system_prompt: customPrompt || null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/admin/intents/prompts/all
 * Get all configured intent prompts
 * Response: { [intent_type]: { system_prompt } }
 */
router.get('/prompts/all', (req: Request, res: Response) => {
  try {
    const allPrompts = intentPromptManager.getAllPrompts();
    res.json(allPrompts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
