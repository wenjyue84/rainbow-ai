import { MCPTool, MCPToolResult, ToolHandler } from '../types/mcp.js';

// Phase 1: Read-only tools
import { guestTools, listGuests, getGuest, searchGuests } from './guests.js';
import { unitTools, listUnits, getOccupancy, checkAvailability } from './units.js';
import { dashboardTools, getDashboard, getOverdueGuests } from './dashboard.js';
import { problemTools, listProblems, exportWhatsappIssues } from './problems.js';

// FnB tools (makan-moments profile only)
import {
  fnbMenuTools,
  fnbGetMenu, fnbGetMenuItem, fnbGetCategories, fnbGetCafeInfo, fnbGetDailySpecials
} from './fnb-menu.js';
import {
  fnbOrderTools,
  fnbCreateOrder, fnbGetOrderStatus, fnbGetOperatingHours,
  fnbGetPendingOrders, fnbApproveOrder, fnbUpdateOrderStatus
} from './fnb-orders.js';

// Phase 2: Write operation tools (HTTP API based)
import {
  guestWriteTools,
  checkinGuest,
  checkoutGuest,
  bulkCheckout
} from './guests-write.js';

import {
  unitWriteTools,
  markCleaned,
  bulkMarkCleaned
} from './units-write.js';

import {
  problemWriteTools,
  getProblemSummary
} from './problems-write.js';

import {
  analyticsTools,
  unitUtilization,
  guestStatistics,
  exportGuestsCSV
} from './analytics.js';

import {
  settingsTools,
  getUnitRules
} from './settings-tools.js';

// Phase 3: WhatsApp integration tools
import {
  whatsappTools,
  whatsappStatus,
  whatsappQrcode,
  whatsappSend,
  whatsappSendGuestStatus
} from './whatsapp.js';

// Guest enquiry tools (availability, rates, reservation lookup, property info)
import {
  guestEnquiryTools,
  checkDateAvailability,
  getRates,
  lookupReservation,
  getPropertyInfo
} from './guest-enquiry.js';

class ToolRegistry {
  private tools: Map<string, MCPTool> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  constructor() {
    this.registerTools();
  }

  private registerTools() {
    // Phase 1: Read-only tools (10 tools)
    this.register(guestTools[0], listGuests);
    this.register(guestTools[1], getGuest);
    this.register(guestTools[2], searchGuests);

    this.register(unitTools[0], listUnits);
    this.register(unitTools[1], getOccupancy);
    this.register(unitTools[2], checkAvailability);

    this.register(dashboardTools[0], getDashboard);
    this.register(dashboardTools[1], getOverdueGuests);

    this.register(problemTools[0], listProblems);
    this.register(problemTools[1], exportWhatsappIssues);

    // Phase 2: Guest write operations (3 tools)
    this.register(guestWriteTools[0], checkinGuest);
    this.register(guestWriteTools[1], checkoutGuest);
    this.register(guestWriteTools[2], bulkCheckout);

    // Phase 2: Unit write operations (2 tools)
    this.register(unitWriteTools[0], markCleaned);
    this.register(unitWriteTools[1], bulkMarkCleaned);

    // Phase 2: Problem operations (1 tool)
    this.register(problemWriteTools[0], getProblemSummary);

    // Phase 2: Analytics & reporting (3 tools)
    this.register(analyticsTools[0], unitUtilization);
    this.register(analyticsTools[1], guestStatistics);
    this.register(analyticsTools[2], exportGuestsCSV);

    // Phase 2: Settings tools (1 tool)
    this.register(settingsTools[0], getUnitRules);

    // Phase 3: WhatsApp integration (4 tools)
    this.register(whatsappTools[0], whatsappStatus);
    this.register(whatsappTools[1], whatsappQrcode);
    this.register(whatsappTools[2], whatsappSend);
    this.register(whatsappTools[3], whatsappSendGuestStatus);

    // Guest enquiry tools via PMS MCP (4 tools — for answering guest WhatsApp questions)
    this.register(guestEnquiryTools[0], checkDateAvailability);
    this.register(guestEnquiryTools[1], getRates);
    this.register(guestEnquiryTools[2], lookupReservation);
    this.register(guestEnquiryTools[3], getPropertyInfo);

    // FnB tools (makan-moments profile only)
    for (const tool of fnbMenuTools) this.register(tool, this.getFnbMenuHandler(tool.name));
    for (const tool of fnbOrderTools) this.register(tool, this.getFnbOrderHandler(tool.name));
  }

  private getFnbMenuHandler(name: string): ToolHandler {
    const map: Record<string, ToolHandler> = {
      fnb_get_menu: fnbGetMenu,
      fnb_get_menu_item: fnbGetMenuItem,
      fnb_get_categories: fnbGetCategories,
      fnb_get_cafe_info: fnbGetCafeInfo,
      fnb_get_daily_specials: fnbGetDailySpecials
    };
    return map[name] || ((_args) => Promise.resolve({ content: [{ type: 'text', text: `Unknown fnb menu tool: ${name}` }], isError: true }));
  }

  private getFnbOrderHandler(name: string): ToolHandler {
    const map: Record<string, ToolHandler> = {
      fnb_create_order: fnbCreateOrder,
      fnb_get_order_status: fnbGetOrderStatus,
      fnb_get_operating_hours: fnbGetOperatingHours,
      fnb_get_pending_orders: fnbGetPendingOrders,
      fnb_approve_order: fnbApproveOrder,
      fnb_update_order_status: fnbUpdateOrderStatus
    };
    return map[name] || ((_args) => Promise.resolve({ content: [{ type: 'text', text: `Unknown fnb order tool: ${name}` }], isError: true }));
  }

  private register(tool: MCPTool, handler: ToolHandler) {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /** Returns tools available for a given profile. Tools with no allowedProfiles are available to all. */
  getToolsForProfile(profileId: string): MCPTool[] {
    return Array.from(this.tools.values()).filter(
      t => !t.allowedProfiles || t.allowedProfiles.includes(profileId)
    );
  }

  /** Returns handler map for tools available to a given profile. */
  getHandlersForProfile(profileId: string): Map<string, ToolHandler> {
    const result = new Map<string, ToolHandler>();
    for (const tool of this.getToolsForProfile(profileId)) {
      const handler = this.handlers.get(tool.name);
      if (handler) result.set(tool.name, handler);
    }
    return result;
  }

  async executeTool(name: string, args: any): Promise<MCPToolResult> {
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        content: [{
          type: 'text',
          text: `Tool not found: ${name}`
        }],
        isError: true
      };
    }

    try {
      return await handler(args || {});
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error executing tool ${name}: ${error.message}`
        }],
        isError: true
      };
    }
  }

  getToolCount(): { total: number; phase1: number; phase2: number; phase3: number } {
    return {
      total: this.tools.size,
      phase1: 10,
      phase2: 10,
      phase3: 4
    };
  }
}

export const toolRegistry = new ToolRegistry();
