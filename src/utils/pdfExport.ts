/**
 * BURSARIQ - BROWSER PDF EXPORT UTILITY
 *
 * Generates professionally formatted, printable PDF documents directly from the browser:
 * 1. Financial Reports (Revenue summary, Term collections, Defaulter balances)
 * 2. Student List tables (Class lists, Enrolled students with status and parent contact)
 *
 * Design & Layout Features:
 * - Pure client-side generation using isolated printing iframe (Zero external API / zero data leak)
 * - Automatic page break control and repeated thead across pages: thead { display: table-header-group; }
 * - Formal Nigerian School letterhead with official emerald accents
 * - Clean tabular layout with proper zebra striping
 * - Instructs user how to save directly as PDF via the browser print dialog
 */

export interface SchoolLetterheadInfo {
  name: string;
  slug?: string;
  email?: string;
  phone?: string;
  address?: string;
  state?: string;
  logoUrl?: string;
}

export interface PdfTableColumn {
  header: string;
  key: string;
  align?: 'left' | 'center' | 'right';
  format?: (val: any, row: any) => string;
}

export interface ExportPdfOptions {
  title: string;
  subtitle?: string;
  school: SchoolLetterheadInfo;
  columns: PdfTableColumn[];
  data: any[];
  summaryItems?: Array<{ label: string; value: string }>;
  footerNote?: string;
}

/**
 * Triggers a native browser print-to-PDF flow using an isolated hidden iframe
 */
export function exportTableToPdf(options: ExportPdfOptions): void {
  const { title, subtitle, school, columns, data, summaryItems, footerNote } = options;

  const printDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const printTime = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const columnsHtml = columns
    .map(
      (col) =>
        `<th style="padding: 9px 12px; text-align: ${col.align || 'left'}; background-color: #0f172a; color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #1e293b; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${col.header}</th>`
    )
    .join('');

  const rowsHtml = data
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const cells = columns
        .map((col) => {
          const val = row[col.key];
          const displayVal = col.format ? col.format(val, row) : val !== undefined && val !== null ? String(val) : '-';
          return `<td style="padding: 8px 12px; text-align: ${col.align || 'left'}; font-size: 11px; color: #334155; border: 1px solid #cbd5e1; page-break-inside: avoid;">${displayVal}</td>`;
        })
        .join('');
      return `<tr style="background-color: ${bg}; page-break-inside: avoid;">${cells}</tr>`;
    })
    .join('');

  const summaryHtml =
    summaryItems && summaryItems.length > 0
      ? `<div style="display: flex; gap: 14px; margin-bottom: 18px; flex-wrap: wrap;">
          ${summaryItems
            .map(
              (item) => `
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 14px; flex: 1; min-width: 130px; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 2px;">${item.label}</div>
              <div style="font-size: 15px; font-weight: 800; color: #0f172a;">${item.value}</div>
            </div>`
            )
            .join('')}
        </div>`
      : '';

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title} - ${school.name}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 14mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .header-table {
            width: 100%;
            border-bottom: 2.5px solid #0f172a;
            padding-bottom: 10px;
            margin-bottom: 14px;
          }
          .school-title {
            font-size: 19px;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.02em;
            margin: 0 0 4px 0;
            text-transform: uppercase;
          }
          .school-sub {
            font-size: 11px;
            color: #475569;
            margin: 0;
            line-height: 1.4;
          }
          .doc-badge {
            text-align: right;
          }
          .doc-badge h2 {
            margin: 0;
            font-size: 15px;
            font-weight: 800;
            color: #059669;
            text-transform: uppercase;
          }
          .doc-badge p {
            margin: 3px 0 0 0;
            font-size: 11px;
            color: #64748b;
          }
          table.data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 6px;
            margin-bottom: 16px;
          }
          thead {
            display: table-header-group; /* Repeats table header across pages in print */
          }
          tr {
            page-break-inside: avoid;
          }
          .footer-note {
            font-size: 10px;
            color: #94a3b8;
            margin-top: 20px;
            border-top: 1px solid #e2e8f0;
            padding-top: 8px;
            display: flex;
            justify-content: space-between;
          }
          @media screen {
            body {
              padding: 20px;
            }
          }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td style="vertical-align: top;">
              <h1 class="school-title">${school.name}</h1>
              <p class="school-sub">
                ${school.address ? `${school.address}, ` : ''}${school.state ? `${school.state}, Nigeria` : 'Nigeria'}
                ${school.phone ? ` • Tel: ${school.phone}` : ''}
                ${school.email ? ` • Email: ${school.email}` : ''}
              </p>
            </td>
            <td class="doc-badge" style="vertical-align: top;">
              <h2>${title}</h2>
              <p>${subtitle || 'Official Statement'}</p>
              <p style="font-size: 10px; color: #64748b;">Generated: ${printDate} at ${printTime}</p>
            </td>
          </tr>
        </table>

        ${summaryHtml}

        <table class="data-table">
          <thead>
            <tr>${columnsHtml}</tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div class="footer-note">
          <span>${footerNote || 'Official BursarIQ Record • Authoritative Financial Ledger • Powered by bursariq.com.ng'}</span>
          <span>Printed Document (Select "Save as PDF" to download)</span>
        </div>
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1500);
  }, 300);
}
