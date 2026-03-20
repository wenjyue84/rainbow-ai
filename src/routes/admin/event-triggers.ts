/**
 * Event Triggers CRUD API
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, notFound, serverError } from './http-utils.js';
import {
  listEventTriggers, getEventTrigger, createEventTrigger,
  updateEventTrigger, deleteEventTrigger, eventTriggerSchema
} from '../../lib/event-triggers.js';

const router = Router();

// GET /event-triggers — list all
router.get('/event-triggers', (_req: Request, res: Response) => {
  try {
    res.json(listEventTriggers());
  } catch (err: any) {
    serverError(res, err);
  }
});

// GET /event-triggers/:id — get single
router.get('/event-triggers/:id', (req: Request, res: Response) => {
  try {
    const trigger = getEventTrigger(req.params.id);
    if (!trigger) { notFound(res, 'Trigger'); return; }
    res.json(trigger);
  } catch (err: any) {
    serverError(res, err);
  }
});

// POST /event-triggers — create
router.post('/event-triggers', (req: Request, res: Response) => {
  try {
    const partial = eventTriggerSchema.omit({ id: true, createdAt: true }).safeParse(req.body);
    if (!partial.success) {
      const issues = partial.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      badRequest(res, `Validation failed: ${issues}`);
      return;
    }
    const trigger = createEventTrigger(partial.data);
    ok(res, trigger);
  } catch (err: any) {
    serverError(res, err);
  }
});

// PUT /event-triggers/:id — update
router.put('/event-triggers/:id', (req: Request, res: Response) => {
  try {
    const partial = eventTriggerSchema.omit({ id: true, createdAt: true }).partial().safeParse(req.body);
    if (!partial.success) {
      const issues = partial.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      badRequest(res, `Validation failed: ${issues}`);
      return;
    }
    const updated = updateEventTrigger(req.params.id, partial.data);
    if (!updated) { notFound(res, 'Trigger'); return; }
    ok(res, updated);
  } catch (err: any) {
    serverError(res, err);
  }
});

// DELETE /event-triggers/:id
router.delete('/event-triggers/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteEventTrigger(req.params.id);
    if (!deleted) { notFound(res, 'Trigger'); return; }
    ok(res, { deleted: true });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
