/**
 * US-408: Flow Registry
 *
 * Central registry for all multi-step conversational flows.
 * Maps flow type identifiers to Flow implementations.
 * Detects active flows from ConversationState (both legacy fields and unified activeFlow).
 */
import type { Flow, FlowState } from '../pipeline/types.js';
import type { ConversationState } from '../types.js';

export interface ActiveFlowMatch {
  flow: Flow;
  state: any;
  flowType: string;
}

class FlowRegistry {
  private flows = new Map<string, Flow>();

  /** Register a flow implementation. */
  register(flow: Flow): void {
    if (this.flows.has(flow.type)) {
      console.warn(`[FlowRegistry] Overwriting existing flow: ${flow.type}`);
    }
    this.flows.set(flow.type, flow);
    console.log(`[FlowRegistry] Registered flow: ${flow.type}`);
  }

  /** Get a flow by type. */
  get(type: string): Flow | undefined {
    return this.flows.get(type);
  }

  /** List all registered flow types. */
  listTypes(): string[] {
    return Array.from(this.flows.keys());
  }

  /**
   * Detect the currently active flow from conversation state.
   *
   * Priority:
   * 1. convo.activeFlow (unified field for new flow types)
   * 2. convo.workflowState (legacy)
   * 3. convo.bookingState (legacy, if not done/cancelled)
   */
  getActiveFlow(convo: ConversationState): ActiveFlowMatch | null {
    // 1. Check unified activeFlow field
    if (convo.activeFlow) {
      const flow = this.flows.get(convo.activeFlow.flowType);
      if (flow && !flow.isComplete(convo.activeFlow.data)) {
        return { flow, state: convo.activeFlow.data, flowType: convo.activeFlow.flowType };
      }
    }

    // 2. Legacy: check workflowState
    if (convo.workflowState) {
      const flow = this.flows.get('workflow');
      if (flow) {
        return { flow, state: convo.workflowState, flowType: 'workflow' };
      }
    }

    // 3. Legacy: check bookingState (skip if done/cancelled)
    if (convo.bookingState && !['done', 'cancelled'].includes(convo.bookingState.stage)) {
      const flow = this.flows.get('booking');
      if (flow) {
        return { flow, state: convo.bookingState, flowType: 'booking' };
      }
    }

    return null;
  }
}

/** Singleton flow registry instance. */
export const flowRegistry = new FlowRegistry();
