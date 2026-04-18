/**
 * Guest Enquiry Tools (Rainbow AI)
 *
 * Wraps PMS2 MCP guest-enquiry tools for use in Rainbow AI's tool registry.
 * These tools answer guest questions via WhatsApp:
 *   - Room / capsule availability for specific dates
 *   - Nightly rates and total cost
 *   - Reservation lookup by confirmation #, name, or phone
 *   - Property info: check-in/out times, house rules, amenities
 */

import { MCPTool, MCPToolResult } from '../types/mcp.js';
import { pmsMCPClient } from '../lib/pms-mcp-client.js';

export const guestEnquiryTools: MCPTool[] = [
  {
    name: 'pelangi_check_date_availability',
    description:
      'Check how many capsule/room units are available for a given check-in and check-out date. ' +
      'Use this when a guest asks "Is there availability for [dates]?" or "Do you have rooms available?"',
    inputSchema: {
      type: 'object',
      properties: {
        checkInDate: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format (e.g. 2026-05-01)'
        },
        checkOutDate: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format (e.g. 2026-05-03)'
        }
      },
      required: ['checkInDate', 'checkOutDate']
    }
  },
  {
    name: 'pelangi_get_rates',
    description:
      'Get the nightly rate and total cost for a stay. ' +
      'Use this when a guest asks "How much per night?", "What is the rate?", or "How much for X nights?"',
    inputSchema: {
      type: 'object',
      properties: {
        checkInDate: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format'
        },
        checkOutDate: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format'
        }
      },
      required: ['checkInDate', 'checkOutDate']
    }
  },
  {
    name: 'pelangi_lookup_reservation',
    description:
      'Find a reservation by confirmation number, guest name, or phone number. ' +
      'Use when a guest asks "What is my booking status?", "I have a booking under [name]", or provides a confirmation number like PLG-20260501-001.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmationNumber: {
          type: 'string',
          description: 'Confirmation number (e.g. PLG-20260501-001)'
        },
        guestName: {
          type: 'string',
          description: 'Guest full name or partial name to search'
        },
        guestPhone: {
          type: 'string',
          description: 'Guest phone number (e.g. 60127088789)'
        }
      }
    }
  },
  {
    name: 'pelangi_get_property_info',
    description:
      'Get property information: check-in/check-out times, house rules, amenities, and nightly rate. ' +
      'Use when a guest asks about policies, rules, or general info about the property.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  // ─── Phase 2: Expanded guest tools ───────────────────────────────────────────
  {
    name: 'pelangi_search_guests',
    description:
      'Search for a guest by name, unit number, or nationality. ' +
      'Use when a guest asks "What is my booking status?", "Am I checked in?", or "Which unit am I in?". ' +
      'The guest\'s phone number can be used as the search query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — guest name, phone number, or unit number'
        },
        field: {
          type: 'string',
          description: 'Field to search: name, unit, or nationality (optional, searches all if omitted)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'pelangi_get_guest',
    description:
      'Get detailed guest profile by ID number (IC or Passport). ' +
      'Use after searching for a guest to get their full check-in details, unit assignment, and payment status.',
    inputSchema: {
      type: 'object',
      properties: {
        guestId: {
          type: 'string',
          description: 'Guest IC number or passport number'
        }
      },
      required: ['guestId']
    }
  },
  {
    name: 'pelangi_list_today_arrivals',
    description:
      'List all reservations arriving today. Useful for answering "When can I check in?" by seeing ' +
      'if the guest has a reservation for today, and for morning briefings.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'pelangi_list_upcoming_reservations',
    description:
      'List reservations arriving in the next N days. Use when a guest asks "Is my booking confirmed ' +
      'for next week?" or when staff needs to plan ahead.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days ahead to look (default: 7)'
        }
      }
    }
  },
  {
    name: 'pelangi_check_reservation_availability',
    description:
      'Check if specific dates are available for booking, optionally for a specific unit. ' +
      'Use when a guest asks "Can I extend my stay 2 more nights?" or "Is there space next weekend?".',
    inputSchema: {
      type: 'object',
      properties: {
        checkInDate: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format'
        },
        checkOutDate: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format'
        },
        unitNumber: {
          type: 'string',
          description: 'Specific unit to check (optional — omit to check general availability)'
        }
      },
      required: ['checkInDate', 'checkOutDate']
    }
  }
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function checkDateAvailability(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_check_date_availability', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to check availability: ${error.message}`);
  }
}

export async function getRates(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_get_rates', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to get rates: ${error.message}`);
  }
}

export async function lookupReservation(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_lookup_reservation', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to look up reservation: ${error.message}`);
  }
}

export async function getPropertyInfo(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_get_property_info', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to get property info: ${error.message}`);
  }
}

// ─── Phase 2: Expanded handlers ──────────────────────────────────────────────

export async function searchGuests(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_search_guests', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to search guests: ${error.message}`);
  }
}

export async function getGuest(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_get_guest', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to get guest details: ${error.message}`);
  }
}

export async function listTodayArrivals(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_list_today_arrivals', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to list today's arrivals: ${error.message}`);
  }
}

export async function listUpcomingReservations(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_list_upcoming_reservations', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to list upcoming reservations: ${error.message}`);
  }
}

export async function checkReservationAvailability(args: any): Promise<MCPToolResult> {
  try {
    const result = await pmsMCPClient.callTool('pelangi_check_reservation_availability', args);
    return resultFromMCP(result);
  } catch (error: any) {
    return errorResult(`Unable to check reservation availability: ${error.message}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resultFromMCP(mcpResult: any): MCPToolResult {
  if (!mcpResult) return errorResult('Empty response from PMS');
  if (mcpResult.content) return mcpResult as MCPToolResult;
  return {
    content: [{ type: 'text', text: typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult, null, 2) }]
  };
}

function errorResult(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
