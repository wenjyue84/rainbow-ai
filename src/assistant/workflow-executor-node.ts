/**
 * workflow-executor-node.ts — Node-based workflow execution (US-017)
 *
 * Handles: executeNodeWorkflowStep, callAPIWrapper,
 *          syncWorkflowDataToContact, getTimeoutEscalationMessage
 *
 * Extracted from workflow-executor.ts to keep that file manageable.
 * workflow-executor.ts imports from here (one-way dependency, no circular).
 */

import type { SendMessageFn } from './types.js';
import type { WorkflowStep } from './config-store.js';
import { enhanceWorkflowStep } from './workflow-enhancer.js';
import type { WorkflowEnhancerContext } from './workflow-enhancer.js';
import { callAPI as httpClientCallAPI } from '../lib/http-client.js';
import { executeWithTimeout, WorkflowTimeoutError, logTimeoutFailure } from './workflow-timeout-handler.js';
import { logMessage } from './conversation-logger.js';
import { recordStepMetric } from './workflow-profiler.js';
import type {
  HybridWorkflowDefinition,
  MessageNodeConfig, WaitReplyNodeConfig, WhatsAppSendNodeConfig,
  PelangiApiNodeConfig, ConditionNodeConfig,
} from './workflow-nodes.js';
import {
  getNodeById, getNextNodeId, resolveTemplateVars, resolveVariableRef,
} from './workflow-nodes.js';
// Type-only import — erased at runtime, no circular dep at module load
import type { WorkflowState, WorkflowExecutionResult, WorkflowContext } from './workflow-executor.js';

// ─── callAPIWrapper ─────────────────────────────────────────────────────────

/** Adapt http-client callAPI to the signature expected by workflow-enhancer. */
export async function callAPIWrapper(url: string, options?: RequestInit): Promise<any> {
  const method = options?.method || 'GET';
  const body = options?.body ? JSON.parse(options.body as string) : undefined;
  return httpClientCallAPI(method, url, body);
}

// ─── US-089: Auto-update contact details from workflow data ─────────────────

const WORKFLOW_CONTACT_MAPPINGS: Record<string, string> = {
  'check_in_date': 'checkIn',
  'checkin_date': 'checkIn',
  'checkin': 'checkIn',
  'check_out_date': 'checkOut',
  'checkout_date': 'checkOut',
  'checkout': 'checkOut',
  'capsule': 'unit',
  'unit': 'unit',
  'room': 'unit',
  'capsule_number': 'unit',
  'guest_name': 'name',
  'name': 'name',
  'email': 'email',
};

const WORKFLOW_STATUS_MAP: Record<string, string> = {
  'booking': 'Booked',
  'book_room': 'Booked',
  'checkin': 'Checked In',
  'check_in': 'Checked In',
  'checkout': 'Checked Out',
  'check_out': 'Checked Out',
};

export async function syncWorkflowDataToContact(
  phone: string | undefined,
  workflowId: string,
  collectedData: Record<string, string>,
  nodeOutputs?: Record<string, any>
): Promise<void> {
  if (!phone) return;

  try {
    const { updateContactDetails } = await import('./conversation-logger.js');
    const updates: Record<string, any> = {};

    for (const [stepId, value] of Object.entries(collectedData)) {
      const field = WORKFLOW_CONTACT_MAPPINGS[stepId];
      if (field && value) {
        updates[field] = value;
      }
    }

    if (nodeOutputs) {
      for (const [key, value] of Object.entries(nodeOutputs)) {
        const field = WORKFLOW_CONTACT_MAPPINGS[key];
        if (field && value) {
          updates[field] = String(value);
        }
      }
    }

    const status = WORKFLOW_STATUS_MAP[workflowId];
    if (status) {
      updates.contactStatus = status;
    }

    if (Object.keys(updates).length > 0) {
      await updateContactDetails(phone, updates);
      console.log(`[WorkflowExecutor] US-089: Auto-updated contact for ${phone}:`, Object.keys(updates));
    }
  } catch (err) {
    console.error('[WorkflowExecutor] US-089: Failed to sync contact:', err);
  }
}

// ─── US-120: Timeout Escalation Message ─────────────────────────────────────

export function getTimeoutEscalationMessage(language: string): string {
  const messages: Record<string, string> = {
    en: 'Sorry, something took too long to process. Our team will handle your request manually. Please stand by.',
    ms: 'Maaf, sesuatu mengambil terlalu lama untuk diproses. Tim kami akan mengendalikan permintaan anda secara manual. Sila tunggu.',
    zh: '抱歉，处理过程花了太长时间。我们的团队将手动处理您的请求。请稍候。'
  };
  return messages[language] || messages.en;
}

// ============================================================================
// Node-Based Workflow Executor (US-017)
// ============================================================================

export async function executeNodeWorkflowStep(
  workflow: HybridWorkflowDefinition,
  state: WorkflowState,
  userMessage: string | null,
  context: WorkflowContext,
  sendMessageFn: SendMessageFn | null,
): Promise<WorkflowExecutionResult> {
  const { language, phone, pushName, instanceId } = context;

  const nodes = workflow.nodes!;
  const nodeOutputs = state.nodeOutputs || {};

  // If we're resuming after a wait_reply, store the user's response
  if (userMessage && state.currentNodeId) {
    const currentNode = getNodeById(nodes, state.currentNodeId);
    if (currentNode?.type === 'wait_reply') {
      const config = currentNode.config as WaitReplyNodeConfig;
      state.collectedData[config.storeAs] = userMessage;
      // US-027: Normalize booking dates to ISO 8601 alongside raw input
      if (config.storeAs === 'booking_dates') {
        const { normalizeDates } = await import('../lib/date-normalizer.js');
        const normalized = normalizeDates(userMessage);
        if (normalized.ok) {
          state.collectedData['booking_dates_normalized'] = JSON.stringify({
            checkIn: normalized.checkIn,
            checkOut: normalized.checkOut,
          });
        }
      }
      // US-089: Sync collected data to contact details
      syncWorkflowDataToContact(phone, state.workflowId, state.collectedData, nodeOutputs);
      // Advance to next node after wait_reply
      const nextId = getNextNodeId(currentNode);
      if (nextId) {
        state.currentNodeId = nextId;
      } else {
        // wait_reply was the last node — workflow complete
        return {
          response: '',
          newState: null,
          shouldForward: true,
          workflowId: state.workflowId,
        };
      }
    }
  }

  // Template context for variable resolution
  const templateCtx = {
    collectedData: state.collectedData,
    nodeOutputs,
    phone,
    pushName: pushName || 'Guest',
    language,
    adminPhone: '+60127088789',
  };

  // Walk the node graph until we hit a wait_reply or reach the end
  const responseParts: string[] = [];
  let safetyCounter = 0;
  const MAX_NODES = 50; // Prevent infinite loops

  while (state.currentNodeId && safetyCounter < MAX_NODES) {
    safetyCounter++;
    const node = getNodeById(nodes, state.currentNodeId);

    if (!node) {
      console.error(`[NodeExecutor] Node ${state.currentNodeId} not found in workflow ${workflow.id}`);
      break;
    }

    console.log(`[NodeExecutor] Executing node: ${node.id} (${node.type}) — ${node.label}`);

    switch (node.type) {
      case 'message': {
        const config = node.config as MessageNodeConfig;
        const msg = config.message;
        const text = (language === 'ms' && msg.ms) ? msg.ms : (language === 'zh' && msg.zh) ? msg.zh : msg.en;
        responseParts.push(resolveTemplateVars(text, templateCtx));

        const nextId = getNextNodeId(node);
        state.currentNodeId = nextId;
        break;
      }

      case 'wait_reply': {
        const config = node.config as WaitReplyNodeConfig;
        if (config.prompt) {
          const text = (language === 'ms' && config.prompt.ms)
            ? config.prompt.ms
            : (language === 'zh' && config.prompt.zh)
            ? config.prompt.zh
            : config.prompt.en;
          responseParts.push(resolveTemplateVars(text, templateCtx));
        }

        // PAUSE execution — wait for user reply
        return {
          response: responseParts.join('\n\n'),
          newState: {
            ...state,
            nodeOutputs,
            isNodeBased: true,
            lastUpdateAt: Date.now(),
          },
          workflowId: state.workflowId,
          stepId: node.id,
        };
      }

      case 'whatsapp_send': {
        const config = node.config as WhatsAppSendNodeConfig;

        if (sendMessageFn && phone) {
          const receiver = resolveVariableRef(config.receiver, templateCtx);

          let content: string;
          if (typeof config.content === 'string') {
            content = resolveTemplateVars(config.content, templateCtx);
          } else {
            const raw = (language === 'ms' && config.content.ms)
              ? config.content.ms
              : (language === 'zh' && config.content.zh)
              ? config.content.zh
              : config.content.en;
            content = resolveTemplateVars(raw, templateCtx);
          }

          try {
            await sendMessageFn(receiver, content, instanceId);
            console.log(`[NodeExecutor] WhatsApp sent to ${receiver}`);
            if (node.outputs) {
              nodeOutputs['whatsappSent'] = true;
              nodeOutputs['whatsappReceiver'] = receiver;
            }
          } catch (err) {
            console.error(`[NodeExecutor] WhatsApp send failed:`, err);
            const errorNext = getNextNodeId(node, false);
            if (errorNext) {
              state.currentNodeId = errorNext;
              continue;
            }
          }
        }

        state.currentNodeId = getNextNodeId(node);
        break;
      }

      case 'pelangi_api': {
        const config = node.config as PelangiApiNodeConfig;

        const maxDurationMs = (node as any).max_duration_ms || 30000;

        const nodeStartTime = Date.now();
        const nodeInputSize = JSON.stringify({ collectedData: state.collectedData, nodeOutputs }).length;

        try {
          const enhancerCtx: WorkflowEnhancerContext = {
            workflowId: state.workflowId,
            stepId: node.id,
            userInput: userMessage,
            collectedData: state.collectedData,
            language,
            phone: phone || '',
            pushName: pushName || 'Guest',
            instanceId,
          };

          const syntheticStep: WorkflowStep = {
            id: node.id,
            message: { en: '', ms: '', zh: '' },
            waitForReply: false,
            action: { type: config.action, params: config.params },
          };

          const enhanced = await executeWithTimeout(
            () => enhanceWorkflowStep(
              syntheticStep,
              enhancerCtx,
              callAPIWrapper,
              sendMessageFn!
            ),
            node.id,
            maxDurationMs
          );

          if (enhanced.metadata) {
            for (const [key, value] of Object.entries(enhanced.metadata)) {
              nodeOutputs[key] = value;
              nodeOutputs[`pelangi.${key}`] = value;
            }
          }

          if (node.outputs) {
            for (const [outputName, dataKey] of Object.entries(node.outputs)) {
              nodeOutputs[outputName] = nodeOutputs[dataKey] ?? enhanced.metadata?.[dataKey] ?? '';
            }
          }

          const nodeDuration = Date.now() - nodeStartTime;
          const nodeOutputSize = JSON.stringify(nodeOutputs).length;
          recordStepMetric({
            stepId: node.id,
            stepType: `pelangi_api:${config.action}`,
            durationMs: nodeDuration,
            inputSize: nodeInputSize,
            outputSize: nodeOutputSize,
            stateSnapshot: {
              collectedDataKeys: Object.keys(state.collectedData),
              nodeOutputKeys: Object.keys(nodeOutputs),
              workflowId: state.workflowId,
            },
            timestamp: Date.now(),
            workflowId: state.workflowId,
            conversationId: phone,
          });

          console.log(`[NodeExecutor] pelangi_api (${config.action}) completed, outputs:`, Object.keys(nodeOutputs));

          state.currentNodeId = getNextNodeId(node, true);
        } catch (err) {
          if (err instanceof WorkflowTimeoutError) {
            console.error(`[NodeExecutor] US-120: Node timeout:`, err.message);

            try {
              const failureLog = logTimeoutFailure(
                node.id,
                err.maxDurationMs,
                err.actualDurationMs,
                state.workflowId
              );

              if (phone) {
                await logMessage(
                  phone,
                  pushName || 'Guest',
                  'assistant',
                  getTimeoutEscalationMessage(language),
                  {
                    messageType: 'escalation',
                    workflowId: state.workflowId,
                    stepId: node.id,
                    action: 'timeout_escalation',
                    source: 'workflow_timeout',
                    ...(failureLog as any)
                  }
                );
              }
            } catch (logErr) {
              console.error(`[NodeExecutor] US-120: Failed to log timeout event:`, logErr);
            }

            responseParts.push(getTimeoutEscalationMessage(language));
            return {
              response: responseParts.join('\n\n'),
              newState: null,
              shouldForward: true,
              workflowId: state.workflowId,
              stepId: node.id
            };
          }

          console.error(`[NodeExecutor] pelangi_api failed:`, err);
          nodeOutputs['apiError'] = err instanceof Error ? err.message : 'Unknown error';

          const errorNext = getNextNodeId(node, false);
          state.currentNodeId = errorNext || getNextNodeId(node, true);
        }
        break;
      }

      case 'condition': {
        const config = node.config as ConditionNodeConfig;

        const fieldValue = resolveTemplateVars(config.field, templateCtx);

        let conditionMet = false;
        switch (config.operator) {
          case 'gt':
            conditionMet = parseFloat(fieldValue) > (config.value as number);
            break;
          case 'lt':
            conditionMet = parseFloat(fieldValue) < (config.value as number);
            break;
          case 'eq':
            conditionMet = fieldValue === String(config.value);
            break;
          case 'neq':
            conditionMet = fieldValue !== String(config.value);
            break;
          case 'exists':
            conditionMet = !!fieldValue && fieldValue !== '';
            break;
          case 'empty':
            conditionMet = !fieldValue || fieldValue === '';
            break;
          case 'regex':
            try {
              conditionMet = new RegExp(String(config.value), 'i').test(fieldValue);
            } catch {
              conditionMet = false;
            }
            break;
          case 'dateConflict': {
            // US-038: Check for date range conflicts in booking workflow
            try {
              const { dateRangeConflict } = await import('./pipeline/booking-validators.js');
              const bookingDates = state.collectedData.booking_dates || '';

              if (bookingDates) {
                const result = await dateRangeConflict(bookingDates, 'pelangi');
                conditionMet = !result.hasConflict;
                console.log(`[NodeExecutor] dateConflict check: ${bookingDates} → ${conditionMet ? 'OK' : 'CONFLICT'}`);
              } else {
                conditionMet = true;
              }
            } catch (err) {
              console.error('[NodeExecutor] dateConflict operator failed:', err);
              conditionMet = true;
            }
            break;
          }
        }

        console.log(`[NodeExecutor] Condition: ${config.field} ${config.operator} ${config.value} → ${conditionMet}`);

        state.currentNodeId = conditionMet ? config.trueNext : config.falseNext;
        break;
      }

      default:
        console.warn(`[NodeExecutor] Unknown node type: ${node.type}`);
        state.currentNodeId = getNextNodeId(node);
    }

    if (!state.currentNodeId) break;
  }

  if (safetyCounter >= MAX_NODES) {
    console.error(`[NodeExecutor] Safety limit reached (${MAX_NODES} nodes) in workflow ${workflow.id}`);
  }

  return {
    response: responseParts.join('\n\n'),
    newState: null,
    shouldForward: true,
    workflowId: state.workflowId,
  };
}
