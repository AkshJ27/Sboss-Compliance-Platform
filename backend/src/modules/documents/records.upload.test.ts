import { describe, it, expect } from 'vitest';
import { UPLOAD_COLUMNS, parseUploadSheet } from './records.upload.parser';
import { resolveUploadRows } from './records.upload.resolve';
import type { UploadLookups } from './records.upload.resolve';

const header = UPLOAD_COLUMNS.map((c) => c.header);
const row = (o: Partial<Record<string, string>> = {}) => {
    const base: Record<string, string> = {
        entity: 'SBOSS', vertical: 'Quess', department: 'CS and Compliance', location: 'New Delhi',
        name: 'Complinity Agreement', docNumber: '', category: 'Agreements', subCategory: '', subSubCategory: '',
        documentType: 'Restricted', storedAt: 'NA', reviewDate: '01-Nov-2026', expiryDate: '06-Mar-2027',
        alertDays: '150', remarks: '', files: 'NDA 07032024 - Signed.pdf; EULA.pdf', owner: 'CS@sboss.net.in', manager: '',
    };
    const v = { ...base, ...o };
    return UPLOAD_COLUMNS.map((c) => v[c.key] ?? '');
};

describe('document upload sheet', () => {
    it('reads a good row, with dates, alert days and several files', () => {
        const out = parseUploadSheet(header, [row(), row().map(() => '')]);
        expect(out.fileErrors).toEqual([]);
        expect(out.errors).toEqual([]);
        expect(out.totalRows).toBe(1); // the blank line is skipped
        expect(out.rows[0]).toMatchObject({
            row: 2, accessLevel: 'RESTRICTED', reviewDate: '2026-11-01', expiryDate: '2027-03-06', alertDays: 150,
            files: ['NDA 07032024 - Signed.pdf', 'EULA.pdf'], owner: 'cs@sboss.net.in', manager: null, docNumber: null,
        });
    });

    it('lists every problem with its row and column', () => {
        const out = parseUploadSheet(header, [
            row({ documentType: 'Secret', expiryDate: '', alertDays: '10' }),
            row({ name: '', reviewDate: '31-Feb-2026', owner: 'not-an-email', subSubCategory: 'X', files: 'a.pdf;A.PDF' }),
        ]);
        const msgs = out.errors.map((e) => `${e.row} ${e.field}: ${e.message}`);
        expect(msgs).toContain('2 Document Type: Use Public, Private, Protected or Restricted');
        expect(msgs).toContain('2 Alert Days: Alert days need an expiry date');
        expect(msgs).toContain('3 Document Name: Required');
        expect(msgs).toContain('3 Review Date: Use a date like 01-Jan-2026');
        expect(msgs).toContain('3 Document Owner Email: Not a valid email address');
        expect(msgs).toContain('3 Sub Sub Category: Fill in the sub category too');
        expect(msgs).toContain('3 Attachment Filename: "A.PDF" is listed twice');
    });

    it('needs the mandatory columns', () => {
        const out = parseUploadSheet(header.filter((h) => !h.startsWith('Category')), [row()]);
        expect(out.fileErrors[0]).toContain('"Category(Max Length=100)" is missing');
    });
});

const lookups = (over: Partial<UploadLookups> = {}): UploadLookups => ({
    entities: [{ id: 'e1', name: 'State Bank Operation Support Services Private Limited', code: 'SBOSS', isActive: true }],
    verticals: [{ id: 'v1', name: 'Quess', isActive: true }],
    departments: [{ id: 'd1', name: 'CS and Compliance', isActive: true }],
    locations: [{ id: 'l1', name: 'New Delhi', entityId: 'e1', isActive: true }],
    categories: [
        { id: 'c1', name: 'Agreements', level: 1, parentId: null, isActive: true },
        { id: 's1', name: 'Vendor', level: 2, parentId: 'c1', isActive: true },
    ],
    users: [{ id: 'u1', email: 'cs@sboss.net.in', isActive: true, role: 'ORG_ADMIN' }],
    zipPaths: ['signed/NDA 07032024 - Signed.pdf', 'EULA.pdf', 'extra.docx'],
    existing: new Set<string>(),
    ...over,
});

describe('document upload matching', () => {
    it('matches names (entity by code too), categories and zip files case-insensitively', () => {
        const rows = parseUploadSheet(header, [row({ subCategory: 'vendor', files: 'nda 07032024 - signed.PDF;eula.pdf' })]).rows;
        const out = resolveUploadRows(rows, lookups());
        expect(out.errors).toEqual([]);
        expect(out.resolved[0]).toMatchObject({ entityId: 'e1', locationId: 'l1', categoryId: 'c1', subCategoryId: 's1', ownerId: 'u1', fileIndexes: [0, 1] });
        expect(out.warnings[0]).toContain('"extra.docx"');
    });

    it('reports what cannot be found', () => {
        const rows = parseUploadSheet(header, [row({ location: 'Mumbai', subCategory: 'Lease', files: 'missing.pdf', manager: 'viewer@sboss.net.in' })]).rows;
        const out = resolveUploadRows(rows, lookups({
            users: [
                { id: 'u1', email: 'cs@sboss.net.in', isActive: true, role: 'ORG_ADMIN' },
                { id: 'u2', email: 'viewer@sboss.net.in', isActive: true, role: 'VIEWER' },
            ]
        }));
        const msgs = out.errors.map((e) => `${e.field}: ${e.message}`);
        expect(msgs).toContain('Location: "Mumbai" is not a location of State Bank Operation Support Services Private Limited');
        expect(msgs.some((m) => m.startsWith('Sub Category: No sub category named "Lease" under Agreements'))).toBe(true);
        expect(msgs).toContain('Attachment Filename: "missing.pdf" is not in the zip');
        expect(msgs).toContain('Document Manager Email: viewer@sboss.net.in is a view-only user and cannot be the manager');
        expect(out.resolved).toEqual([]);
    });

    it('asks for the folder when two zip files share a name, and warns about repeats', () => {
        const rows = parseUploadSheet(header, [row({ files: 'EULA.pdf' }), row({ files: 'b/EULA.pdf' })]).rows;
        const out = resolveUploadRows(rows, lookups({ zipPaths: ['a/EULA.pdf', 'b/EULA.pdf'], existing: new Set(['l1|complinity agreement']) }));
        expect(out.errors).toHaveLength(1);
        expect(out.errors[0].message).toContain('more than one "EULA.pdf"');
        expect(out.resolved[0].fileIndexes).toEqual([1]);
        expect(out.warnings[0]).toContain('already exists at New Delhi');
    });
});