import { Router } from 'express';
import type { Request, Response } from 'express';
import { circuitBreakerRegistry } from '../../assistant/circuit-breaker.js';
import { rateLimitManager } from '../../assistant/rate-limit-manager.js';
import type { IntentEntry, RoutingAction, RoutingData, WorkflowDefinition, AIProvider } from '../../assistant/config-store.js';
import { updateRoutingRequestSchema, updateSingleRouteRequestSchema } from '../../assistant/schemas.js';
import { deepMerge } from './utils.js';
import { ok, badRequest, notFound, conflict, serverError, getStore } from './http-utils.js';
import { auditConfigChange } from '../../lib/config-db.js';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { configStore } from '../../assistant/config-store.js';

const router = Router();

// ─── Helper: Extract admin user identifier ───────────────────────────
function getAdminUser(req: Request): string | null {
  // TODO: In future with JWT/session auth, extract from token/session
  // For now, use role header or default to 'admin'
  const role = (req.headers['x-admin-role'] as string) || 'admin';
  return role;
}

// ─── Routing ────────────────────────────────────────────────────────

router.get('/routing', (_req: Request, res: Response) => {
  res.json(getStore(res).getRouting());
});

router.put('/routing', (req: Request, res: Response) => {
  const result = updateRoutingRequestSchema.safeParse(req.body);
  if (!result.success) {
    badRequest(res, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return;
  }
  const store = getStore(res);
  const before = store.getRouting();
  store.setRouting(result.data as RoutingData);
  auditConfigChange(getAdminUser(req), 'PUT /api/rainbow/routing', before, result.data);
  ok(res, { routing: result.data });
});

router.patch('/routing/:intent', (req: Request, res: Response) => {
  const intent = req.params.intent as string;
  const result = updateSingleRouteRequestSchema.safeParse(req.body);
  if (!result.success) {
    badRequest(res, result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    return;
  }
  const store = getStore(res);
  const oldRouting = store.getRouting();
  const before = oldRouting[intent];
  const data = { ...oldRouting };
  data[intent] = result.data;
  store.setRouting(data);
  auditConfigChange(getAdminUser(req), `PATCH /api/rainbow/routing/${intent}`, before, result.data);
  ok(res, { intent, ...result.data });
});

// ─── Intents (Skills) ───────────────────────────────────────────────

router.get('/intents', (_req: Request, res: Response) => {
  res.json(getStore(res).getIntents());
});

router.post('/intents', (req: Request, res: Response) => {
  const { category, patterns, flags, enabled, time_sensitive } = req.body;
  if (!category || !Array.isArray(patterns)) {
    badRequest(res, 'category and patterns[] required');
    return;
  }
  const store = getStore(res);
  const data = store.getIntents();
  const exists = data.categories.find((c: any) => c.category === category);
  if (exists) {
    conflict(res, `Category "${category}" already exists. Use PUT to update.`);
    return;
  }
  const entry: IntentEntry = {
    category,
    patterns,
    flags: flags || 'i',
    enabled: enabled !== false,
    ...(time_sensitive !== undefined && { time_sensitive: Boolean(time_sensitive) })
  };
  data.categories.push(entry);
  store.setIntents(data);
  auditConfigChange(getAdminUser(req), 'POST /api/rainbow/intents', null, entry);
  ok(res, { category, entry });
});

router.put('/intents/:category', (req: Request, res: Response) => {
  const { category } = req.params;
  const store = getStore(res);
  const data = store.getIntents();
  // Search through nested phases → intents structure
  let entry: IntentEntry | undefined;
  for (const phase of data.categories as any[]) {
    const intents = phase.intents || [];
    entry = intents.find((i: IntentEntry) => i.category === category);
    if (entry) break;
  }
  if (!entry) {
    notFound(res, `Category "${category}"`);
    return;
  }
  const before = JSON.parse(JSON.stringify(entry)); // Deep copy for audit
  if (req.body.patterns !== undefined) entry.patterns = req.body.patterns;
  if (req.body.flags !== undefined) entry.flags = req.body.flags;
  if (req.body.enabled !== undefined) entry.enabled = req.body.enabled;
  if (req.body.min_confidence !== undefined) entry.min_confidence = req.body.min_confidence;
  if (req.body.time_sensitive !== undefined) (entry as any).time_sensitive = Boolean(req.body.time_sensitive);

  // Per-tier threshold overrides (Layer 1 enhancement)
  if (req.body.t2_fuzzy_threshold !== undefined) {
    if (req.body.t2_fuzzy_threshold === null) {
      delete (entry as any).t2_fuzzy_threshold; // Remove override
    } else {
      (entry as any).t2_fuzzy_threshold = req.body.t2_fuzzy_threshold;
    }
  }
  if (req.body.t3_semantic_threshold !== undefined) {
    if (req.body.t3_semantic_threshold === null) {
      delete (entry as any).t3_semantic_threshold; // Remove override
    } else {
      (entry as any).t3_semantic_threshold = req.body.t3_semantic_threshold;
    }
  }

  store.setIntents(data);
  auditConfigChange(getAdminUser(req), `PUT /api/rainbow/intents/${category}`, before, entry);
  ok(res, { category, entry });
});

router.delete('/intents/:category', (req: Request, res: Response) => {
  const { category } = req.params;
  const store = getStore(res);
  const data = store.getIntents();
  // Search through nested phases → intents structure
  let deleted: IntentEntry | undefined;
  let found = false;
  for (const phase of data.categories as any[]) {
    const intents = phase.intents || [];
    const idx = intents.findIndex((i: IntentEntry) => i.category === category);
    if (idx !== -1) {
      deleted = intents[idx];
      intents.splice(idx, 1);
      found = true;
      break;
    }
  }
  if (!found) {
    notFound(res, `Category "${category}"`);
    return;
  }
  store.setIntents(data);
  auditConfigChange(getAdminUser(req), `DELETE /api/rainbow/intents/${category}`, deleted, null);
  ok(res, { deleted: category });
});

// ─── Templates ──────────────────────────────────────────────────────

router.get('/templates', (_req: Request, res: Response) => {
  res.json(getStore(res).getTemplates());
});

router.post('/templates', (req: Request, res: Response) => {
  const { key, en, ms, zh } = req.body;
  if (!key || !en) {
    badRequest(res, 'key and en required');
    return;
  }
  const store = getStore(res);
  const data = store.getTemplates();
  if (data[key]) {
    conflict(res, `Template "${key}" already exists. Use PUT to update.`);
    return;
  }
  const newTemplate = { en, ms: ms || '', zh: zh || '' };
  data[key] = newTemplate;
  store.setTemplates(data);
  auditConfigChange(getAdminUser(req), 'POST /api/rainbow/templates', null, newTemplate);
  ok(res, { key });
});

router.put('/templates/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;
  const store = getStore(res);
  const data = store.getTemplates();
  if (!data[key]) {
    notFound(res, `Template "${key}"`);
    return;
  }
  const before = JSON.parse(JSON.stringify(data[key])); // Deep copy for audit
  if (req.body.en !== undefined) data[key].en = req.body.en;
  if (req.body.ms !== undefined) data[key].ms = req.body.ms;
  if (req.body.zh !== undefined) data[key].zh = req.body.zh;
  store.setTemplates(data);
  auditConfigChange(getAdminUser(req), `PUT /api/rainbow/templates/${key}`, before, data[key]);
  ok(res, { key, template: data[key] });
});

router.delete('/templates/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;
  const store = getStore(res);
  const data = store.getTemplates();
  if (!data[key]) {
    notFound(res, `Template "${key}"`);
    return;
  }
  const before = JSON.parse(JSON.stringify(data[key])); // Deep copy for audit
  delete data[key];
  store.setTemplates(data);
  auditConfigChange(getAdminUser(req), `DELETE /api/rainbow/templates/${key}`, before, null);
  ok(res, { deleted: key });
});

// ─── Settings ───────────────────────────────────────────────────────

router.get('/settings', (_req: Request, res: Response) => {
  const settings = JSON.parse(JSON.stringify(getStore(res).getSettings()));

  if (settings.ai && Array.isArray(settings.ai.providers)) {
    settings.ai.providers = settings.ai.providers.map((p: any) => ({
      ...p,
      // Ollama does not require an API key (local or remote)
      available: Boolean(
        p.type === 'ollama' ||
        (p.api_key_env && process.env[p.api_key_env]) ||
        p.api_key
      )
    }));
  }

  res.json(settings);
});

router.patch('/settings', (req: Request, res: Response) => {
  const store = getStore(res);
  const current = store.getSettings();
  const before = JSON.parse(JSON.stringify(current)); // Deep copy for audit
  const merged = deepMerge(current, req.body);
  store.setSettings(merged);
  auditConfigChange(getAdminUser(req), 'PATCH /api/rainbow/settings', before, merged);
  ok(res, { settings: merged });
});

// ─── AI Providers Management ─────────────────────────────────────────

router.put('/settings/providers', (req: Request, res: Response) => {
  const providers = req.body;
  if (!Array.isArray(providers)) {
    badRequest(res, 'providers array required');
    return;
  }
  const store = getStore(res);
  const settings = store.getSettings();
  const before = settings.ai.providers;
  settings.ai.providers = providers;
  store.setSettings(settings);
  auditConfigChange(getAdminUser(req), 'PUT /api/rainbow/settings/providers', before, providers);
  ok(res, { providers: settings.ai.providers });
});

router.post('/settings/providers', (req: Request, res: Response) => {
  const { id, name, description, type, api_key_env, api_key, base_url, model, enabled } = req.body;
  if (!id || !name || !type || !base_url || !model) {
    badRequest(res, 'id, name, type, base_url, and model required');
    return;
  }
  const validTypes = ['openai-compatible', 'groq', 'ollama'];
  if (!validTypes.includes(type)) {
    badRequest(res, `type must be one of: ${validTypes.join(', ')}`);
    return;
  }
  const store = getStore(res);
  const settings = store.getSettings();
  if (!settings.ai.providers) settings.ai.providers = [];
  if (settings.ai.providers.find(p => p.id === id)) {
    conflict(res, `Provider "${id}" already exists`);
    return;
  }
  const maxPriority = settings.ai.providers.reduce((max, p) => Math.max(max, p.priority), -1);
  const newProvider: AIProvider = {
    id: id.trim().toLowerCase().replace(/\s+/g, '-'),
    name: name.trim(),
    type,
    api_key_env: api_key_env || '',
    base_url: base_url.trim(),
    model: model.trim(),
    enabled: enabled !== false,
    priority: maxPriority + 1
  };
  if (api_key) newProvider.api_key = api_key;
  if (description) newProvider.description = description;
  settings.ai.providers.push(newProvider);
  store.setSettings(settings);
  auditConfigChange(getAdminUser(req), 'POST /api/rainbow/settings/providers', null, newProvider);
  ok(res, { provider: newProvider });
});

router.delete('/settings/providers/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const store = getStore(res);
  const settings = store.getSettings();
  if (!settings.ai.providers) {
    notFound(res, `Provider "${id}"`);
    return;
  }
  const idx = settings.ai.providers.findIndex(p => p.id === id);
  if (idx === -1) {
    notFound(res, `Provider "${id}"`);
    return;
  }
  const before = settings.ai.providers[idx];
  settings.ai.providers.splice(idx, 1);
  store.setSettings(settings);
  auditConfigChange(getAdminUser(req), `DELETE /api/rainbow/settings/providers/${id}`, before, null);
  ok(res, { deleted: id });
});

router.patch('/settings/providers/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const store = getStore(res);
  const settings = store.getSettings();
  if (!settings.ai.providers) {
    notFound(res, `Provider "${id}"`);
    return;
  }
  const provider = settings.ai.providers.find(p => p.id === id);
  if (!provider) {
    notFound(res, `Provider "${id}"`);
    return;
  }

  const before = JSON.parse(JSON.stringify(provider)); // Deep copy for audit
  if (req.body.enabled !== undefined) provider.enabled = req.body.enabled;
  if (req.body.priority !== undefined) provider.priority = req.body.priority;
  if (req.body.name !== undefined) provider.name = req.body.name;
  if (req.body.model !== undefined) provider.model = req.body.model;

  store.setSettings(settings);
  auditConfigChange(getAdminUser(req), `PATCH /api/rainbow/settings/providers/${id}`, before, provider);
  ok(res, { provider });
});

// ─── Workflow ───────────────────────────────────────────────────────

router.get('/workflow', (_req: Request, res: Response) => {
  res.json(getStore(res).getWorkflow());
});

router.patch('/workflow', (req: Request, res: Response) => {
  const store = getStore(res);
  const current = store.getWorkflow();
  const before = JSON.parse(JSON.stringify(current)); // Deep copy for audit
  const merged = deepMerge(current, req.body);
  store.setWorkflow(merged);
  auditConfigChange(getAdminUser(req), 'PATCH /api/rainbow/workflow', before, merged);
  ok(res, { workflow: merged });
});

// ─── Workflows (Step Definitions) ────────────────────────────────

router.get('/workflows', (_req: Request, res: Response) => {
  res.json(getStore(res).getWorkflows());
});

router.get('/workflows/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const data = getStore(res).getWorkflows();
  const wf = data.workflows.find(w => w.id === id);
  if (!wf) {
    notFound(res, `Workflow "${id}"`);
    return;
  }
  res.json(wf);
});

router.post('/workflows', (req: Request, res: Response) => {
  const { id, name, steps } = req.body;
  if (!id || typeof id !== 'string' || !name || typeof name !== 'string') {
    badRequest(res, 'id and name required');
    return;
  }
  const store = getStore(res);
  const data = store.getWorkflows();
  if (data.workflows.find(w => w.id === id)) {
    conflict(res, `Workflow "${id}" already exists`);
    return;
  }
  const newWf: any = {
    id: id.trim().toLowerCase().replace(/\s+/g, '_'),
    name: name.trim(),
    steps: Array.isArray(steps) ? steps : []
  };
  // Node-based workflow fields (optional)
  if (req.body.format) newWf.format = req.body.format;
  if (req.body.nodes) newWf.nodes = req.body.nodes;
  if (req.body.startNodeId) newWf.startNodeId = req.body.startNodeId;
  data.workflows.push(newWf);
  store.setWorkflows(data);
  auditConfigChange(getAdminUser(req), 'POST /api/rainbow/workflows', null, newWf);
  ok(res, { workflow: newWf });
});

router.put('/workflows/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const store = getStore(res);
  const data = store.getWorkflows();
  const idx = data.workflows.findIndex(w => w.id === id);
  if (idx === -1) {
    notFound(res, `Workflow "${id}"`);
    return;
  }
  const before = JSON.parse(JSON.stringify(data.workflows[idx])); // Deep copy for audit
  if (req.body.name !== undefined) data.workflows[idx].name = req.body.name;
  if (req.body.steps !== undefined) data.workflows[idx].steps = req.body.steps;
  // Node-based workflow fields
  if (req.body.format !== undefined) (data.workflows[idx] as any).format = req.body.format;
  if (req.body.nodes !== undefined) (data.workflows[idx] as any).nodes = req.body.nodes;
  if (req.body.startNodeId !== undefined) (data.workflows[idx] as any).startNodeId = req.body.startNodeId;
  store.setWorkflows(data);
  auditConfigChange(getAdminUser(req), `PUT /api/rainbow/workflows/${id}`, before, data.workflows[idx]);
  ok(res, { workflow: data.workflows[idx] });
});

// Update a single workflow step's message (inline edit from simulator)
router.patch('/workflows/:id/steps/:stepId', (req: Request, res: Response) => {
  const { id, stepId } = req.params;
  const { message } = req.body;
  if (!message || typeof message !== 'object') {
    badRequest(res, 'message object with en/ms/zh required');
    return;
  }
  const store = getStore(res);
  const data = store.getWorkflows();
  const workflow = data.workflows.find(w => w.id === id);
  if (!workflow) {
    notFound(res, `Workflow "${id}"`);
    return;
  }
  const step = workflow.steps.find(s => s.id === stepId);
  if (!step) {
    notFound(res, `Step "${stepId}" in workflow "${id}"`);
    return;
  }
  const before = JSON.parse(JSON.stringify(step.message)); // Deep copy for audit
  if (message.en !== undefined) step.message.en = message.en;
  if (message.ms !== undefined) step.message.ms = message.ms;
  if (message.zh !== undefined) step.message.zh = message.zh;
  store.setWorkflows(data);
  auditConfigChange(getAdminUser(req), `PATCH /api/rainbow/workflows/${id}/steps/${stepId}`, before, step.message);
  ok(res, { workflowId: id, stepId, message: step.message });
});

router.delete('/workflows/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const store = getStore(res);
  const routing = store.getRouting();
  const refs = Object.entries(routing).filter(([, cfg]) => cfg.action === 'workflow' && cfg.workflow_id === id);
  if (refs.length > 0) {
    const intentNames = refs.map(([intent]) => intent).join(', ');
    conflict(res, `Cannot delete: workflow "${id}" is referenced by intents: ${intentNames}`);
    return;
  }
  const data = store.getWorkflows();
  const idx = data.workflows.findIndex(w => w.id === id);
  if (idx === -1) {
    notFound(res, `Workflow "${id}"`);
    return;
  }
  const before = data.workflows[idx];
  data.workflows.splice(idx, 1);
  store.setWorkflows(data);
  auditConfigChange(getAdminUser(req), `DELETE /api/rainbow/workflows/${id}`, before, null);
  ok(res, { deleted: id });
});

// ─── Audit Log (US-847) ────────────────────────────────────────────────

/**
 * GET /api/rainbow/audit-log
 * Returns configuration change audit log with optional filtering
 * @query limit - Max records to return (default 100, max 365 days retained)
 * @query adminUser - Filter by admin user (optional)
 * @query dateStart - ISO 8601 start date (optional)
 * @query dateEnd - ISO 8601 end date (optional)
 */
router.get('/audit-log', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
  const adminUserFilter = req.query.adminUser as string | undefined;
  const dateStart = req.query.dateStart as string | undefined;
  const dateEnd = req.query.dateEnd as string | undefined;

  try {
    const { getConfigAuditLog } = await import('../../lib/config-db.js');
    const entries = await getConfigAuditLog(limit, adminUserFilter, dateStart, dateEnd);

    // Compute human-readable diffs for each entry
    const entriesWithDiff = entries.map((entry: any) => ({
      ...entry,
      diff: computeDiff(entry.before_json, entry.after_json)
    }));

    ok(res, {
      auditLog: entriesWithDiff,
      count: entriesWithDiff.length,
      filters: { adminUser: adminUserFilter, dateStart, dateEnd }
    });
  } catch (err: any) {
    serverError(res, `Failed to retrieve audit log: ${err.message}`);
  }
});

// ─── Helper: Compute human-readable diff ────────────────────────────

function computeDiff(before: any, after: any): string {
  if (!before && !after) return '(no change)';
  if (!before) return `Created`;
  if (!after) return `Deleted`;
  if (JSON.stringify(before) === JSON.stringify(after)) return '(no change)';

  const beforeObj = typeof before === 'string' ? JSON.parse(before) : before;
  const afterObj = typeof after === 'string' ? JSON.parse(after) : after;

  const changes: string[] = [];

  // Find changed keys
  const allKeys = new Set([
    ...Object.keys(beforeObj || {}),
    ...Object.keys(afterObj || {})
  ]);

  for (const key of allKeys) {
    const beforeVal = beforeObj?.[key];
    const afterVal = afterObj?.[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      if (beforeVal === undefined) {
        changes.push(`+ ${key}`);
      } else if (afterVal === undefined) {
        changes.push(`- ${key}`);
      } else {
        changes.push(`~ ${key}: ${JSON.stringify(beforeVal)} → ${JSON.stringify(afterVal)}`);
      }
    }
  }

  return changes.length > 0 ? changes.slice(0, 5).join('; ') + (changes.length > 5 ? '...' : '') : '(no change)';
}

// ─── Circuit Breaker Status (Health Check) ─────────────────────────────

/**
 * GET /api/rainbow/circuit-breaker/status
 * Returns status of all AI provider circuit breakers
 */
router.get('/circuit-breaker/status', (_req: Request, res: Response) => {
  const statuses = circuitBreakerRegistry.getAllStatuses();
  res.json({
    circuitBreakers: statuses,
    summary: {
      total: Object.keys(statuses).length,
      open: Object.values(statuses).filter(s => s.state === 'OPEN').length,
      halfOpen: Object.values(statuses).filter(s => s.state === 'HALF_OPEN').length,
      closed: Object.values(statuses).filter(s => s.state === 'CLOSED').length
    }
  });
});

/**
 * POST /api/rainbow/circuit-breaker/reset/:providerId
 * Manually reset a specific provider's circuit breaker
 */
router.post('/circuit-breaker/reset/:providerId', (req: Request, res: Response) => {
  const providerId = req.params.providerId as string;
  circuitBreakerRegistry.reset(providerId);
  ok(res, { providerId, status: 'reset' });
});

/**
 * POST /api/rainbow/circuit-breaker/reset-all
 * Reset all circuit breakers (admin intervention)
 */
router.post('/circuit-breaker/reset-all', (_req: Request, res: Response) => {
  circuitBreakerRegistry.resetAll();
  ok(res, { status: 'all circuit breakers reset' });
});

// ─── Rate Limit Status (Health Check) ─────────────────────────────────

/**
 * GET /api/rainbow/rate-limit/status
 * Returns rate limit status of all AI providers
 */
router.get('/rate-limit/status', (_req: Request, res: Response) => {
  const states = rateLimitManager.getAllStates();
  const now = Date.now();

  const providersStatus = Array.from(states.entries()).map(([providerId, state]) => ({
    providerId,
    errorCount: state.errorCount,
    successCount: state.successCount,
    totalErrors: state.totalErrors,
    inCooldown: now < state.cooldownUntil,
    cooldownRemaining: Math.max(0, state.cooldownUntil - now),
    lastErrorAt: state.lastErrorAt,
    notifiedAt: state.notifiedAt
  }));

  const inCooldown = providersStatus.filter(p => p.inCooldown);
  const hasErrors = providersStatus.filter(p => p.errorCount > 0);

  res.json({
    providers: providersStatus,
    summary: {
      total: providersStatus.length,
      inCooldown: inCooldown.length,
      withErrors: hasErrors.length,
      healthy: providersStatus.length - hasErrors.length
    }
  });
});

/**
 * POST /api/rainbow/rate-limit/reset/:providerId
 * Manually reset a specific provider's rate limit state
 */
router.post('/rate-limit/reset/:providerId', (req: Request, res: Response) => {
  const providerId = req.params.providerId as string;
  rateLimitManager.resetProvider(providerId);
  ok(res, { providerId, status: 'rate limit reset' });
});

/**
 * POST /api/rainbow/rate-limit/reset-all
 * Reset all rate limit states (admin intervention)
 */
router.post('/rate-limit/reset-all', (_req: Request, res: Response) => {
  rateLimitManager.resetAll();
  ok(res, { status: 'all rate limits reset' });
});

// ─── KDS Configuration (US-1014) ──────────────────────────────────────

/**
 * GET /api/rainbow/settings/kds
 * Returns current KDS (Kitchen Display System) configuration.
 * Redacts auth token for security.
 */
router.get('/settings/kds', (_req: Request, res: Response) => {
  const settings = getStore(res).getSettings() as any;
  const kds = settings.kds || { enabled: false, webhookUrl: '', webhookAuthToken: '', opsNotifyPhone: '', maxRetries: 3, baseDelayMs: 1000 };
  ok(res, {
    enabled: kds.enabled ?? false,
    webhookUrl: kds.webhookUrl || '',
    webhookAuthToken: kds.webhookAuthToken ? '••••••••' : '',
    opsNotifyPhone: kds.opsNotifyPhone || '',
    maxRetries: kds.maxRetries ?? 3,
    baseDelayMs: kds.baseDelayMs ?? 1000,
    envOverrides: {
      webhookUrl: !!process.env.KDS_WEBHOOK_URL,
      webhookAuthToken: !!process.env.KDS_WEBHOOK_AUTH_TOKEN,
    },
  });
});

/**
 * PATCH /api/rainbow/settings/kds
 * Update KDS configuration fields. Deep-merged into settings.kds.
 */
router.patch('/settings/kds', (req: Request, res: Response) => {
  const allowed = ['enabled', 'webhookUrl', 'webhookAuthToken', 'opsNotifyPhone', 'maxRetries', 'baseDelayMs'];
  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  if (Object.keys(update).length === 0) {
    badRequest(res, 'No valid KDS fields provided. Allowed: ' + allowed.join(', '));
    return;
  }

  const store = getStore(res);
  const settings = store.getSettings() as any;
  const before = JSON.parse(JSON.stringify(settings.kds || {}));
  settings.kds = { ...(settings.kds || {}), ...update };
  store.setSettings(settings);
  auditConfigChange(getAdminUser(req), 'PATCH /api/rainbow/settings/kds', before, settings.kds);
  ok(res, { kds: { ...settings.kds, webhookAuthToken: settings.kds.webhookAuthToken ? '••••••••' : '' } });
});

// ─── Config Reload (live sync without redeploy) ──────────────────────

/**
 * POST /api/rainbow/config/reload
 * Force-reload all configs from DB for a specific profile or all profiles.
 * Query params: ?profile=yoongmei (optional, reloads all if omitted)
 */
router.post('/config/reload', async (req: Request, res: Response) => {
  const profileId = req.query.profile as string | undefined;

  try {
    const reloaded: string[] = [];

    if (profileId) {
      const profile = profileRegistry.getProfile(profileId);
      if (!profile) {
        notFound(res, `Profile "${profileId}"`);
        return;
      }
      await profile.configStore.forceReload();
      reloaded.push(profileId);
    } else {
      // Reload all profiles
      for (const profile of profileRegistry.listProfiles()) {
        await profile.configStore.forceReload();
        reloaded.push(profile.id);
      }
      // Also reload the default singleton configStore
      await configStore.forceReload();
      reloaded.push('default');
    }

    auditConfigChange(getAdminUser(req), 'POST /api/rainbow/config/reload', null, { profiles: reloaded });
    ok(res, { reloaded, message: `Config reloaded from DB for ${reloaded.length} profile(s)` });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
