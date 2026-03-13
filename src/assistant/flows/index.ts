/**
 * US-408: Flow System Initialization
 *
 * Registers all flow implementations with the flow registry.
 * Import this module at startup to activate the flow system.
 */
import { flowRegistry } from './registry.js';
import { bookingFlow } from './booking-flow.js';
import { workflowFlow } from './workflow-flow.js';
import { surveyFlow } from './survey-flow.js';

export function initFlows(): void {
  flowRegistry.register(bookingFlow);
  flowRegistry.register(workflowFlow);
  flowRegistry.register(surveyFlow);
  console.log(`[Flows] Initialized ${flowRegistry.listTypes().length} flow(s): ${flowRegistry.listTypes().join(', ')}`);
}

export { flowRegistry } from './registry.js';
export type { ActiveFlowMatch } from './registry.js';
