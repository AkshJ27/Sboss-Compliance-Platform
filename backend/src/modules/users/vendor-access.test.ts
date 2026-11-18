import { describe, it, expect } from 'vitest';
import { domainOf, planVendorAccess } from './vendor-access';
import type { AccessUser } from './vendor-access';

const user = (id: string, email: string, o: Partial<AccessUser> = {}): AccessUser => ({ id, name: id, email, role: 'MEMBER', isActive: true, verticalIds: [], ...o });

describe('vendor access', () => {
    it('reads the email domain', () => {
        expect(domainOf('Pradeep.Panwar@QuessCorp.com')).toBe('quesscorp.com');
    });

    it('limits outside users to the verticals of their items, and leaves the company and admins alone', () => {
        const users = [
            user('akshay', 'cs@sboss.net.in', { role: 'ORG_ADMIN' }),
            user('amita', 'hr13@sboss.net.in'),
            user('pradeep', 'pradeep.panwar@quesscorp.com'),
            user('nidhi', 'nidhi.babbar@adecco.com', { verticalIds: ['adecco'] }),
            user('ketan', 'payroll@rajendramanagement.com'),
            user('old', 'old@vendor.in', { isActive: false }),
        ];
        const schedules = [
            { ownerId: 'pradeep', managerId: 'amita', approverId: null, verticalId: 'quess' },
            { ownerId: 'nidhi', managerId: 'amita', approverId: null, verticalId: 'adecco' },
            { ownerId: 'amita', managerId: 'shashi', approverId: null, verticalId: 'sboss' },
            { ownerId: 'old', managerId: 'amita', approverId: null, verticalId: 'tmi' },
        ];
        const plan = planVendorAccess(users, schedules, 'sboss.net.in');
        expect(plan.vendors).toEqual([
            { userId: 'pradeep', name: 'pradeep', email: 'pradeep.panwar@quesscorp.com', verticalIds: ['quess'], changed: true },
            { userId: 'nidhi', name: 'nidhi', email: 'nidhi.babbar@adecco.com', verticalIds: ['adecco'], changed: false },
        ]);
        expect(plan.withoutItems).toEqual([{ name: 'ketan', email: 'payroll@rajendramanagement.com' }]);
    });
});