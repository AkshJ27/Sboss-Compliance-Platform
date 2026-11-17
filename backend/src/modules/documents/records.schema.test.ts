import { describe, it, expect } from 'vitest';
import { categoryCreateSchema, ownerSwapSchema, recordCreateSchema, recordListQuerySchema, recordUpdateSchema } from './records.schema';

const id = (n: number) => `3f9a2b10-aaaa-4bbb-8ccc-00000000000${n}`;
const base = {
    entityId: id(1), verticalId: id(2), locationId: id(3), departmentId: id(4), categoryId: id(5),
    name: 'Complinity Agreement', accessLevel: 'RESTRICTED',
};

describe('document repository validation', () => {
    it('accepts a full document and rejects a sub sub category without its sub category', () => {
        expect(recordCreateSchema.safeParse({ ...base, expiryDate: '2027-03-06', alertDays: 150 }).success).toBe(true);
        expect(recordCreateSchema.safeParse({ ...base, subSubCategoryId: id(7) }).success).toBe(false);
        expect(recordCreateSchema.safeParse({ ...base, alertDays: 1000 }).success).toBe(false);
        expect(recordCreateSchema.safeParse({ ...base, name: 'x'.repeat(501) }).success).toBe(false);
        expect(recordCreateSchema.safeParse({ ...base, expiryDate: '2027-02-30' }).success).toBe(false);
    });

    it('needs something to change', () => {
        expect(recordUpdateSchema.safeParse({}).success).toBe(false);
        expect(recordUpdateSchema.safeParse({ remarks: null }).success).toBe(true);
    });

    it('fills in list defaults', () => {
        expect(recordListQuerySchema.parse({})).toMatchObject({ sort: 'createdAt', order: 'desc', page: 1, limit: 25 });
        expect(recordListQuerySchema.safeParse({ sort: 'password' }).success).toBe(false);
    });

    it('checks categories and owner swaps', () => {
        expect(categoryCreateSchema.parse({ name: '  Agreements ' })).toEqual({ name: 'Agreements' });
        expect(ownerSwapSchema.safeParse({ fromUserId: id(1), toUserId: id(1) }).success).toBe(false);
        expect(ownerSwapSchema.safeParse({ fromUserId: id(1), toUserId: id(2) }).success).toBe(true);
    });
});