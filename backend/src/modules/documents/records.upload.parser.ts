import type { AccessLevel } from '@prisma/client';
import { cellText, normHeader, parseDayMonthYear } from '../library/internal.parser';

// Reads the rows of the Document Data Upload format (Complinity's columns, in the same order).
// Plain logic with no database, so it is easy to test.

export const MAX_UPLOAD_ROWS = 500;
export const MAX_FILES_PER_ROW = 25;

export type UploadKey =
    | 'entity' | 'vertical' | 'department' | 'location' | 'name' | 'docNumber' | 'category' | 'subCategory'
    | 'subSubCategory' | 'documentType' | 'storedAt' | 'reviewDate' | 'expiryDate' | 'alertDays' | 'remarks'
    | 'files' | 'owner' | 'manager';

export const UPLOAD_COLUMNS: { key: UploadKey; header: string; label: string; required: boolean; max?: number; width: number }[] = [
    { key: 'entity', header: 'Entity(Max Length=100)', label: 'Entity', required: true, max: 100, width: 34 },
    { key: 'vertical', header: 'Vertical (Max Length=100)', label: 'Vertical', required: true, max: 100, width: 22 },
    { key: 'department', header: 'Department(Max Length=200)', label: 'Department', required: true, max: 200, width: 24 },
    { key: 'location', header: 'Location(Max Length=100)', label: 'Location', required: true, max: 100, width: 22 },
    { key: 'name', header: 'Document Name(Max Length=500)', label: 'Document Name', required: true, max: 500, width: 36 },
    { key: 'docNumber', header: 'Document Number(Max Length=100)', label: 'Document Number', required: false, max: 100, width: 20 },
    { key: 'category', header: 'Category(Max Length=100)', label: 'Category', required: true, max: 100, width: 22 },
    { key: 'subCategory', header: 'Sub Category(Max Length=100)', label: 'Sub Category', required: false, max: 100, width: 22 },
    { key: 'subSubCategory', header: 'Sub Sub Category(Max Length=100)', label: 'Sub Sub Category', required: false, max: 100, width: 22 },
    { key: 'documentType', header: 'Document Type(Max Length=20)', label: 'Document Type', required: true, max: 20, width: 16 },
    { key: 'storedAt', header: 'Document Location(Max Length=200)', label: 'Document Location', required: false, max: 200, width: 24 },
    { key: 'reviewDate', header: 'Review Date(dd-Mon-yyyy(01-Jan-2018))', label: 'Review Date', required: false, width: 18 },
    { key: 'expiryDate', header: 'Expiry Date(dd-Mon-yyyy(01-Jan-2018))', label: 'Expiry Date', required: false, width: 18 },
    { key: 'alertDays', header: 'Alert Days(Max Length=3)', label: 'Alert Days', required: false, width: 12 },
    { key: 'remarks', header: 'Remarks(Max Length=1000)', label: 'Remarks', required: false, max: 1000, width: 30 },
    { key: 'files', header: 'Attachment Filename', label: 'Attachment Filename', required: true, max: 1000, width: 40 },
    { key: 'owner', header: 'Document Owner Email', label: 'Document Owner Email', required: true, max: 200, width: 30 },
    { key: 'manager', header: 'Document Manager Email', label: 'Document Manager Email', required: false, max: 200, width: 30 },
];

const LABEL = Object.fromEntries(UPLOAD_COLUMNS.map((c) => [c.key, c.label])) as Record<UploadKey, string>;

// Header text with its "(Max Length=...)" part and spacing removed
const HEADER_KEYS: Record<string, UploadKey> = {
    entity: 'entity', entityname: 'entity',
    vertical: 'vertical', verticalname: 'vertical',
    department: 'department', departmentname: 'department',
    location: 'location', locationname: 'location',
    documentname: 'name',
    documentnumber: 'docNumber', documentno: 'docNumber',
    category: 'category',
    subcategory: 'subCategory',
    subsubcategory: 'subSubCategory',
    documenttype: 'documentType',
    documentlocation: 'storedAt',
    reviewdate: 'reviewDate',
    expirydate: 'expiryDate',
    alertdays: 'alertDays',
    remarks: 'remarks',
    attachmentfilename: 'files', attachmentfilenames: 'files', attachment: 'files',
    documentowneremail: 'owner', owneremail: 'owner',
    documentmanageremail: 'manager', manageremail: 'manager',
};

const ACCESS: Record<string, AccessLevel> = {
    public: 'PUBLIC', private: 'PRIVATE', protected: 'PROTECTED', restricted: 'RESTRICTED',
};

export type RowError = { row: number; field?: string; message: string };

export type UploadRow = {
    row: number; // the row number in Excel, so errors point at the right line
    entity: string;
    vertical: string;
    department: string;
    location: string;
    name: string;
    docNumber: string | null;
    category: string;
    subCategory: string | null;
    subSubCategory: string | null;
    accessLevel: AccessLevel;
    storedAt: string | null;
    reviewDate: string | null; // YYYY-MM-DD
    expiryDate: string | null;
    alertDays: number | null;
    remarks: string | null;
    files: string[];
    owner: string; // lower case
    manager: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseUploadRow(cells: Partial<Record<UploadKey, string>>, row: number): { data: UploadRow | null; errors: RowError[] } {
    const errors: RowError[] = [];
    const err = (key: UploadKey, message: string) => errors.push({ row, field: LABEL[key], message });
    const get = (key: UploadKey) => (cells[key] ?? '').trim();

    for (const c of UPLOAD_COLUMNS) {
        const v = get(c.key);
        if (c.required && !v) err(c.key, 'Required');
        else if (c.max && v.length > c.max) err(c.key, `Longer than ${c.max} characters`);
    }

    const accessLevel = ACCESS[get('documentType').toLowerCase()];
    if (get('documentType') && !accessLevel) err('documentType', 'Use Public, Private, Protected or Restricted');

    const date = (key: 'reviewDate' | 'expiryDate') => {
        const v = get(key);
        if (!v) return null;
        const d = parseDayMonthYear(v);
        if (!d) err(key, 'Use a date like 01-Jan-2026');
        return d;
    };
    const reviewDate = date('reviewDate');
    const expiryDate = date('expiryDate');

    let alertDays: number | null = null;
    const a = get('alertDays');
    if (a) {
        if (!/^\d{1,3}$/.test(a)) err('alertDays', 'Use a whole number from 0 to 999');
        else if (!get('expiryDate')) err('alertDays', 'Alert days need an expiry date');
        else alertDays = Number(a);
    }

    if (get('subSubCategory') && !get('subCategory')) err('subSubCategory', 'Fill in the sub category too');

    const owner = get('owner').toLowerCase();
    if (owner && !EMAIL.test(owner)) err('owner', 'Not a valid email address');
    const manager = get('manager').toLowerCase() || null;
    if (manager && !EMAIL.test(manager)) err('manager', 'Not a valid email address');

    // "File1.pdf; File2.pdf" -> two files. A folder inside the zip may be written as "folder/File1.pdf".
    const files = get('files')
        .split(/[;\n]/)
        .map((f) => f.trim().replace(/\\/g, '/'))
        .filter(Boolean);
    if (files.length > MAX_FILES_PER_ROW) err('files', `At most ${MAX_FILES_PER_ROW} files per document`);
    const seen = new Set<string>();
    for (const f of files) {
        const k = f.toLowerCase();
        if (seen.has(k)) err('files', `"${f}" is listed twice`);
        seen.add(k);
    }

    if (errors.length) return { data: null, errors };
    const orNull = (key: UploadKey) => get(key) || null;
    return {
        data: {
            row,
            entity: get('entity'),
            vertical: get('vertical'),
            department: get('department'),
            location: get('location'),
            name: get('name'),
            docNumber: orNull('docNumber'),
            category: get('category'),
            subCategory: orNull('subCategory'),
            subSubCategory: orNull('subSubCategory'),
            accessLevel,
            storedAt: orNull('storedAt'),
            reviewDate,
            expiryDate,
            alertDays,
            remarks: orNull('remarks'),
            files,
            owner,
            manager,
        },
        errors,
    };
}

export function parseUploadSheet(header: unknown[], body: unknown[][]) {
    const fileErrors: string[] = [];
    const warnings: string[] = [];
    const errors: RowError[] = [];
    const rows: UploadRow[] = [];

    // Find each column by its heading, so a reordered sheet still works
    const columnOf = new Map<UploadKey, number>();
    header.forEach((h, i) => {
        const text = cellText(h);
        if (!text) return;
        const key = HEADER_KEYS[normHeader(text)];
        if (!key) {
            warnings.push(`The column "${text}" is not part of the format and was ignored`);
        } else if (columnOf.has(key)) {
            fileErrors.push(`The column "${LABEL[key]}" appears twice`);
        } else {
            columnOf.set(key, i);
        }
    });
    for (const c of UPLOAD_COLUMNS) {
        if (c.required && !columnOf.has(c.key)) fileErrors.push(`The column "${c.header}" is missing. Download the format again.`);
    }
    if (fileErrors.length) return { rows, errors, fileErrors, warnings, totalRows: 0 };

    let totalRows = 0;
    body.forEach((cells, i) => {
        const values: Partial<Record<UploadKey, string>> = {};
        for (const [key, col] of columnOf) values[key] = cellText(cells[col]);
        if (Object.values(values).every((v) => !v)) return; // blank lines are skipped
        totalRows++;
        if (totalRows > MAX_UPLOAD_ROWS) return;
        const out = parseUploadRow(values, i + 2);
        errors.push(...out.errors);
        if (out.data) rows.push(out.data);
    });

    if (totalRows === 0) fileErrors.push('The sheet has no documents in it. Fill in rows under the heading row.');
    if (totalRows > MAX_UPLOAD_ROWS) fileErrors.push(`At most ${MAX_UPLOAD_ROWS} documents per upload. This file has ${totalRows}. Split it into smaller files.`);
    return { rows, errors, fileErrors, warnings, totalRows };
}