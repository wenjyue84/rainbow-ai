/**
 * Zod schemas for all RainbowAI config files.
 *
 * Types are derived from schemas using z.infer<>, replacing the manual
 * interfaces that were previously in config-store.ts.
 *
 * Validation strategy:
 * - On load: safeParse() with warn + fallback (don't crash startup)
 * - On setter: safeParse() with throw (admin writes must be strict)
 */
import { z } from 'zod';

// ─── Shared ─────────────────────────────────────────────────────────

const trilingualSchema = z.object({
  en: z.string(),
  ms: z.string(),
  zh: z.string(),
});

// ─── Knowledge ──────────────────────────────────────────────────────

export const knowledgeDataSchema = z.object({
  static: z.array(z.object({
    intent: z.string(),
    response: trilingualSchema,
    imageUrl: z.string().optional(),
  })),
  dynamic: z.record(z.string(), z.string()),
});
export type KnowledgeData = z.infer<typeof knowledgeDataSchema>;

// ─── Intents ────────────────────────────────────────────────────────

export const intentEntrySchema = z.object({
  category: z.string(),
  patterns: z.array(z.string()),
  flags: z.string(),
  enabled: z.boolean(),
  min_confidence: z.number().min(0).max(1).optional(),
  time_sensitive: z.boolean().optional(),
}).passthrough();  // Allow extra fields (professional_term, t2_fuzzy_threshold, etc.)
export type IntentEntry = z.infer<typeof intentEntrySchema>;

export const intentsDataSchema = z.object({
  categories: z.array(z.object({
    phase: z.string().optional(),
    description: z.string().optional(),
    intents: z.array(intentEntrySchema).optional(),
    // Top-level intent entries (some categories are flat)
  }).passthrough()),
});
export type IntentsData = z.infer<typeof intentsDataSchema>;

// ─── Templates ──────────────────────────────────────────────────────

export const templatesDataSchema = z.record(z.string(), trilingualSchema);
export type TemplatesData = z.infer<typeof templatesDataSchema>;

// ─── AI Provider ────────────────────────────────────────────────────

export const aiProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.string(), // 'openai-compatible' | 'groq' | 'ollama' — kept loose for extensibility
  api_key_env: z.string(),
  api_key: z.string().optional(),
  base_url: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  priority: z.number().int().min(0),
  available: z.boolean().optional(),
  timeout_ms: z.number().int().min(1000).optional(), // Per-provider latency threshold (default: 6000ms)
});
export type AIProvider = z.infer<typeof aiProviderSchema>;

// ─── Routing Mode ───────────────────────────────────────────────────

export const routingModeSchema = z.object({
  splitModel: z.boolean(),
  classifyProvider: z.string(),
  tieredPipeline: z.boolean(),
});
export type RoutingMode = z.infer<typeof routingModeSchema>;

// ─── Experiments (US-837) ────────────────────────────────────────────

export const experimentVariantSchema = z.object({
  id: z.string().min(1),
  weight: z.number().int().positive(),
  systemPromptOverride: z.string().min(1),
});
export type ExperimentVariant = z.infer<typeof experimentVariantSchema>;

export const experimentSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
  variants: z.array(experimentVariantSchema).min(1),
});
export type Experiment = z.infer<typeof experimentSchema>;

export const experimentsConfigSchema = z.array(experimentSchema).optional().default([]);

// ─── Settings ───────────────────────────────────────────────────────

export const settingsDataSchema = z.object({
  ai: z.object({
    nvidia_model: z.string(),
    nvidia_base_url: z.string(),
    groq_model: z.string(),
    max_classify_tokens: z.number().int().positive(),
    max_chat_tokens: z.number().int().positive(),
    classify_temperature: z.number().min(0).max(2),
    chat_temperature: z.number().min(0).max(2),
    providers: z.array(aiProviderSchema).optional(),
    slow_response_message: z.string().optional(),
  }),
  routing_mode: routingModeSchema.optional(),
  ocr_provider: z.object({
    id: z.string(),
    model: z.string(),
    description: z.string().optional(),
  }).optional(),
  system_prompt: z.string(),
  rate_limits: z.object({
    per_minute: z.number().int().positive(),
    per_hour: z.number().int().positive(),
  }),
  staff: z.object({
    phones: z.array(z.string()),
    jay_phone: z.string(),
    alston_phone: z.string(),
  }),
  conversation_management: z.object({
    enabled: z.boolean(),
    summarize_threshold: z.number().int(),
    summarize_from_message: z.number().int(),
    summarize_to_message: z.number().int(),
    keep_verbatim_from: z.number().int(),
    keep_verbatim_to: z.number().int(),
    description: z.string().optional(),
  }).optional(),
  sentiment_analysis: z.object({
    enabled: z.boolean(),
    consecutive_threshold: z.number().int(),
    cooldown_minutes: z.number().int(),
    description: z.string().optional(),
  }).optional(),
  failover: z.object({
    enabled: z.boolean(),
    heartbeatIntervalMs: z.number().int().positive(),
    failoverThresholdMs: z.number().int().positive(),
    handbackMode: z.enum(['immediate', 'grace']),
    handbackGracePeriodMs: z.number().int().nonnegative(),
  }).optional(),
  // US-449: Per-profile WhatsApp instance assignment
  whatsappInstanceId: z.string().optional(),
  // US-837: A/B experiment framework
  experiments: experimentsConfigSchema.optional(),
  // US-838: Configurable data retention policy
  retention: z.object({
    enabled: z.boolean(),
    retention_days: z.number().int().min(30).max(3650),
    grace_period_days: z.number().int().min(7).max(365),
  }).optional(),
}).passthrough();  // Allow unknown keys (response_modes, feedback, etc.)
export type SettingsData = z.infer<typeof settingsDataSchema>;

// ─── Routing ────────────────────────────────────────────────────────

export const routingActionSchema = z.string(); // Kept loose — 'static_reply' | 'llm_reply' | 'workflow' | 'escalate' | 'forward_payment' | 'start_booking' | 'reply'
export type RoutingAction = string;

export const routingDataSchema = z.record(
  z.string(),
  z.object({
    action: routingActionSchema,
    workflow_id: z.string().optional(),
  })
);
export type RoutingData = z.infer<typeof routingDataSchema>;

// ─── Workflow Step ──────────────────────────────────────────────────

export const workflowStepSchema = z.object({
  id: z.string(),
  message: trilingualSchema,
  waitForReply: z.boolean(),
  action: z.object({
    type: z.string(),
    params: z.record(z.string(), z.any()).optional(),
  }).optional(),
  evaluation: z.object({
    prompt: z.string(),
    outcomes: z.record(z.string(), z.string()),
    defaultNextId: z.string(),
  }).optional(),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

// Node schema for node-based workflows (n8n-inspired)
export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['message', 'wait_reply', 'whatsapp_send', 'pelangi_api', 'condition']),
  label: z.string(),
  config: z.any(),
  next: z.union([
    z.string(),
    z.object({ success: z.string(), error: z.string().optional() }),
  ]).optional(),
  outputs: z.record(z.string(), z.string()).optional(),
});

export const workflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(workflowStepSchema),
  // Node-based workflow fields (optional — only for format: 'nodes')
  format: z.enum(['steps', 'nodes']).optional(),
  startNodeId: z.string().optional(),
  nodes: z.array(workflowNodeSchema).optional(),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const workflowsDataSchema = z.object({
  workflows: z.array(workflowDefinitionSchema),
});
export type WorkflowsData = z.infer<typeof workflowsDataSchema>;

// ─── Workflow (escalation/payment/booking config) ───────────────────

export const workflowDataSchema = z.object({
  escalation: z.object({
    timeout_ms: z.number().int().positive(),
    unknown_threshold: z.number().int().positive(),
    primary_phone: z.string(),
    secondary_phone: z.string(),
  }),
  payment: z.object({
    forward_to: z.string(),
    receipt_patterns: z.array(z.string()),
  }),
  booking: z.object({
    enabled: z.boolean(),
    max_guests_auto: z.number().int().positive(),
  }),
  non_text_handling: z.object({
    enabled: z.boolean(),
  }),
}).passthrough();
export type WorkflowData = z.infer<typeof workflowDataSchema>;

// ─── AI Response ───────────────────────────────────────────────────

export const aiResponseActionSchema = z.enum([
  'reply', 'static_reply', 'llm_reply', 'start_booking',
  'escalate', 'forward_payment', 'workflow'
]);
export type AIAction = z.infer<typeof aiResponseActionSchema>;

export const aiResponseSchema = z.object({
  intent: z.string().min(1),
  action: aiResponseActionSchema,
  response: z.string(),
  confidence: z.number().min(0).max(1),
});
export type AIResponse = z.infer<typeof aiResponseSchema>;

// ─── Routing Request Validation (Admin API) ─────────────────────────

const routingActionEnum = z.enum([
  'static_reply', 'llm_reply', 'workflow', 'escalate', 'forward_payment', 'start_booking',
]);

export const updateRoutingRequestSchema = z.record(
  z.string(),
  z.object({
    action: routingActionEnum,
    workflow_id: z.string().optional(),
  }).refine(
    data => data.action !== 'workflow' || data.workflow_id,
    { message: 'workflow_id required when action is workflow' }
  )
);

export const updateSingleRouteRequestSchema = z.object({
  action: routingActionEnum,
  workflow_id: z.string().optional(),
}).refine(
  data => data.action !== 'workflow' || data.workflow_id,
  { message: 'workflow_id required when action is workflow' }
);

// ─── LLM Classification Result ──────────────────────────────────────

export const classifyResultSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  entities: z.record(z.string(), z.unknown()).optional().default({}),
});
export type ClassifyResult = z.infer<typeof classifyResultSchema>;

// ─── LLM Reply-Only Result ─────────────────────────────────────────

export const replyOnlyResultSchema = z.object({
  response: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ReplyOnlyResult = z.infer<typeof replyOnlyResultSchema>;

// ─── LLM Booking Extraction Result ─────────────────────────────────

export const bookingExtractionSchema = z.object({
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  guests: z.number().int().positive().optional(),
  understood: z.boolean(),
});
export type BookingExtraction = z.infer<typeof bookingExtractionSchema>;

// ─── Safe LLM Response Parser ──────────────────────────────────────

export interface LLMParseSuccess<T> {
  success: true;
  data: T;
}

export interface LLMParseFailure {
  success: false;
  error: string;
}

export type LLMParseResult<T> = LLMParseSuccess<T> | LLMParseFailure;

/**
 * Safely parse a raw LLM response string through a Zod schema.
 * Logs structured validation errors with schema path and received value.
 * Returns { success, data } or { success: false, error }.
 */
export function safeParseLLMResponse<T>(
  raw: string,
  schema: z.ZodType<T>,
  context: string
): LLMParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try extracting JSON from mixed text (LLMs sometimes wrap in markdown)
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        console.warn(`[LLMValidation:${context}] Could not extract valid JSON from response`);
        return { success: false, error: 'Invalid JSON in LLM response' };
      }
    } else {
      console.warn(`[LLMValidation:${context}] No JSON found in response`);
      return { success: false, error: 'No JSON in LLM response' };
    }
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  // Log detailed validation errors with schema path and received value
  const issues = result.error.issues.map(issue => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    received: issue.path.reduce((obj: any, key) => obj?.[key], parsed),
  }));
  console.warn(
    `[LLMValidation:${context}] Schema validation failed:`,
    JSON.stringify(issues)
  );

  return { success: false, error: `Validation failed: ${issues.map(i => `${i.path}: ${i.message}`).join(', ')}` };
}

// ─── Schema Registry ────────────────────────────────────────────────

export const CONFIG_SCHEMAS = {
  'knowledge.json': knowledgeDataSchema,
  'intents.json': intentsDataSchema,
  'templates.json': templatesDataSchema,
  'settings.json': settingsDataSchema,
  'workflow.json': workflowDataSchema,
  'workflows.json': workflowsDataSchema,
  'routing.json': routingDataSchema,
} as const;
