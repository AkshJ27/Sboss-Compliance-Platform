import type { AttachmentRule, RiskLevel } from '@prisma/client';
import { cellText, normHeader } from './internal.parser';
import type { RowError } from './internal.parser';

// Reads the update format: one row per existing internal compliance, found by its code.
// Only the descriptive fields can change here. Timing (periodicity, due day) is fixed once
// items exist, because changing it would move work people have already started.
// Everything here is plain logic with no database, so it is easy to test.

export type EditableFields = {
    title: string;
    description: string;
    attachment: AttachmentRule;
    proofOfCompliance: string | null;
    risk: RiskLevel;
    applicability: string | null;
    penalty: string | null;
    alertOwnerDays: number;
    alertManagerDays: number;
    isActive: boolean;
};
export type UpdateKey = 'code' | keyof EditableFields;

export const UPDATE_COLUMNS: { key: UpdateKey; header: string; width: number }[] = [
    { key: 'code', header: 'Compliance Code (do not change)', width: 18 },
    { key: 'title', header: 'Compliance Name (Length=500)*', width: 40 },
    { key: 'description', header: 'Compliance Description (Length=20000)*', width: 50 },
    { key: 'attachment', header: 'Attachment(M/O)*', width: 12 },
    { key: 'proofOfCompliance', header: 'Proof of Compliance (Length=1000)', width: 30 },
    { key: 'risk', header: 'Risk (H/M/L)*', width: 10 },
    { key: 'applicability', header: 'Applicability (Length=2000)', width: 30 },
    { key: 'penalty', header: 'Penalty (Length=2000)', width: 40 },
    { key: 'alertOwnerDays', header: 'Alert Owner (no of days)*', width: 12 },
    { key: 'alertManagerDays', header: 'Alert Manager (no of days)*', width: 12 },
    { key: 'isActive', header: 'Active (Y/N)*', width: 10 },
];

const LABEL: Record<UpdateKey, string> = {
    code: 'compliance code',
    title: 'compliance name',
    description: 'description',
    attachment: 'attachment',
    proofOfCompliance: 'proof of compliance',
    risk: 'risk',
    applicability: 'applicability',
    penalty: 'penalty',
    alertOwnerDays: 'alert owner',
    alertManagerDays: 'alert manager',
    isActive: 'active',
};

const HEADER_TO_KEY = new Map<string, UpdateKey>([
    ['compliancecode', 'code'],
    ['complianceid', 'code'],
    ['compliancename', 'title'],
    ['compliancedescription', 'description'],
    ['description', 'description'],
    ['attachment', 'attachment'],
    ['proofofcompliance', 'proofOfCompliance'],
    ['risk', 'risk'],
    ['applicability', 'applicability'],
    ['penalty', 'penalty'],
    ['alertowner', 'alertOwnerDays'],
    ['alertmanager', 'alertManagerDays'],
    ['active', 'isActive'],
    ['activeflag', 'isActive'],
]);

const MAX: Partial<Record<UpdateKey, number>> = {
    title: 500,
    description: 20000,
    proofOfCompliance: 1000,
    applicability: 2000,
    penalty: 2000,
};

export type UpdateRow = { row: number; code: string; fields: EditableFields };

const ATTACH: Record<string, AttachmentRule> = { m: 'MANDATORY', mandatory: 'MANDATORY', o: 'OPTIONAL', optional: 'OPTIONAL' };
const RISK: Record<string, RiskLevel> = { h: 'HIGH', high: 'HIGH', m: 'MEDIUM', medium: 'MEDIUM', l: 'LOW', low: 'LOW' };
const ACTIVE: Record<string, boolean> = { y: true, yes: true, active: true, n: false, no: false, inactive: false };
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

// Checks the descriptive fields of one compliance. Used by the update file and by the edit form.
export function checkEditable(v: Partial<Record<keyof EditableFields, string>>, row: number) {
    const errors: RowError[] = [];
    const fail = (key: UpdateKey, message: string) => errors.push({ row, field: LABEL[key], message });
    const t = (k: keyof EditableFields) => (v[k] ?? '').trim();

    for (const [k, max] of Object.entries(MAX) as [UpdateKey, number][]) {
        if (k !== 'code' && t(k).length > max) fail(k, `Too long (at most ${max} characters)`);
    }
    if (!t('title')) fail('title', 'This is required');
    else if (t('title').length < 3) fail('title', 'At least 3 characters');
    if (!t('description')) fail('description', 'This is required');

    const attachment = ATTACH[letters(t('attachment'))];
    if (!attachment) fail('attachment', 'Use M (mandatory) or O (optional)');
    const risk = RISK[letters(t('risk'))];
    if (!risk) fail('risk', 'Use H, M or L');
    const isActive = ACTIVE[letters(t('isActive'))];
    if (isActive === undefined) fail('isActive', 'Use Y or N');

    const days = (k: 'alertOwnerDays' | 'alertManagerDays') => {
        const s = t(k);
        if (!/^\d+$/.test(s) || Number(s) > 999) {
            fail(k, 'Enter a whole number of days, 0 to 999');
            return null;
        }
        return Number(s);
    };
    const alertOwnerDays = days('alertOwnerDays');
    const alertManagerDays = days('alertManagerDays');
    if (alertOwnerDays !== null && alertManagerDays !== null && alertOwnerDays <= alertManagerDays) {
        fail('alertOwnerDays', 'Owner alert days must be more than manager alert days');
    }

    if (errors.length > 0 || !attachment || !risk || isActive === undefined || alertOwnerDays === null || alertManagerDays === null) {
        return { fields: null, errors };
    }
    const fields: EditableFields = {
        title: t('title'),
        description: t('description'),
        attachment,
        proofOfCompliance: t('proofOfCompliance') || null,
        risk,
        applicability: t('applicability') || null,
        penalty: t('penalty') || null,
        alertOwnerDays,
        alertManagerDays,
        isActive,
    };
    return { fields, errors };
}

export function parseUpdateSheet(header: unknown[], body: unknown[][], maxRows: number) {
    const keyAt = new Map<number, UpdateKey>();
    const seenKeys = new Set<UpdateKey>();
    header.forEach((h, i) => {
        const key = HEADER_TO_KEY.get(normHeader(cellText(h)));
        if (key && !seenKeys.has(key)) {
            seenKeys.add(key);
            keyAt.set(i, key);
        }
    });

    const fileErrors: string[] = [];
    const missing = UPDATE_COLUMNS.filter((c) => !seenKeys.has(c.key)).map((c) => c.header);
    if (missing.length) fileErrors.push(`Missing columns: ${missing.join(', ')}. Download the update format again.`);

    const rows: UpdateRow[] = [];
    const errors: RowError[] = [];
    const codes = new Map<string, number>();
    let counted = 0;

    if (fileErrors.length === 0) {
        body.forEach((cells, i) => {
            const rowNo = i + 2;
            const v: Partial<Record<UpdateKey, string>> = {};
            let any = false;
            for (const [col, key] of keyAt) {
                const s = cellText(cells[col]);
                if (s) any = true;
                v[key] = s;
            }
            if (!any) return;
            counted++;
            if (counted > maxRows) return;

            const code = (v.code ?? '').trim().toUpperCase();
            if (!code) {
                errors.push({ row: rowNo, field: LABEL.code, message: 'This is required' });
                return;
            }
            const first = codes.get(code);
            if (first !== undefined) {
                errors.push({ row: rowNo, field: LABEL.code, message: `Same code as row ${first}` });
                return;
            }
            codes.set(code, rowNo);

            const checked = checkEditable(v, rowNo);
            errors.push(...checked.errors);
            if (checked.fields) rows.push({ row: rowNo, code, fields: checked.fields });
        });
        if (counted === 0) fileErrors.push('The file has no data rows');
        if (counted > maxRows) fileErrors.push(`Too many rows (at most ${maxRows}). Split the file.`);
    }
    return { rows, errors, fileErrors, totalRows: counted };
}

// The fields that differ between what is stored and what was uploaded
export function changedEditable(before: EditableFields, after: EditableFields): Partial<EditableFields> {
    const out: Partial<EditableFields> = {};
    for (const k of Object.keys(after) as (keyof EditableFields)[]) {
        if (before[k] !== after[k]) (out as Record<string, unknown>)[k] = after[k];
    }
    return out;
}