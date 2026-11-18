import { describe, it, expect } from 'vitest';
import { activeWhere } from './active-filter';

describe('the Active / Inactive / All filter', () => {
    it('shows active ones unless asked otherwise', () => {
        expect(activeWhere({})).toEqual({ isActive: true });
        expect(activeWhere({ status: 'active', includeInactive: true })).toEqual({ isActive: true });
    });
    it('shows only inactive ones, or all', () => {
        expect(activeWhere({ status: 'inactive' })).toEqual({ isActive: false });
        expect(activeWhere({ status: 'all' })).toEqual({});
        expect(activeWhere({ includeInactive: true })).toEqual({});
    });
});