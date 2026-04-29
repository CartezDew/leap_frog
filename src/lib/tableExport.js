import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function sanitizeStem(stem) {
  return String(stem || 'export').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'export';
}

function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v;
}

/**
 * @param {string} fileStem - without extension
 * @param {string} sheetName - Excel sheet tab (max 31 chars)
 * @param {string[]} headers
 * @param {Array<Array<string|number|boolean|null>>} bodyRows
 */
export function downloadSheetAsXlsx(fileStem, sheetName, headers, bodyRows) {
  const stem = sanitizeStem(fileStem);
  const tab = String(sheetName || 'Sheet1').slice(0, 31) || 'Sheet1';
  const aoa = [headers.map(normalizeCell), ...bodyRows.map((r) => r.map(normalizeCell))];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, tab);
  XLSX.writeFile(wb, `${stem}.xlsx`);
}

/**
 * @param {string} fileStem
 * @param {string[]} headers
 * @param {Array<Array<string|number|boolean|null>>} bodyRows
 * @param {{ title?: string }} [opts]
 */
export function downloadTableAsPdf(fileStem, headers, bodyRows, opts = {}) {
  const stem = sanitizeStem(fileStem);
  const title = opts.title ? String(opts.title) : '';
  const doc = new jsPDF({
    orientation: bodyRows[0]?.length > 8 ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });
  let startY = 40;
  if (title) {
    doc.setFontSize(11);
    doc.text(title, 40, 32);
    startY = 48;
  }
  autoTable(doc, {
    startY,
    head: [headers.map((h) => String(h ?? ''))],
    body: bodyRows.map((row) => row.map((c) => String(normalizeCell(c)))),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [82, 46, 145], textColor: 255 },
    margin: { left: 36, right: 36 },
  });
  doc.save(`${stem}.pdf`);
}
