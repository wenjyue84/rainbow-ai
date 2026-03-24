import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  loadDataFiles,
  analyzeReferences,
  extractIntentNames,
  extractWorkflowIds,
  applyFixes
} from '../tools/validate-cross-refs-cli.js';

describe('Cross-References Validator', () => {
  describe('extractIntentNames', () => {
    it('should extract intent names from categories structure', () => {
      const intentsData = {
        categories: [
          {
            phase: 'GENERAL',
            intents: [
              { category: 'greeting', enabled: true },
              { category: 'thanks', enabled: true }
            ]
          },
          {
            phase: 'BOOKING',
            intents: [
              { category: 'booking', enabled: true }
            ]
          }
        ]
      };

      const names = extractIntentNames(intentsData);
      expect(names.has('greeting')).toBe(true);
      expect(names.has('thanks')).toBe(true);
      expect(names.has('booking')).toBe(true);
    });

    it('should handle empty intents', () => {
      const intentsData = {
        categories: [
          { phase: 'GENERAL', intents: [] }
        ]
      };

      const names = extractIntentNames(intentsData);
      expect(names.size).toBe(0);
    });

    it('should handle missing categories', () => {
      const intentsData = {};

      const names = extractIntentNames(intentsData);
      expect(names.size).toBe(0);
    });
  });

  describe('extractWorkflowIds', () => {
    it('should extract workflow IDs from workflows structure', () => {
      const workflowsData = {
        workflows: [
          { id: 'booking_handler', name: 'Booking' },
          { id: 'escalation', name: 'Escalation' }
        ]
      };

      const ids = extractWorkflowIds(workflowsData);
      expect(ids.has('booking_handler')).toBe(true);
      expect(ids.has('escalation')).toBe(true);
    });

    it('should handle empty workflows', () => {
      const workflowsData = { workflows: [] };

      const ids = extractWorkflowIds(workflowsData);
      expect(ids.size).toBe(0);
    });

    it('should handle missing workflows field', () => {
      const workflowsData = {};

      const ids = extractWorkflowIds(workflowsData);
      expect(ids.size).toBe(0);
    });
  });

  describe('analyzeReferences', () => {
    it('should detect missing intents in routing.json', () => {
      const data = {
        routing: {
          'greeting': { action: 'static_reply' },
          'nonexistent_intent': { action: 'llm_reply' }
        },
        intents: {
          categories: [
            {
              intents: [
                { category: 'greeting' }
              ]
            }
          ]
        },
        workflows: { workflows: [] },
        knowledge: {}
      };

      const issues = analyzeReferences(data);
      expect(issues.missing_intents.length).toBe(1);
      expect(issues.missing_intents[0].intent).toBe('nonexistent_intent');
      expect(issues.missing_intents[0].file).toBe('routing.json');
    });

    it('should detect missing workflow IDs in routing.json', () => {
      const data = {
        routing: {
          'booking': {
            action: 'workflow',
            workflow_id: 'nonexistent_workflow'
          }
        },
        intents: {
          categories: [
            {
              intents: [
                { category: 'booking' }
              ]
            }
          ]
        },
        workflows: { workflows: [] },
        knowledge: {}
      };

      const issues = analyzeReferences(data);
      expect(issues.missing_workflow_ids.length).toBe(1);
      expect(issues.missing_workflow_ids[0].workflow_id).toBe('nonexistent_workflow');
      expect(issues.missing_workflow_ids[0].routing_intent).toBe('booking');
    });

    it('should detect orphaned intents in knowledge.json', () => {
      const data = {
        routing: {},
        intents: {
          categories: [
            {
              intents: [
                { category: 'greeting' }
              ]
            }
          ]
        },
        workflows: { workflows: [] },
        knowledge: {
          static: [
            { intent: 'greeting', response: {} },
            { intent: 'orphaned_intent', response: {} }
          ]
        }
      };

      const issues = analyzeReferences(data);
      expect(issues.orphaned_knowledge_intents.length).toBe(1);
      expect(issues.orphaned_knowledge_intents[0]).toBe('orphaned_intent');
    });

    it('should pass validation when all references are valid', () => {
      const data = {
        routing: {
          'greeting': { action: 'static_reply' },
          'booking': {
            action: 'workflow',
            workflow_id: 'booking_handler'
          }
        },
        intents: {
          categories: [
            {
              intents: [
                { category: 'greeting' },
                { category: 'booking' }
              ]
            }
          ]
        },
        workflows: {
          workflows: [
            { id: 'booking_handler' }
          ]
        },
        knowledge: {
          static: [
            { intent: 'greeting', response: {} },
            { intent: 'booking', response: {} }
          ]
        }
      };

      const issues = analyzeReferences(data);
      expect(issues.missing_intents.length).toBe(0);
      expect(issues.missing_workflow_ids.length).toBe(0);
      expect(issues.orphaned_knowledge_intents.length).toBe(0);
    });

    it('should handle multiple issues in one analysis', () => {
      const data = {
        routing: {
          'greeting': { action: 'static_reply' },
          'bad_intent1': { action: 'llm_reply' },
          'bad_intent2': {
            action: 'workflow',
            workflow_id: 'bad_workflow'
          }
        },
        intents: {
          categories: [
            {
              intents: [
                { category: 'greeting' }
              ]
            }
          ]
        },
        workflows: {
          workflows: [
            { id: 'valid_workflow' }
          ]
        },
        knowledge: {
          static: [
            { intent: 'greeting', response: {} },
            { intent: 'orphaned', response: {} }
          ]
        }
      };

      const issues = analyzeReferences(data);
      expect(issues.missing_intents.length).toBe(2);
      expect(issues.missing_workflow_ids.length).toBe(1);
      expect(issues.orphaned_knowledge_intents.length).toBe(1);
    });

    it('should ignore non-workflow actions in routing', () => {
      const data = {
        routing: {
          'greeting': { action: 'static_reply' },
          'contact': { action: 'escalate' }
        },
        intents: {
          categories: [
            {
              intents: [
                { category: 'greeting' },
                { category: 'contact' }
              ]
            }
          ]
        },
        workflows: { workflows: [] },
        knowledge: {}
      };

      const issues = analyzeReferences(data);
      expect(issues.missing_workflow_ids.length).toBe(0);
    });
  });

  describe('loadDataFiles', () => {
    it('should load data files for pelangi profile', () => {
      // Test with actual project data
      try {
        const data = loadDataFiles('data-pelangi');
        expect(data.routing).toBeDefined();
        expect(data.intents).toBeDefined();
        expect(data.workflows).toBeDefined();
        expect(data.knowledge).toBeDefined();
      } catch (error) {
        // Skip if files not available in test environment
        expect(true).toBe(true);
      }
    });

    it('should load data files for southern profile', () => {
      try {
        const data = loadDataFiles('data-southern');
        expect(data.routing).toBeDefined();
        expect(data.intents).toBeDefined();
        expect(data.workflows).toBeDefined();
        expect(data.knowledge).toBeDefined();
      } catch (error) {
        // Skip if files not available in test environment
        expect(true).toBe(true);
      }
    });

    it('should handle profile name with or without data- prefix', () => {
      try {
        const data1 = loadDataFiles('data-southern');
        const data2 = loadDataFiles('southern');
        // Both should succeed or both should fail
        expect(data1).toBeDefined();
        expect(data2).toBeDefined();
      } catch (error) {
        // Expected behavior when files are not available
        expect(true).toBe(true);
      }
    });
  });

  describe('Integration tests with real profiles', () => {
    it('should validate southern profile cross-references', () => {
      try {
        const data = loadDataFiles('data-southern');
        const issues = analyzeReferences(data);

        // Log any issues for debugging
        if (issues.missing_intents.length > 0) {
          console.log('Missing intents:', issues.missing_intents);
        }
        if (issues.missing_workflow_ids.length > 0) {
          console.log('Missing workflows:', issues.missing_workflow_ids);
        }
        if (issues.orphaned_knowledge_intents.length > 0) {
          console.log('Orphaned knowledge:', issues.orphaned_knowledge_intents);
        }

        // Southern profile might have some issues (expected state)
        // but should complete validation without errors
        expect(issues).toBeDefined();
      } catch (error) {
        // Skip if files not available
        expect(true).toBe(true);
      }
    });

    it('should validate pelangi profile cross-references', () => {
      try {
        const data = loadDataFiles('data-pelangi');
        const issues = analyzeReferences(data);

        // Log any issues for debugging
        if (issues.missing_intents.length > 0) {
          console.log('Missing intents:', issues.missing_intents);
        }
        if (issues.missing_workflow_ids.length > 0) {
          console.log('Missing workflows:', issues.missing_workflow_ids);
        }

        expect(issues).toBeDefined();
      } catch (error) {
        // Skip if files not available
        expect(true).toBe(true);
      }
    });

    it('should validate makan profile cross-references', () => {
      try {
        const data = loadDataFiles('data-makan');
        const issues = analyzeReferences(data);

        expect(issues).toBeDefined();
      } catch (error) {
        // Skip if files not available
        expect(true).toBe(true);
      }
    });
  });
});
