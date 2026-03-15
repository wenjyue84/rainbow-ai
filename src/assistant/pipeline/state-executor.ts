/**
 * Pipeline Phase 2: Active State Execution
 *
 * Handles: feedback detection, active flow continuation (unified),
 * emergency regex detection.
 *
 * US-408: Booking and workflow flows are now handled through a single
 * unified flow dispatch via the Flow interface and FlowRegistry.
 *
 * If any state handler fires, it sends a response and returns { handled: true }.
 * Otherwise returns { handled: false } to continue to classification.
 */
import axios from 'axios';
import type { RouterContext, PipelineState, StateResult, FlowContext } from './types.js';
import { ensureResponseText } from './input-validator.js';
import { addMessage, updateBookingState, updateWorkflowState, updateActiveFlow } from '../conversation.js';
import { logMessage } from '../conversation-logger.js';
import { getEmergencyIntent } from '../intents.js';
import { escalateToStaff } from '../escalation.js';
import { createWorkflowState, type WorkflowContext } from '../workflow-executor.js';
import { flowRegistry } from '../flows/index.js';
import {
  isAwaitingFeedback, detectFeedbackResponse, buildFeedbackData,
  clearAwaitingFeedback
} from '../feedback.js';
import { trackIntentPrediction, markIntentCorrection, markIntentCorrect } from '../intent-tracker.js';
import { trackFeedback, trackEmergency, trackWorkflowStarted } from '../../lib/activity-tracker.js';

export async function handleActiveStates(
  state: PipelineState, ctx: RouterContext
): Promise<StateResult> {
  const { requestId, phone, processText, convo, lang, text, msg, profileConfig, profileId } = state;

  // ─── FEEDBACK DETECTION ─────────────────────────────────────────
  if (isAwaitingFeedback(phone)) {
    const feedbackRating = detectFeedbackResponse(processText);
    if (feedbackRating !== null) {
      console.log(`[Feedback] ${feedbackRating === 1 ? '👍' : '👎'} from ${phone}`);
      trackFeedback(phone, msg.pushName, feedbackRating);

      const feedbackData = buildFeedbackData(phone, feedbackRating, processText);
      if (feedbackData) {
        try {
          const port = process.env.PORT || 3002;
          await axios.post(`http://localhost:${port}/api/rainbow/feedback`, feedbackData);
          console.log(`[Feedback] ✅ Saved to database`);

          if (feedbackData.conversationId) {
            const convId = feedbackData.conversationId as string;
            if (feedbackRating === -1) {
              markIntentCorrection(convId, 'unknown', 'feedback').catch(() => { });
            } else {
              markIntentCorrect(convId).catch(() => { });
            }
          }
        } catch (error) {
          console.error(`[Feedback] ❌ Failed to save:`, error);
        }
      }

      clearAwaitingFeedback(phone);

      const thankYouMessages: Record<string, string> = {
        en: feedbackRating === 1
          ? 'Thank you for your feedback! 😊'
          : 'Thank you for your feedback. I\'ll work on improving! 😊',
        ms: feedbackRating === 1
          ? 'Terima kasih atas maklum balas anda! 😊'
          : 'Terima kasih atas maklum balas anda. Saya akan cuba memperbaiki! 😊',
        zh: feedbackRating === 1
          ? '谢谢您的反馈！😊'
          : '谢谢您的反馈。我会努力改进！😊',
        ta: feedbackRating === 1
          ? 'உங்கள் கருத்துக்கு நன்றி! 😊'
          : 'உங்கள் கருத்துக்கு நன்றி. மேம்படுத்த முயற்சிப்பேன்! 😊',
      };
      const thankYou = thankYouMessages[lang] || thankYouMessages.en;
      await ctx.sendMessage(phone, thankYou, msg.instanceId);
      return { handled: true };
    }
  }

  // ─── US-408: UNIFIED ACTIVE FLOW DISPATCH ─────────────────────────
  const activeFlow = flowRegistry.getActiveFlow(convo);
  if (activeFlow) {
    const { flow, state: flowState, flowType } = activeFlow;

    const flowContext: FlowContext = {
      language: lang,
      phone,
      pushName: msg.pushName,
      instanceId: msg.instanceId,
      messages: convo.messages,
      profileId,
      profileConfig,
      sendMessage: ctx.sendMessage,
    };

    const result = await flow.executeStep(flowState, text, flowContext);
    const action = result.newState ? flowType : `${flowType}_complete`;

    // Update state — use legacy updaters for backward compatibility
    if (flowType === 'booking') {
      updateBookingState(phone, result.newState, profileId);
    } else if (flowType === 'workflow') {
      updateWorkflowState(phone, result.newState, profileId);
    } else {
      // Generic flow types use the unified activeFlow field
      updateActiveFlow(phone, result.newState ? { flowType, data: result.newState } : null, profileId);
    }

    addMessage(phone, 'assistant', result.response, profileId);
    logMessage(phone, msg.pushName, 'assistant', result.response, {
      action, instanceId: msg.instanceId, profileId,
      ...(msg.bsuid ? { bsuid: msg.bsuid } : {}),
    }).catch(() => { });

    const cleanResponse = ensureResponseText(result.response, lang);
    await ctx.sendMessage(phone, cleanResponse, msg.instanceId);
    return { handled: true };
  }

  // ─── EMERGENCY CHECK (regex, instant) ───────────────────────────
  const emergencyIntent = getEmergencyIntent(processText);
  if (emergencyIntent !== null) {
    console.log(`[Router] [${requestId}] EMERGENCY detected for ${phone}: ${emergencyIntent}`);
    trackEmergency(phone, msg.pushName);
    await escalateToStaff({
      phone, pushName: msg.pushName,
      reason: (emergencyIntent === 'theft_report' ? 'theft' : 'complaint') as any,
      recentMessages: convo.messages.map(m => `${m.role}: ${m.content}`),
      originalMessage: text, instanceId: msg.instanceId
    });

    // If the emergency has a dedicated workflow, route directly
    const routingConfig = profileConfig.getRouting();
    const route = routingConfig[emergencyIntent];
    if (route?.action === 'workflow' && route.workflow_id) {
      const workflows = profileConfig.getWorkflows();
      const workflow = workflows.workflows.find(w => w.id === route.workflow_id);
      if (workflow) {
        console.log(`[Router] Emergency → workflow: ${workflow.name} (${route.workflow_id})`);
        trackWorkflowStarted(phone, msg.pushName, workflow.name);
        const workflowState = createWorkflowState(route.workflow_id);

        // Use the workflow flow from the registry for emergency workflows too
        const workflowFlow = flowRegistry.get('workflow');
        if (workflowFlow) {
          const flowContext: FlowContext = {
            language: lang, phone, pushName: msg.pushName,
            instanceId: msg.instanceId, messages: convo.messages,
            profileId, profileConfig, sendMessage: ctx.sendMessage,
          };
          // Start the workflow (passing null as initial input)
          const wfCtx: WorkflowContext = { language: lang, phone, pushName: msg.pushName, instanceId: msg.instanceId };
          const { executeWorkflowStep } = await import('../workflow-executor.js');
          const workflowResult = await executeWorkflowStep(workflowState, null, wfCtx);

          if (workflowResult.newState) {
            updateWorkflowState(phone, workflowResult.newState, profileId);
          }

          const cleanResponse = ensureResponseText(workflowResult.response, lang);
          addMessage(phone, 'assistant', cleanResponse, profileId);
          logMessage(phone, msg.pushName, 'assistant', cleanResponse, { action: 'workflow', instanceId: msg.instanceId, profileId, ...(msg.bsuid ? { bsuid: msg.bsuid } : {}) }).catch(() => { });
          await ctx.sendMessage(phone, cleanResponse, msg.instanceId);
          return { handled: true };
        }
      }
    }
    // For other emergencies (fire, medical, etc.), fall through to LLM
  }

  return { handled: false };
}
