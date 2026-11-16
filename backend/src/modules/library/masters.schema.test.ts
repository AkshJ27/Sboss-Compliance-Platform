import { describe, it, expect } from 'vitest';
import { actCreateSchema, actUpdateSchema, lookupBodySchema, ruleUpdateSchema } from './masters.schema';

const category = '3f9a2b10-aaaa-4bbb-8ccc-000000000001';

describe('masters validation', () => {
    it('needs a state for a state Act and none for a central Act', () => {
        expect(actCreateSchema.safeParse({ name: 'Shops Act', jurisdiction: 'STATE', state: 'Maharashtra', lawCategoryId: category }).success).toBe(true);
        expect(actCreateSchema.safeParse({ name: 'Shops Act', jurisdiction: 'STATE', lawCategoryId: category }).success).toBe(false);
        expect(actCreateSchema.safeParse({ name: 'Payment of Wages Act, 1936', jurisdiction: 'CENTRAL', lawCategoryId: category }).success).toBe(true);
        expect(actCreateSchema.safeParse({ name: 'Wages', jurisdiction: 'CENTRAL', state: 'Delhi', lawCategoryId: category }).success).toBe(false);
        expect(actCreateSchema.safeParse({ name: 'Shops Act', jurisdiction: 'STATE', state: 'Atlantis', lawCategoryId: category }).success).toBe(false);
    });

    it('accepts partial Act changes but not empty ones', () => {
        expect(actUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
        expect(actUpdateSchema.safeParse({}).success).toBe(false);
        expect(actUpdateSchema.safeParse({ jurisdiction: 'STATE' }).success).toBe(false);
    });

    it('trims names and rejects very short ones', () => {
        expect(lookupBodySchema.parse({ name: '  Labour Laws ' })).toEqual({ name: 'Labour Laws' });
        expect(lookupBodySchema.safeParse({ name: 'x' }).success).toBe(false);
        expect(ruleUpdateSchema.safeParse({}).success).toBe(false);
        expect(ruleUpdateSchema.safeParse({ unknown: 1 }).success).toBe(false);
    });
});