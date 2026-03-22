/**
 * Workflow step dependency validator with circular-reference detection.
 * Validates workflows.json structures to prevent execution failures.
 *
 * Cycle severity:
 *   - 'error': Cycle through only non-blocking nodes (infinite loop — will crash)
 *   - 'warning': Cycle that passes through at least one blocking node (wait_reply,
 *     collect_input) — intentional reprompt loop, safe but noted
 */

/** Node types that block execution waiting for user input (safe to loop through). */
const BLOCKING_NODE_TYPES = new Set(['wait_reply', 'collect_input']);

export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly workflowId: string,
    public readonly details: string[]
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

interface WorkflowNode {
  id: string;
  type: string;
  next?: string | null;
  config?: {
    trueNext?: string | null;
    falseNext?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Workflow {
  id: string;
  name?: string;
  startNodeId?: string;
  nodes?: WorkflowNode[];
  [key: string]: unknown;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function getNodeNextRefs(node: WorkflowNode): string[] {
  const refs: string[] = [];
  if (node.next && typeof node.next === 'string') refs.push(node.next);
  if (node.config) {
    if (node.config.trueNext && typeof node.config.trueNext === 'string') refs.push(node.config.trueNext);
    if (node.config.falseNext && typeof node.config.falseNext === 'string') refs.push(node.config.falseNext);
  }
  return refs;
}

function cycleIsRepromptLoop(cyclePath: string[], nodeTypeMap: Map<string, string>): boolean {
  return cyclePath.some(id => BLOCKING_NODE_TYPES.has(nodeTypeMap.get(id) ?? ''));
}

function detectCycles(graph: Map<string, string[]>, nodeIds: Set<string>): string[][] {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const reportedCycles = new Set<string>();

  for (const id of nodeIds) color.set(id, WHITE);

  const path: string[] = [];

  function dfs(nodeId: string): void {
    color.set(nodeId, GREY);
    path.push(nodeId);

    for (const neighbor of (graph.get(nodeId) ?? [])) {
      if (!color.has(neighbor)) continue;
      if (color.get(neighbor) === GREY) {
        const cycleStart = path.indexOf(neighbor);
        const cyclePath = [...path.slice(cycleStart), neighbor];
        const cycleKey = cyclePath.slice(0, -1).sort().join(',');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          cycles.push(cyclePath);
        }
      } else if (color.get(neighbor) === WHITE) {
        dfs(neighbor);
      }
    }

    path.pop();
    color.set(nodeId, BLACK);
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) dfs(id);
  }

  return cycles;
}

export function validateWorkflowStepDependencies(workflow: Workflow): ValidationResult {
  if (!workflow.nodes || workflow.nodes.length === 0) return { errors: [], warnings: [] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set<string>(workflow.nodes.map(n => n.id));
  const nodeTypeMap = new Map<string, string>(workflow.nodes.map(n => [n.id, n.type]));
  const graph = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    const refs = getNodeNextRefs(node);
    graph.set(node.id, refs);
    for (const ref of refs) {
      if (!nodeIds.has(ref)) errors.push(`Node "${node.id}" references undefined node "${ref}"`);
    }
  }

  if (workflow.startNodeId && !nodeIds.has(workflow.startNodeId)) {
    errors.push(`startNodeId "${workflow.startNodeId}" does not exist in nodes`);
  }

  const cycles = detectCycles(graph, nodeIds);
  for (const cyclePath of cycles) {
    const pathStr = cyclePath.join(' → ');
    if (cycleIsRepromptLoop(cyclePath, nodeTypeMap)) {
      warnings.push(`Reprompt loop (safe): ${pathStr}`);
    } else {
      errors.push(`Circular dependency detected: ${pathStr}`);
    }
  }

  if (errors.length > 0) {
    throw new WorkflowValidationError(
      `Workflow "${workflow.id}" has ${errors.length} validation error(s)`,
      workflow.id,
      errors
    );
  }

  return { errors: [], warnings };
}

export interface WorkflowValidationReport {
  errors: WorkflowValidationError[];
  warnings: Array<{ workflowId: string; warnings: string[] }>;
}

export function validateAllWorkflows(data: { workflows: Workflow[] }): WorkflowValidationReport {
  const report: WorkflowValidationReport = { errors: [], warnings: [] };

  for (const workflow of data.workflows ?? []) {
    try {
      const result = validateWorkflowStepDependencies(workflow);
      if (result.warnings.length > 0) {
        report.warnings.push({ workflowId: workflow.id, warnings: result.warnings });
      }
    } catch (err) {
      if (err instanceof WorkflowValidationError) {
        report.errors.push(err);
      } else {
        throw err;
      }
    }
  }

  return report;
}
