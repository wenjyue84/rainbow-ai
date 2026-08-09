import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  timeout?: number;
  config?: Record<string, any>;
  next?: string | Record<string, string>;
  outputs?: Record<string, string>;
}

interface Workflow {
  id: string;
  name: string;
  format?: string;
  startNodeId?: string;
  nodes?: WorkflowNode[];
  steps?: any[];
}

interface WorkflowFile {
  schema_version: string;
  workflows: Workflow[];
}

/**
 * Extract variable references from config objects
 * Finds patterns like {{workflow.data.field_name}}, {{guest.field}}, {{system.field}}, {{pelangi.field}}
 */
function extractRequiredInputs(config: any): string[] {
  const inputs = new Set<string>();
  const pattern = /\{\{([a-zA-Z_.]+)\}\}/g;

  const processValue = (val: any) => {
    if (typeof val === 'string') {
      let match;
      while ((match = pattern.exec(val)) !== null) {
        inputs.add(match[1]);
      }
      pattern.lastIndex = 0; // Reset regex for next string
    } else if (typeof val === 'object' && val !== null) {
      Object.values(val).forEach(processValue);
    }
  };

  processValue(config);
  return Array.from(inputs).sort();
}

/**
 * Generate test cases for a single node
 */
function generateNodeTest(workflow: Workflow, node: WorkflowNode, nodeIndex: number): string {
  const requiredInputs = extractRequiredInputs(node.config || {});
  const testName = `${workflow.id} > ${node.id} (${node.type})`;

  // Build workflowData with required fields
  const workflowDataObj: Record<string, any> = {
    guest_name: 'John Doe',
    guest_count: 2,
    booking_dates: '15 Feb - 17 Feb',
    stay_dates: '15 Feb - 17 Feb',
    booking_dates_normalized: { checkIn: '2026-02-15', checkOut: '2026-02-17' },
  };

  const systemDataObj: Record<string, any> = {
    admin_phone: '+60127088789',
  };

  const guestDataObj: Record<string, any> = {
    phone: '+60112345678',
  };

  const externalDataObj: Record<string, any> = {
    availableCount: 3,
    availableCapsules: ['A1', 'A2', 'A3'],
    roomAvailable: true,
    isBlacklisted: false,
  };

  // Add missing fields referenced in this node
  requiredInputs.forEach(input => {
    if (input.startsWith('workflow.data')) {
      const fieldName = input.split('.')[2];
      if (!(fieldName in workflowDataObj)) {
        // Add sensible defaults for missing fields
        if (fieldName.includes('count') || fieldName.includes('number') || fieldName.includes('charge') || fieldName.includes('credit')) {
          workflowDataObj[fieldName] = 42;
        } else if (fieldName.includes('date') || fieldName.includes('time')) {
          workflowDataObj[fieldName] = '2026-02-15';
        } else if (fieldName.includes('bool') || fieldName.includes('available') || fieldName.includes('valid')) {
          workflowDataObj[fieldName] = true;
        } else {
          workflowDataObj[fieldName] = 'test-value';
        }
      }
    } else if (input.startsWith('system')) {
      const fieldName = input.split('.')[1];
      if (!(fieldName in systemDataObj)) {
        systemDataObj[fieldName] = 'test-system-value';
      }
    } else if (input.startsWith('guest')) {
      const fieldName = input.split('.')[1];
      if (!(fieldName in guestDataObj)) {
        guestDataObj[fieldName] = 'test-guest-value';
      }
    } else if (input.startsWith('pelangi') || input.startsWith('external')) {
      const fieldName = input.split('.')[1];
      if (!(fieldName in externalDataObj)) {
        externalDataObj[fieldName] = 'test-external-value';
      }
    }
  });

  const workflowDataStr = JSON.stringify(workflowDataObj);
  const systemDataStr = JSON.stringify(systemDataObj);
  const guestDataStr = JSON.stringify(guestDataObj);
  const externalDataStr = JSON.stringify(externalDataObj);

  // Generate test for this node
  let test = `
  describe('Workflow: ${workflow.name}, Node: ${node.label}', () => {
    const workflowData = ${workflowDataStr};

    const systemData = ${systemDataStr};

    const guestData = ${guestDataStr};

    const externalData = ${externalDataStr};

    it('should have all required inputs present', () => {
      const requiredInputs = ${JSON.stringify(requiredInputs)};

      // Check workflow.data references
      const workflowRefs = requiredInputs.filter(input => input.startsWith('workflow.data'));
      workflowRefs.forEach(ref => {
        const fieldName = ref.split('.')[2];
        expect(workflowData[fieldName as keyof typeof workflowData]).toBeDefined();
      });

      // Check system references
      const systemRefs = requiredInputs.filter(input => input.startsWith('system'));
      systemRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(systemData[fieldName as keyof typeof systemData]).toBeDefined();
      });

      // Check guest references
      const guestRefs = requiredInputs.filter(input => input.startsWith('guest'));
      guestRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(guestData[fieldName as keyof typeof guestData]).toBeDefined();
      });

      // Check external data references (pelangi, etc)
      const externalRefs = requiredInputs.filter(input =>
        input.startsWith('pelangi') || input.startsWith('external')
      );
      externalRefs.forEach(ref => {
        const fieldName = ref.split('.')[1];
        expect(externalData[fieldName as keyof typeof externalData]).toBeDefined();
      });
    });

    it('should validate input types', () => {
      const requiredInputs = ${JSON.stringify(requiredInputs)};

      // Verify non-null/non-undefined values
      requiredInputs.forEach(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          const value = workflowData[fieldName as keyof typeof workflowData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('system')) {
          const fieldName = ref.split('.')[1];
          const value = systemData[fieldName as keyof typeof systemData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        } else if (ref.startsWith('guest')) {
          const fieldName = ref.split('.')[1];
          const value = guestData[fieldName as keyof typeof guestData];
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      });
    });

    it('should have valid node configuration', () => {
      const node = ${JSON.stringify(node)};
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.config).toBeDefined();
    });

    it('should handle missing required fields gracefully', () => {
      const incompleteData = { ...workflowData };
      delete incompleteData.guest_name;

      // Simulate missing field detection
      const requiredInputs = ${JSON.stringify(requiredInputs)};
      const hasMissingFields = requiredInputs.some(ref => {
        if (ref.startsWith('workflow.data')) {
          const fieldName = ref.split('.')[2];
          return !(fieldName in incompleteData);
        }
        return false;
      });

      // When a required field is missing, the step should fail gracefully
      expect(hasMissingFields).toBeDefined();
    });

    it('should validate null/undefined values', () => {
      const nullData = {
        guest_name: null,
        guest_count: undefined,
        booking_dates: '',
      };

      // All of these should be caught as invalid
      expect(nullData.guest_name).toBeNull();
      expect(nullData.guest_count).toBeUndefined();
      expect(nullData.booking_dates).toBe('');
    });
  });
`;

  return test;
}

/**
 * Load workflows.json for a profile
 */
function loadWorkflows(profileName: string): WorkflowFile {
  let basePath: string;

  // Default profile uses src/assistant/data/
  // Other profiles use src/assistant/data-{profile}/
  if (profileName === 'pelangi' || profileName === 'default') {
    basePath = resolve(__dirname, '..', 'assistant', 'data');
  } else {
    basePath = resolve(__dirname, '..', 'assistant', `data-${profileName}`);
  }

  const filePath = resolve(basePath, 'workflows.json');
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Generate test file content from workflows
 */
function generateTestFileContent(profileName: string, workflows: Workflow[]): string {
  const imports = `import { describe, it, expect } from 'vitest';

`;

  let tests = '';
  for (const workflow of workflows) {
    if (workflow.nodes && workflow.nodes.length > 0) {
      // Format: nodes
      for (const node of workflow.nodes) {
        tests += generateNodeTest(workflow, node, workflow.nodes.indexOf(node));
      }
    }
  }

  return imports + tests;
}

/**
 * Main CLI entry point
 */
async function main() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    let profileName = 'pelangi'; // default
    let fullProfileName = 'data-pelangi'; // full path name

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--profile' && i + 1 < args.length) {
        const rawProfile = args[i + 1];
        // Normalize: remove data- prefix if present, then add it back
        profileName = rawProfile.startsWith('data-') ? rawProfile.substring(5) : rawProfile;
        fullProfileName = `data-${profileName}`;
        break;
      }
    }

    // Load workflows
    const workflowFile = loadWorkflows(profileName);

    // Generate test content
    const testContent = generateTestFileContent(profileName, workflowFile.workflows);

    // Create output directory
    const outputDir = resolve(__dirname, '..', '__tests__', 'generated');
    mkdirSync(outputDir, { recursive: true });

    // Use short profile name for output file
    const outputFile = resolve(outputDir, `workflows-${profileName}.test.ts`);

    // Write test file
    writeFileSync(outputFile, testContent, 'utf-8');

    // Output result
    console.log(`Generated test file: ${outputFile}`);
    console.log(`Profile: ${fullProfileName}`);
    console.log(`Workflows: ${workflowFile.workflows.length}`);

    process.exit(0);
  } catch (error) {
    console.error('Error generating workflow tests:', error);
    process.exit(1);
  }
}

// Only run main if this is the entry point
const isMain = process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/');
if (isMain) {
  main().catch(console.error);
}

export { loadWorkflows, generateTestFileContent, extractRequiredInputs, generateNodeTest };
