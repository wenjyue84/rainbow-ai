/**
 * myinvois-client.ts — Malaysia LHDN MyInvois API client (US-1039)
 *
 * Handles OAuth2 token management and e-invoice document submission
 * for the Malaysia national e-invoicing system (Phase 4: Jan 2026).
 *
 * LHDN sandbox: https://preprod-api.myinvois.hasil.gov.my
 * LHDN production: https://api.myinvois.hasil.gov.my
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('MyInvoisClient');

// ─── Types ────────────────────────────────────────────────────────────

export interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
  taxAmount: number;
  total: number;
}

export interface EinvoiceDocument {
  /** LHDN Unique Identification Number (set after successful submission) */
  uin?: string;
  transactionType: 'order' | 'booking';
  transactionId: string;
  transactionDate: string; // ISO date
  supplierTin: string;
  supplierName: string;
  supplierAddress: string;
  buyerName: string;
  buyerIdNumber: string; // NRIC or passport
  buyerPhone?: string;
  lineItems: LineItem[];
  totalAmount: number;
  sstAmount: number;
}

export interface SubmissionResult {
  success: boolean;
  uin?: string;
  error?: string;
  /** Raw response body for debugging */
  raw?: any;
}

// ─── OAuth2 Token Cache ───────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.MYINVOIS_CLIENT_ID;
  const clientSecret = process.env.MYINVOIS_CLIENT_SECRET;
  const baseUrl = process.env.MYINVOIS_API_URL || 'https://preprod-api.myinvois.hasil.gov.my';

  if (!clientId || !clientSecret) {
    throw new Error('MYINVOIS_CLIENT_ID and MYINVOIS_CLIENT_SECRET must be set');
  }

  const tokenUrl = `${baseUrl}/connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'InvoicingAPI',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MyInvois OAuth2 failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  logger.info('OAuth2 token refreshed');
  return tokenCache.accessToken;
}

// ─── Document Builder ─────────────────────────────────────────────────

/**
 * Build the UBL 2.1 JSON payload required by MyInvois API.
 * Ref: LHDN MyInvois Developer Portal — Invoice Document Type
 */
function buildDocumentPayload(doc: EinvoiceDocument): object {
  return {
    _D: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    _A: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    _B: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    Invoice: [
      {
        ID: [{ _: doc.transactionId }],
        IssueDate: [{ _: doc.transactionDate }],
        InvoiceTypeCode: [{ _: '01', listVersionID: '1.0' }],
        DocumentCurrencyCode: [{ _: 'MYR' }],
        AccountingSupplierParty: [
          {
            Party: [
              {
                IndustryClassificationCode: [{ _: '56101', name: 'Restaurants and mobile food service activities' }],
                PartyIdentification: [
                  { ID: [{ _: doc.supplierTin, schemeID: 'TIN' }] },
                ],
                PartyName: [{ Name: [{ _: doc.supplierName }] }],
                PostalAddress: [{ AddressLine: [{ Line: [{ _: doc.supplierAddress }] }], Country: [{ IdentificationCode: [{ _: 'MYS' }] }] }],
                Contact: [{ Telephone: [{ _: doc.buyerPhone || '' }] }],
              },
            ],
          },
        ],
        AccountingCustomerParty: [
          {
            Party: [
              {
                PartyIdentification: [
                  { ID: [{ _: doc.buyerIdNumber, schemeID: 'NRIC' }] },
                ],
                PartyName: [{ Name: [{ _: doc.buyerName }] }],
                PostalAddress: [{ Country: [{ IdentificationCode: [{ _: 'MYS' }] }] }],
                Contact: doc.buyerPhone ? [{ Telephone: [{ _: doc.buyerPhone }] }] : [],
              },
            ],
          },
        ],
        InvoiceLine: doc.lineItems.map((item, idx) => ({
          ID: [{ _: String(idx + 1) }],
          InvoicedQuantity: [{ _: item.qty, unitCode: 'C62' }],
          LineExtensionAmount: [{ _: item.total, currencyID: 'MYR' }],
          TaxTotal: [
            {
              TaxAmount: [{ _: item.taxAmount, currencyID: 'MYR' }],
              TaxSubtotal: [
                {
                  TaxableAmount: [{ _: item.unitPrice * item.qty, currencyID: 'MYR' }],
                  TaxAmount: [{ _: item.taxAmount, currencyID: 'MYR' }],
                  TaxCategory: [{ ID: [{ _: 'S' }], Percent: [{ _: item.unitPrice > 0 ? (item.taxAmount / (item.unitPrice * item.qty)) * 100 : 0 }], TaxScheme: [{ ID: [{ _: 'OTH', schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }] }] }],
                },
              ],
            },
          ],
          Item: [{ Description: [{ _: item.description }], CommodityClassification: [{ ItemClassificationCode: [{ _: '9800', listID: 'CLASS' }] }] }],
          Price: [{ PriceAmount: [{ _: item.unitPrice, currencyID: 'MYR' }] }],
        })),
        TaxTotal: [
          {
            TaxAmount: [{ _: doc.sstAmount, currencyID: 'MYR' }],
            TaxSubtotal: [
              {
                TaxableAmount: [{ _: doc.totalAmount - doc.sstAmount, currencyID: 'MYR' }],
                TaxAmount: [{ _: doc.sstAmount, currencyID: 'MYR' }],
                TaxCategory: [{ ID: [{ _: 'S' }], Percent: [{ _: doc.totalAmount > doc.sstAmount ? (doc.sstAmount / (doc.totalAmount - doc.sstAmount)) * 100 : 0 }], TaxScheme: [{ ID: [{ _: 'OTH', schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }] }] }],
              },
            ],
          },
        ],
        LegalMonetaryTotal: [
          {
            LineExtensionAmount: [{ _: doc.totalAmount - doc.sstAmount, currencyID: 'MYR' }],
            TaxExclusiveAmount: [{ _: doc.totalAmount - doc.sstAmount, currencyID: 'MYR' }],
            TaxInclusiveAmount: [{ _: doc.totalAmount, currencyID: 'MYR' }],
            PayableAmount: [{ _: doc.totalAmount, currencyID: 'MYR' }],
          },
        ],
      },
    ],
  };
}

// ─── Submit Document ──────────────────────────────────────────────────

/**
 * Submit an e-invoice document to MyInvois.
 * Returns the UIN on success, or an error message on failure.
 */
export async function submitEinvoice(doc: EinvoiceDocument): Promise<SubmissionResult> {
  const baseUrl = process.env.MYINVOIS_API_URL || 'https://preprod-api.myinvois.hasil.gov.my';

  try {
    const token = await getAccessToken();
    const payload = buildDocumentPayload(doc);

    const response = await fetch(`${baseUrl}/api/v1.0/documentsubmissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ documents: [{ format: 'JSON', document: Buffer.from(JSON.stringify(payload)).toString('base64'), documentHash: '', codeNumber: doc.transactionId }] }),
    });

    const raw = await response.json() as any;

    if (!response.ok) {
      logger.warn({ status: response.status, raw }, 'MyInvois submission rejected');
      return { success: false, error: raw?.error?.message || `HTTP ${response.status}`, raw };
    }

    // Response: { submissionUid, acceptedDocuments: [{ uuid, invoiceCodeNumber }] }
    const accepted = raw?.acceptedDocuments?.[0];
    if (!accepted?.uuid) {
      return { success: false, error: 'No UIN returned', raw };
    }

    // Poll for validation status (MyInvois processes asynchronously)
    const uin = await pollForValidation(baseUrl, token, raw.submissionUid, accepted.uuid);
    return { success: true, uin, raw };
  } catch (err: any) {
    logger.error({ err }, 'MyInvois submission error');
    return { success: false, error: err.message };
  }
}

/**
 * Poll MyInvois for document validation status.
 * MyInvois validates within seconds in sandbox; up to 30s in production.
 */
async function pollForValidation(
  baseUrl: string,
  token: string,
  submissionUid: string,
  documentUuid: string,
  maxAttempts = 6,
  intervalMs = 5000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));

    const response = await fetch(`${baseUrl}/api/v1.0/documentsubmissions/${submissionUid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) continue;

    const data = await response.json() as any;
    const docStatus = data?.documentSummary?.find((d: any) => d.uuid === documentUuid);

    if (docStatus?.status === 'Valid') {
      return docStatus.longId || documentUuid;
    }
    if (docStatus?.status === 'Invalid') {
      throw new Error(`Document invalid: ${docStatus.error?.message || 'unknown'}`);
    }
    // status === 'Submitted' — keep polling
  }

  throw new Error('Validation timeout: document not validated within 30s');
}

// ─── PDF Generation ───────────────────────────────────────────────────

/**
 * Generate a simple e-invoice PDF as a Buffer.
 *
 * Returns a minimal HTML-rendered PDF (no heavy dependencies).
 * In production this should use pdfmake or Puppeteer for richer formatting.
 */
export function generateEinvoicePdf(doc: EinvoiceDocument): Buffer {
  const itemRows = doc.lineItems.map(item =>
    `<tr>
      <td>${item.description}</td>
      <td style="text-align:right">${item.qty}</td>
      <td style="text-align:right">MYR ${item.unitPrice.toFixed(2)}</td>
      <td style="text-align:right">MYR ${item.taxAmount.toFixed(2)}</td>
      <td style="text-align:right">MYR ${item.total.toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>e-Invoice ${doc.uin || doc.transactionId}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;margin:40px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px}
th{background:#f0f0f0}.total{font-weight:bold}</style>
</head>
<body>
<h2>e-Invoice (MyInvois)</h2>
<p><b>UIN:</b> ${doc.uin || 'Pending'}</p>
<p><b>Invoice No:</b> ${doc.transactionId}</p>
<p><b>Date:</b> ${doc.transactionDate}</p>
<h3>Supplier</h3>
<p>${doc.supplierName}<br>TIN: ${doc.supplierTin}<br>${doc.supplierAddress}</p>
<h3>Customer</h3>
<p>${doc.buyerName}<br>ID: ${doc.buyerIdNumber}</p>
<h3>Line Items</h3>
<table>
<thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>SST</th><th>Total</th></tr></thead>
<tbody>${itemRows}</tbody>
</table>
<br>
<table style="width:300px;margin-left:auto">
<tr><td>SST Amount</td><td style="text-align:right">MYR ${doc.sstAmount.toFixed(2)}</td></tr>
<tr class="total"><td>Total Payable</td><td style="text-align:right">MYR ${doc.totalAmount.toFixed(2)}</td></tr>
</table>
<p style="margin-top:30px;font-size:10px;color:#666">
This e-invoice was submitted to LHDN MyInvois. UIN: ${doc.uin || 'Pending validation'}<br>
Verify at: https://myinvois.hasil.gov.my
</p>
</body></html>`;

  // Return as UTF-8 buffer (HTML-based PDF fallback)
  // In production: pipe through headless Chrome or pdfmake
  return Buffer.from(html, 'utf-8');
}

/**
 * Invalidate the cached OAuth2 token (useful for testing).
 */
export function clearTokenCache(): void {
  tokenCache = null;
}
