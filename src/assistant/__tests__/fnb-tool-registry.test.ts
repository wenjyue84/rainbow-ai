import { describe, it, expect } from 'vitest';
import { toolRegistry } from '../../tools/registry.js';

describe('ToolRegistry - FnB Profile Filtering', () => {
  it('getToolsForProfile("makan-moments") includes fnb_get_menu', () => {
    const tools = toolRegistry.getToolsForProfile('makan-moments');
    const fnbGetMenu = tools.find(t => t.name === 'fnb_get_menu');
    expect(fnbGetMenu).toBeDefined();
  });

  it('getToolsForProfile("makan-moments") includes fnb_create_order', () => {
    const tools = toolRegistry.getToolsForProfile('makan-moments');
    const fnbCreateOrder = tools.find(t => t.name === 'fnb_create_order');
    expect(fnbCreateOrder).toBeDefined();
  });

  it('getToolsForProfile("pelangi") has no tools starting with "fnb_"', () => {
    const tools = toolRegistry.getToolsForProfile('pelangi');
    const fnbTools = tools.filter(t => t.name.startsWith('fnb_'));
    expect(fnbTools).toHaveLength(0);
  });

  it('all FnB tools have allowedProfiles containing "makan-moments"', () => {
    const allTools = toolRegistry.listTools();
    const fnbTools = allTools.filter(t => t.name.startsWith('fnb_'));

    fnbTools.forEach(tool => {
      expect(tool.allowedProfiles).toBeDefined();
      expect(tool.allowedProfiles).toContain('makan-moments');
    });
  });

  it('getHandlersForProfile("makan-moments") has fnb_get_menu handler', () => {
    const handlers = toolRegistry.getHandlersForProfile('makan-moments');
    expect(handlers.has('fnb_get_menu')).toBe(true);
  });
});
