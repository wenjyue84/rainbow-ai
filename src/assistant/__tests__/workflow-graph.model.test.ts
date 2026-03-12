/**
 * Workflow Graph — Model Checking Tests
 *
 * Loads the actual workflows.json data and verifies structural invariants
 * for both node-based and legacy step-based workflows:
 *   - Referential integrity of all next/trueNext/falseNext pointers
 *   - Start node existence
 *   - Full reachability from startNodeId (BFS)
 *   - Condition node completeness
 *   - No orphan nodes
 *   - Legacy step uniqueness and non-emptiness
 */
import { describe, it, expect } from 'vitest';
import { getNodeById, getNextNodeId, isNodeBasedWorkflow } from '../workflow-nodes.js';
import type { HybridWorkflowDefinition, WorkflowNode, ConditionNodeConfig } from '../workflow-nodes.js';
import workflowsData from '../data/workflows.json' with { type: 'json' };

// Type the imported data
const workflows = (workflowsData as any).workflows as HybridWorkflowDefinition[];

// ============================================================================
// Helper: Collect all target node IDs referenced by a node
// ============================================================================

function getReferencedNodeIds(node: WorkflowNode): string[] {
  const ids: string[] = [];

  // next pointer (string or {success, error})
  if (node.next) {
    if (typeof node.next === 'string') {
      ids.push(node.next);
    } else {
      if (node.next.success) ids.push(node.next.success);
      if (node.next.error) ids.push(node.next.error);
    }
  }

  // Condition node: trueNext and falseNext
  if (node.type === 'condition') {
    const config = node.config as ConditionNodeConfig;
    if (config.trueNext) ids.push(config.trueNext);
    if (config.falseNext) ids.push(config.falseNext);
  }

  return ids;
}

// ============================================================================
// Helper: BFS from startNodeId, returns set of reachable node IDs
// ============================================================================

function bfsReachable(nodes: WorkflowNode[], startNodeId: string): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const node = getNodeById(nodes, current);
    if (!node) continue;

    const targets = getReferencedNodeIds(node);
    for (const target of targets) {
      if (!visited.has(target)) {
        queue.push(target);
      }
    }
  }

  return visited;
}

// ============================================================================
// Tests
// ============================================================================

describe('Workflow Graph — Model Checking', () => {

  it('should have at least one workflow defined', () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  // ── Node-Based Workflow Tests ────────────────────────────────────────

  const nodeBasedWorkflows = workflows.filter(w => isNodeBasedWorkflow(w));
  const legacyWorkflows = workflows.filter(w => !isNodeBasedWorkflow(w));

  describe('Node-based workflows', () => {

    it('should have at least one node-based workflow', () => {
      expect(nodeBasedWorkflows.length).toBeGreaterThan(0);
    });

    describe.each(
      nodeBasedWorkflows.map(w => ({ id: w.id, name: w.name, workflow: w }))
    )('Workflow "$id" ($name)', ({ workflow }) => {

      const nodes = workflow.nodes!;
      const nodeIds = new Set(nodes.map(n => n.id));

      // ── Start node exists ───────────────────────────────────────

      it('startNodeId should point to an existing node', () => {
        expect(nodeIds.has(workflow.startNodeId!)).toBe(true);
      });

      // ── Referential integrity ───────────────────────────────────

      it('all next pointers should resolve to existing node IDs', () => {
        const broken: { nodeId: string; pointer: string; target: string }[] = [];

        for (const node of nodes) {
          const targets = getReferencedNodeIds(node);
          for (const target of targets) {
            if (!nodeIds.has(target)) {
              broken.push({
                nodeId: node.id,
                pointer: node.type === 'condition' ? 'trueNext/falseNext' : 'next',
                target,
              });
            }
          }
        }

        expect(broken).toEqual([]);
      });

      // ── All nodes reachable from startNodeId ────────────────────

      it('all nodes should be reachable from startNodeId via BFS', () => {
        const reachable = bfsReachable(nodes, workflow.startNodeId!);
        const unreachable = nodes.filter(n => !reachable.has(n.id));

        if (unreachable.length > 0) {
          console.warn(
            `[${workflow.id}] Unreachable nodes: ${unreachable.map(n => n.id).join(', ')}`
          );
        }

        expect(unreachable).toEqual([]);
      });

      // ── Condition node completeness ─────────────────────────────

      it('condition nodes should have valid trueNext and falseNext targets', () => {
        const conditionNodes = nodes.filter(n => n.type === 'condition');
        const issues: string[] = [];

        for (const node of conditionNodes) {
          const config = node.config as ConditionNodeConfig;

          if (!config.trueNext) {
            issues.push(`${node.id}: missing trueNext`);
          } else if (!nodeIds.has(config.trueNext)) {
            issues.push(`${node.id}: trueNext "${config.trueNext}" not found`);
          }

          if (!config.falseNext) {
            issues.push(`${node.id}: missing falseNext`);
          } else if (!nodeIds.has(config.falseNext)) {
            issues.push(`${node.id}: falseNext "${config.falseNext}" not found`);
          }
        }

        expect(issues).toEqual([]);
      });

      // ── No orphan nodes ─────────────────────────────────────────

      it('every node should be referenced by at least one other node (or be startNode)', () => {
        // Build set of all referenced targets
        const referenced = new Set<string>();
        referenced.add(workflow.startNodeId!); // startNode is always "referenced"

        for (const node of nodes) {
          const targets = getReferencedNodeIds(node);
          for (const target of targets) {
            referenced.add(target);
          }
        }

        const orphans = nodes.filter(n => !referenced.has(n.id));

        if (orphans.length > 0) {
          console.warn(
            `[${workflow.id}] Orphan nodes (not referenced by any other node): ${orphans.map(n => n.id).join(', ')}`
          );
        }

        expect(orphans).toEqual([]);
      });

      // ── Node IDs are unique ─────────────────────────────────────

      it('all node IDs should be unique', () => {
        const seen = new Set<string>();
        const duplicates: string[] = [];

        for (const node of nodes) {
          if (seen.has(node.id)) {
            duplicates.push(node.id);
          }
          seen.add(node.id);
        }

        expect(duplicates).toEqual([]);
      });

      // ── getNextNodeId consistency ───────────────────────────────

      it('getNextNodeId should return valid targets for non-terminal nodes', () => {
        const issues: string[] = [];

        for (const node of nodes) {
          if (!node.next && node.type !== 'condition') {
            // Terminal node — no next pointer is fine
            continue;
          }

          if (node.type === 'condition') {
            // Condition nodes branch via config, not via next
            continue;
          }

          const successNext = getNextNodeId(node, true);
          if (successNext && !nodeIds.has(successNext)) {
            issues.push(`${node.id}: getNextNodeId(success) -> "${successNext}" not found`);
          }

          const errorNext = getNextNodeId(node, false);
          if (errorNext && !nodeIds.has(errorNext)) {
            issues.push(`${node.id}: getNextNodeId(error) -> "${errorNext}" not found`);
          }
        }

        expect(issues).toEqual([]);
      });

      // ── Safety: graph should not exceed 50-node traversal limit ─

      it('linear path from startNode should not exceed 50 nodes (executor safety limit)', () => {
        const MAX_NODES = 50;
        const visited = new Set<string>();
        let current: string | undefined = workflow.startNodeId!;
        let count = 0;

        while (current && count < MAX_NODES + 1) {
          if (visited.has(current)) break; // Cycle detected — stop
          visited.add(current);
          count++;

          const node = getNodeById(nodes, current);
          if (!node) break;

          if (node.type === 'condition') {
            // Follow trueNext for worst-case path estimation
            const config = node.config as ConditionNodeConfig;
            current = config.trueNext;
          } else {
            current = getNextNodeId(node, true);
          }
        }

        expect(count).toBeLessThanOrEqual(MAX_NODES);
      });
    });
  });

  // ── Legacy Step-Based Workflow Tests ─────────────────────────────────

  describe('Legacy step-based workflows', () => {

    // Note: Some workflows have both steps and nodes (format: "nodes").
    // Pure legacy workflows are those without format: "nodes".
    // We test the steps arrays of ALL workflows that have them.
    const workflowsWithSteps = workflows.filter(
      w => Array.isArray(w.steps) && w.steps!.length > 0
    );

    it('should have at least one workflow with steps', () => {
      expect(workflowsWithSteps.length).toBeGreaterThan(0);
    });

    describe.each(
      workflowsWithSteps.map(w => ({ id: w.id, name: w.name, workflow: w }))
    )('Workflow "$id" ($name) — steps', ({ workflow }) => {
      const steps = workflow.steps!;

      it('steps array should be non-empty', () => {
        expect(steps.length).toBeGreaterThan(0);
      });

      it('all step IDs should be unique', () => {
        const seen = new Set<string>();
        const duplicates: string[] = [];

        for (const step of steps) {
          if (seen.has(step.id)) {
            duplicates.push(step.id);
          }
          seen.add(step.id);
        }

        expect(duplicates).toEqual([]);
      });

      it('every step should have a message with at least an English text', () => {
        const missing: string[] = [];

        for (const step of steps) {
          if (!step.message || !step.message.en) {
            missing.push(step.id);
          }
        }

        expect(missing).toEqual([]);
      });
    });
  });

  // ── Pure legacy workflows (no node-based format) ────────────────────

  describe('Pure legacy workflows (no nodes)', () => {
    const pureLegacy = workflows.filter(
      w => !isNodeBasedWorkflow(w) && (!w.format || w.format === 'steps')
    );

    if (pureLegacy.length > 0) {
      it.each(
        pureLegacy.map(w => ({ id: w.id, name: w.name, workflow: w }))
      )('$id should have steps but no nodes/startNodeId', ({ workflow }) => {
        expect(Array.isArray(workflow.steps)).toBe(true);
        expect(workflow.steps!.length).toBeGreaterThan(0);
        // Pure legacy should not have node-based fields active
        expect(isNodeBasedWorkflow(workflow)).toBe(false);
      });
    }
  });

  // ── Cross-workflow: unique workflow IDs ──────────────────────────────

  describe('Cross-workflow invariants', () => {
    it('all workflow IDs should be unique', () => {
      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const w of workflows) {
        if (seen.has(w.id)) {
          duplicates.push(w.id);
        }
        seen.add(w.id);
      }

      expect(duplicates).toEqual([]);
    });

    it('every workflow should have an id and name', () => {
      for (const w of workflows) {
        expect(w.id).toBeTruthy();
        expect(w.name).toBeTruthy();
      }
    });
  });
});
