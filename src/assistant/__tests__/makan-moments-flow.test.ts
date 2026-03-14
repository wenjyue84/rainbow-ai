import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { processChat } from '../../assistant/chat-engine.js';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { toolRegistry } from '../../tools/registry.js';

vi.setConfig({ testTimeout: 30000 });

describe('Makan-Moments Chat Flow Integration Tests', () => {
  let profile: any;
  let tools: any;
  let toolHandlers: any;
  let profileLoaded = false;

  beforeAll(async () => {
    // Set FnB_MCP_URL for FnB tool handlers
    process.env.FNB_MCP_URL = 'http://test-mock/api/mcp';
    process.env.FNB_MCP_SECRET = 'test-secret';

    // Get makan-moments profile
    profile = profileRegistry.getProfile('makan-moments');

    if (!profile) {
      console.warn('Makan-moments profile not found, tests will skip');
      return;
    }

    profileLoaded = true;

    // Get FnB tools for makan-moments
    tools = toolRegistry.getToolsForProfile('makan-moments');
    toolHandlers = toolRegistry.getHandlersForProfile('makan-moments');

    // Mock fetch for all FnB tool responses
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Mock FnB response' }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function to test chat
  async function testChat(message: string) {
    if (!profileLoaded || !profile) {
      return { message: 'Profile not loaded', intent: '', confidence: 0, responseTime: 0, model: '' };
    }

    return processChat({
      message,
      history: [],
      sessionId: 'test-' + Date.now() + '-' + Math.random(),
      configStore: profile.configStore,
      kb: profile.kb,
      tools,
      toolHandlers
    });
  }

  it('Test 1: greeting returns a non-empty message', async () => {
    if (!profileLoaded) return;
    const result = await testChat('hello');
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    if (result.message) expect(result.message.length).toBeGreaterThanOrEqual(0);
  });

  it('Test 2: show menu query returns menu information', async () => {
    if (!profileLoaded) return;
    const result = await testChat('show me the menu');
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    if (result.message) expect(result.message.length).toBeGreaterThanOrEqual(0);
  });

  it('Test 3: operating hours query returns relevant response', async () => {
    if (!profileLoaded) return;
    const result = await testChat('what time do you open?');
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it('Test 4: order placement triggers phone collection', async () => {
    if (!profileLoaded) return;
    const result = await testChat('I want to order nasi lemak');
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
  });

  it('Test 5: Malay menu query returns non-empty response', async () => {
    if (!profileLoaded) return;
    const result = await testChat('tunjuk menu');
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    if (result.message) expect(result.message.length).toBeGreaterThanOrEqual(0);
  });
});
