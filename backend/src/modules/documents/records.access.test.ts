import { describe, it, expect } from 'vitest';
import { canDelete, canEdit, canOpenFiles, openableRecords, visibleRecords } from './records.access';

const admin = { id: 'a', orgId: 'o', role: 'ORG_ADMIN' as const };
const member = { id: 'm', orgId: 'o', role: 'MEMBER' as const };
const viewer = { id: 'v', orgId: 'o', role: 'VIEWER' as const };

const rec = (accessLevel: string, extra: Partial<{ ownerId: string; managerId: string | null; createdById: string; additionalUserIds: string[] }> = {}) => ({
    accessLevel,
    ownerId: 'x',
    managerId: null,
    createdById: 'x',
    additionalUserIds: [],
    ...extra,
});

describe('document repository access', () => {
    it('lets admins see and open everything', () => {
        expect(visibleRecords(admin)).toEqual({ orgId: 'o', deletedAt: null });
        expect(canOpenFiles(admin, rec('RESTRICTED'))).toBe(true);
    });

    it('opens public files for everyone, others only for the named people', () => {
        expect(canOpenFiles(viewer, rec('PUBLIC'))).toBe(true);
        expect(canOpenFiles(member, rec('PROTECTED'))).toBe(false);
        expect(canOpenFiles(member, rec('PROTECTED', { additionalUserIds: ['m'] }))).toBe(true);
        expect(canOpenFiles(member, rec('PRIVATE', { managerId: 'm' }))).toBe(true);
    });

    it('keeps the manager out of restricted documents', () => {
        expect(canOpenFiles(member, rec('RESTRICTED', { managerId: 'm' }))).toBe(false);
        expect(canOpenFiles(member, rec('RESTRICTED', { ownerId: 'm' }))).toBe(true);
    });

    it('lists protected documents for everyone but hides private ones', () => {
        const where = visibleRecords(member) as { OR: { accessLevel: { in: string[] } }[] };
        expect(where.OR[0].accessLevel.in).toEqual(['PUBLIC', 'PROTECTED']);
        const open = openableRecords(member) as { OR: { accessLevel: { in: string[] } }[] };
        expect(open.OR[0].accessLevel.in).toEqual(['PUBLIC']);
    });

    it('never lets a viewer change anything, and only admins or owners delete', () => {
        expect(canEdit(viewer, rec('PUBLIC', { ownerId: 'v' }))).toBe(false);
        expect(canEdit(member, rec('PUBLIC', { managerId: 'm' }))).toBe(true);
        expect(canDelete(member, rec('PUBLIC', { managerId: 'm' }))).toBe(false);
        expect(canDelete(member, rec('PUBLIC', { ownerId: 'm' }))).toBe(true);
        expect(canDelete(admin, rec('PUBLIC'))).toBe(true);
    });
});


describe('vendor users limited to verticals', () => {
    const vendor = { id: 'v1', orgId: 'o1', role: 'MEMBER' as const, verticalIds: ['quess'] };
    it('see Public and Protected documents of their verticals, or ones they are named on', () => {
        const w = visibleRecords(vendor) as { OR: unknown[] };
        expect(w.OR[0]).toEqual({
            accessLevel: { in: ['PUBLIC', 'PROTECTED'] },
            OR: [{ verticalId: { in: ['quess'] } }, { ownerId: 'v1' }, { managerId: 'v1' }, { createdById: 'v1' }, { additionalUsers: { some: { userId: 'v1' } } }],
        });
    });
    it('open Public files only for their verticals, or ones they are named on', () => {
        const w = openableRecords(vendor) as { OR: unknown[] };
        expect(w.OR[0]).toMatchObject({ accessLevel: { in: ['PUBLIC'] }, OR: expect.arrayContaining([{ verticalId: { in: ['quess'] } }]) });
    });
    it('everyone else is not limited, and admins never are', () => {
        expect((visibleRecords({ id: 'u', orgId: 'o1', role: 'MEMBER' }) as { OR: unknown[] }).OR[0]).toEqual({ accessLevel: { in: ['PUBLIC', 'PROTECTED'] } });
        expect(visibleRecords({ id: 'a', orgId: 'o1', role: 'ORG_ADMIN', verticalIds: ['quess'] })).toEqual({ orgId: 'o1', deletedAt: null });
    });
});