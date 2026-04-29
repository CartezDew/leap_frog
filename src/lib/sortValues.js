// Shared sort helpers for tables (DataTable, heatmaps, etc.).

/** Null/empty last; numbers numerically; else locale string compare. */
export function compareValues(a, b, dir) {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  const aNum = typeof a === 'number' ? a : Number(a);
  const bNum = typeof b === 'number' ? b : Number(b);
  const bothNumeric = Number.isFinite(aNum) && Number.isFinite(bNum);

  let cmp;
  if (bothNumeric) {
    cmp = aNum - bNum;
  } else {
    cmp = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
  return dir === 'asc' ? cmp : -cmp;
}

export function defaultDirForColumn(col) {
  return col.align === 'right' ? 'desc' : 'asc';
}
