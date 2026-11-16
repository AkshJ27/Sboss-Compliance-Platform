import { describe, it, expect } from 'vitest';
import type { InternalRawRow } from './internal.parser';
import { existingTitleKey, internalPrefix, nextCodes, resolveInternalRows } from './internal.resolve';
import type { InternalLookups } from './internal.resolve';

const raw = (over: Partial<InternalRawRow> = {}): InternalRawRow => ({
    row: 2,
    title: 'Monthly MIS',
    description: 'Send it',
    rule: { frequency: 'MONTHLY', dueDay: 10, dueMonthOffset: 1, event: null, dueDaysAfterEvent: null },
    periodBasis: 'FINANCIAL_YEAR',
    effectiveDate: '2026-04-01',
    attachment: 'OPTIONAL',
    proof: null,
    risk: 'MEDIUM',
    entity: 'State Bank Operation Support Services',
    department: 'finance',
    location: 'new delhi',
    owner: 'owner@x.com',
    alertOwnerDays: 7,
    manager: 'manager@x.com',
    alertManagerDays: 3,
    approver: null,
    vertical: 'SBOSS',
    lawCategory: null,
    nature: null,
    penalty: null,
    ...over,
});

const lookups = (over: Partial<InternalLookups> = {}): InternalLookups => ({
    entities: [{ id: 'e1', code: 'SBOSS', name: 'State Bank Operation Support Services', isActive: true }],
    locations: [
        { id: 'l1', entityId: 'e1', name: 'New Delhi', state: 'Delhi', isActive: true },
        { id: 'l2', entityId: 'e1', name: 'Closed Office', state: 'Delhi', isActive: false },
    ],
    users: new Map([
        ['owner@x.com', { id: 'u1', name: 'Owner', isActive: true, role: 'MEMBER' }],
        ['manager@x.com', { id: 'u2', name: 'Manager', isActive: true, role: 'MEMBER' }],
        ['approver@x.com', { id: 'u3', name: 'Approver', isActive: true, role: 'ORG_ADMIN' }],
        ['viewer@x.com', { id: 'u4', name: 'Viewer', isActive: true, role: 'VIEWER' }],
    ]),
    departments: new Map([['finance', { id: 'd1', isActive: true }]]),
    verticals: new Map([['sboss', { id: 'v1', isActive: true }]]),
    lawCategories: new Map([['corporate laws', { id: 'c1', name: 'Corporate Laws' }]]),
    natures: new Map([['assurance', { id: 'n1', name: 'Assurance' }]]),
    existing: new Map(),
    ...over,
});

describe('resolveInternalRows', () => {
    it('matches names case-insensitively and the entity by name or code', () => {
        const { resolved, errors } = resolveInternalRows([raw(), raw({ row: 3, title: 'Other', entity: 'sboss' })], lookups());
        expect(errors).toEqual([]);
        expect(resolved[0]).toMatchObject({
            entityId: 'e1', locationId: 'l1', departmentId: 'd1', verticalId: 'v1',
            ownerId: 'u1', managerId: 'u2', approverId: null, lawCategoryName: 'Internal Compliance', natureId: null,
        });
        expect(resolved[1].entityId).toBe('e1');
    });

    it('uses the law category and nature when given', () => {
        const { resolved } = resolveInternalRows([raw({ lawCategory: 'CORPORATE LAWS', nature: 'assurance' })], lookups());
        expect(resolved[0]).toMatchObject({ lawCategoryName: 'Corporate Laws', natureId: 'n1' });
    });

    it('reports unknown and inactive records', () => {
        const { resolved, errors } = resolveInternalRows(
            [raw({ location: 'Closed Office', department: 'Legal', vertical: 'Nope', lawCategory: 'Space Law', nature: 'Odd' })],
            lookups(),
        );
        expect(resolved).toEqual([]);
        expect(errors.map((e) => e.field)).toEqual(['location', 'department', 'vertical', 'law category', 'compliance nature']);
    });

    it('applies the people rules', () => {
        const same = resolveInternalRows([raw({ manager: 'owner@x.com' })], lookups());
        expect(same.errors[0]).toMatchObject({ field: 'manager email' });

        const high = resolveInternalRows([raw({ risk: 'HIGH' })], lookups());
        expect(high.errors[0]).toMatchObject({ field: 'approval level 1 email' });

        const ok = resolveInternalRows([raw({ risk: 'HIGH', approver: 'approver@x.com' })], lookups());
        expect(ok.errors).toEqual([]);
        expect(ok.resolved[0].approverId).toBe('u3');

        const viewer = resolveInternalRows([raw({ owner: 'viewer@x.com' })], lookups());
        expect(viewer.errors[0]).toMatchObject({ field: 'owner email' });
    });

    it('catches duplicates in the file and ones that already exist', () => {
        const inFile = resolveInternalRows([raw(), raw({ row: 3, title: '  monthly   MIS ' })], lookups());
        expect(inFile.errors).toEqual([expect.objectContaining({ row: 3, message: 'Same name and location as row 2' })]);

        const before = resolveInternalRows([raw()], lookups({ existing: new Map([[existingTitleKey('l1', 'Monthly MIS'), 'IC1-0001']]) }));
        expect(before.errors[0].message).toContain('IC1-0001');
    });
});

describe('codes', () => {
    it('continue from the highest number the company has', () => {
        const prefix = internalPrefix('3f9a2b10-aaaa-bbbb-cccc-000000000000');
        expect(prefix).toBe('IC3F9A2B10-');
        expect(nextCodes(prefix, [`${prefix}0002`, `${prefix}0010`, 'OTHER-0099'], 2)).toEqual([`${prefix}0011`, `${prefix}0012`]);
        expect(nextCodes(prefix, [], 1)).toEqual([`${prefix}0001`]);
    });
});