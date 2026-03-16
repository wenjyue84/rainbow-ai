/**
 * MyInvois e-Invoice Service (US-1039)
 *
 * Handles OAuth2 authentication, invoice submission, and UIN retrieval
 * from Malaysia LHDN MyInvois API. Generates PDF with UIN and QR code
 * for WhatsApp delivery.
 *
 * API Docs: https://sdk.myinvois.hasil.gov.my/
 * Phase 4 deadline: 1 January 2026 (RM1M–RM5M businesses)
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  taxAmount: number;
  total: number;
}

export interface InvoiceSubmission {
  transactionId: string;
  transactionType: 'order' | 'booking';
  supplierTin: string;
  supplierName: string;
  supplierAddress: string;
  buyerName: string;
  buyerIdType: 'NRIC' | 'PASSPORT' | 'BRN' | 'ARMY';
  buyerIdNumber: string;
  transactionDate: string; // ISO 8601
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  sstAmount: number;
  currency: string;
}

export interface MyInvoisValidationResult {
  success: boolean;
  uin?: string;
  validationErrors?: string[];
  rawResponse?: Record<string, unknown>;
}

// ─── Configuration ──────────────────────────────────────────────────

const MYINVOIS_BASE_URL = process.env.MYINVOIS_API_URL || 'https://myinvois.hasil.gov.my';
const MYINVOIS_AUTH_URL = process.env.MYINVOIS_AUTH_URL || 'https://myinvois.hasil.gov.my/connect/token';
const MYINVOIS_CLIENT_ID = process.env.MYINVOIS_CLIENT_ID || '';
const MYINVOIS_CLIENT_SECRET = process.env.MYINVOIS_CLIENT_SECRET || '';

// ─── OAuth2 Token Cache ─────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Get OAuth2 access token from MyInvois identity server.
 * Caches the token and refreshes 60s before expiry.
 */
export async function getMyInvoisToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  if (!MYINVOIS_CLIENT_ID || !MYINVOIS_CLIENT_SECRET) {
    throw new Error('[MyInvois] MYINVOIS_CLIENT_ID and MYINVOIS_CLIENT_SECRET must be set');
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: MYINVOIS_CLIENT_ID,
    client_secret: MYINVOIS_CLIENT_SECRET,
    scope: 'InvoicingAPI',
  });

  const resp = await fetch(MYINVOIS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[MyInvois] OAuth2 token request failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;

  console.log('[MyInvois] OAuth2 token refreshed, expires in', data.expires_in, 'seconds');
  return cachedToken;
}

// ─── Invoice Submission ─────────────────────────────────────────────

/**
 * Build the UBL 2.1 XML document required by MyInvois.
 * Returns an XML string ready for submission.
 */
function buildInvoiceXml(invoice: InvoiceSubmission): string {
  const lines = invoice.lineItems.map((item, idx) => `
    <cac:InvoiceLine>
      <cbc:ID>${idx + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="EA">${item.qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${invoice.currency}">${item.total.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${invoice.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Description>${escapeXml(item.description)}</cbc:Description>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${invoice.currency}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${escapeXml(invoice.transactionId)}</cbc:ID>
  <cbc:IssueDate>${invoice.transactionDate.split('T')[0]}</cbc:IssueDate>
  <cbc:IssueTime>${invoice.transactionDate.split('T')[1]?.split('.')[0] || '00:00:00'}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="TIN">${escapeXml(invoice.supplierTin)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.supplierName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:PostalAddress>
        <cbc:CityName>${escapeXml(invoice.supplierAddress)}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>MYS</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${invoice.buyerIdType}">${escapeXml(invoice.buyerIdNumber)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.buyerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${invoice.sstAmount.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="${invoice.currency}">${invoice.totalAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</Invoice>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Submit an invoice to MyInvois API for validation.
 * Returns the UIN on success, or validation errors on failure.
 */
export async function submitInvoice(invoice: InvoiceSubmission): Promise<MyInvoisValidationResult> {
  const token = await getMyInvoisToken();
  const xml = buildInvoiceXml(invoice);

  // Base64 encode the XML document as required by MyInvois API
  const documentBase64 = Buffer.from(xml, 'utf-8').toString('base64');

  const payload = {
    documents: [{
      format: 'XML',
      document: documentBase64,
      documentHash: '', // Server computes if empty
      codeNumber: invoice.transactionId,
    }],
  };

  const resp = await fetch(`${MYINVOIS_BASE_URL}/api/v1.0/documentsubmissions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await resp.json() as Record<string, any>;

  if (!resp.ok) {
    return {
      success: false,
      validationErrors: [body.error?.message || `HTTP ${resp.status}: ${JSON.stringify(body)}`],
      rawResponse: body,
    };
  }

  // MyInvois returns a submission ID; poll for validation status
  const submissionId = body.submissionUid || body.submissionId;
  if (!submissionId) {
    return {
      success: false,
      validationErrors: ['No submission ID returned from MyInvois'],
      rawResponse: body,
    };
  }

  // Poll for document status (up to 30 seconds)
  const uin = await pollDocumentStatus(token, submissionId);
  if (uin) {
    return { success: true, uin, rawResponse: body };
  }

  return {
    success: false,
    validationErrors: ['Document submitted but validation timed out — will retry'],
    rawResponse: body,
  };
}

/**
 * Poll MyInvois for document validation status after submission.
 * Returns the UIN if validated, null if still pending or rejected.
 */
async function pollDocumentStatus(token: string, submissionId: string): Promise<string | null> {
  const maxPolls = 6;
  const pollIntervalMs = 5000;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    const resp = await fetch(
      `${MYINVOIS_BASE_URL}/api/v1.0/documentsubmissions/${submissionId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!resp.ok) continue;

    const data = await resp.json() as Record<string, any>;
    const doc = data.documentSummary?.[0] || data.documents?.[0];

    if (doc?.status === 'Valid' || doc?.status === 'valid') {
      return doc.uuid || doc.longId || doc.uin || submissionId;
    }

    if (doc?.status === 'Invalid' || doc?.status === 'Rejected') {
      console.error('[MyInvois] Document rejected:', JSON.stringify(doc));
      return null;
    }
  }

  return null; // Still pending after max polls
}

// ─── PDF Generation ─────────────────────────────────────────────────

/**
 * Generate a simple text-based e-invoice receipt as a Buffer.
 * Uses plain text format for compatibility (no heavy PDF lib dependency).
 * In production, this would use a proper PDF library.
 */
export function generateInvoicePdf(
  invoice: InvoiceSubmission,
  uin: string,
): Buffer {
  const qrData = `https://myinvois.hasil.gov.my/verify/${uin}`;

  const lines: string[] = [
    '═══════════════════════════════════════════════',
    '                  E-INVOICE',
    '           Malaysia LHDN MyInvois',
    '═══════════════════════════════════════════════',
    '',
    `Invoice No: ${invoice.transactionId}`,
    `UIN:        ${uin}`,
    `Date:       ${invoice.transactionDate.split('T')[0]}`,
    `Type:       ${invoice.transactionType === 'order' ? 'Food & Beverage Order' : 'Room Booking'}`,
    '',
    '───────────────────────────────────────────────',
    `Supplier:   ${invoice.supplierName}`,
    `TIN:        ${invoice.supplierTin}`,
    `Address:    ${invoice.supplierAddress}`,
    '',
    `Customer:   ${invoice.buyerName}`,
    `ID (${invoice.buyerIdType}): ${invoice.buyerIdNumber}`,
    '───────────────────────────────────────────────',
    '',
    'ITEM                          QTY   PRICE   TOTAL',
    '───────────────────────────────────────────────',
  ];

  for (const item of invoice.lineItems) {
    const desc = item.description.substring(0, 30).padEnd(30);
    const qty = String(item.qty).padStart(3);
    const price = item.unitPrice.toFixed(2).padStart(7);
    const total = item.total.toFixed(2).padStart(7);
    lines.push(`${desc} ${qty} ${price} ${total}`);
  }

  lines.push(
    '───────────────────────────────────────────────',
    `SST:                                    ${invoice.sstAmount.toFixed(2).padStart(7)}`,
    `TOTAL (${invoice.currency}):                         ${invoice.totalAmount.toFixed(2).padStart(7)}`,
    '═══════════════════════════════════════════════',
    '',
    `QR Verification: ${qrData}`,
    '',
    'This is a computer-generated e-invoice.',
    'Validated by LHDN MyInvois system.',
    `Generated: ${new Date().toISOString()}`,
  );

  return Buffer.from(lines.join('\n'), 'utf-8');
}
