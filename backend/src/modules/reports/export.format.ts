export type Cell = string | number | null | undefined;
export type Column<T> = { header: string; width: number; get: (row: T) => Cell };

// A spreadsheet runs text that starts with one of these as a formula
const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function neutralize(v: Cell): string | number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    return v.length > 0 && FORMULA_STARTS.has(v[0]) ? `'${v}` : v;
}

function csvField(v: string | number | null): string {
    if (v === null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// UTF-8 with a byte order mark, so Excel reads accents correctly. Lines end in CRLF.
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
    const lines = [columns.map((c) => csvField(neutralize(c.header))).join(',')];
    for (const r of rows) {
        lines.push(columns.map((c) => csvField(neutralize(c.get(r)))).join(','));
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
}