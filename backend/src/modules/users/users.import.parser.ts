import type { Role } from '@prisma/client';
import { cellText, normHeader } from '../library/internal.parser';

// Reads a users list: Complinity's "List of Users" export as it is, or the format downloaded here.
// Plain logic with no database, so it is easy to test.

export const MAX_USER_ROWS = 2000;

type Key = 'firstName' | 'lastName' | 'name' | 'email' | 'status' | 'manager' | 'approver' | 'role' | 'emailAlerts' | 'mobile' | 'employeeCode';

const KEY_OF: Record<string, Key> = {
    firstname: 'firstName',
    lastname: 'lastName',
    name: 'name', username: 'name', fullname: 'name',
    email: 'email', emailid: 'email', useremail: 'email',
    status: 'status',
    manager: 'manager', reportingmanager: 'manager', manageremail: 'manager',
    approver: 'approver', defaultapprover: 'approver', approvedby: 'approver', approveremail: 'approver',
    compliancerole: 'role', role: 'role',
    emailalerts: 'emailAlerts',
    mobileno: 'mobile', mobile: 'mobile', mobilenumber: 'mobile',
    userid: 'employeeCode', employeecode: 'employeeCode', employeeid: 'employeeCode',
};

// Columns of Complinity's export that this app does not use. They are named in one warning.
const KNOWN_UNUSED = new Set([
    'createdon', 'entity', 'department', 'location', 'vertical', 'lockstatus', 'dailyescalationstatus',
    'ipbasedauthentication', 'lastlogindate',
]);

// Complinity's roles, and the words people use, mapped to this app's three roles
const ROLE_OF: Record<string, Role> = {
    administrator: 'ORG_ADMIN', admin: 'ORG_ADMIN', orgadmin: 'ORG_ADMIN', superadmin: 'ORG_ADMIN',
    ownermanager: 'MEMBER', owner: 'MEMBER', manager: 'MEMBER', approver: 'MEMBER', user: 'MEMBER', member: 'MEMBER',
    performer: 'MEMBER', reviewer: 'MEMBER',
    viewer: 'VIEWER', readonly: 'VIEWER', auditor: 'VIEWER', management: 'VIEWER', view: 'VIEWER',
};

export type RowError = { row: number; field?: string; message: string };

export type UserRow = {
    row: number;
    name: string;
    email: string; // lower case
    role: Role;
    isActive: boolean;
    emailAlerts: boolean;
    manager: string | null; // a name or an email, as written
    approver: string | null; // approves their compliance items by default: a name or an email
    mobile: string | null;
    employeeCode: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LABEL: Record<Key, string> = {
    firstName: 'First Name', lastName: 'Last Name', name: 'Name', email: 'Email', status: 'Status', manager: 'Manager', approver: 'Approver',
    role: 'Compliance Role', emailAlerts: 'Email Alerts', mobile: 'Mobile No.', employeeCode: 'User ID',
};

export function parseUserRow(cells: Partial<Record<Key, string>>, row: number): { data: UserRow | null; errors: RowError[] } {
    const errors: RowError[] = [];
    const err = (key: Key, message: string) => errors.push({ row, field: LABEL[key], message });
    const get = (key: Key) => (cells[key] ?? '').trim().replace(/\s+/g, ' ');

    const name = get('name') || [get('firstName'), get('lastName')].filter(Boolean).join(' ');
    if (name.length < 2) err(get('name') ? 'name' : 'firstName', 'Enter the name');
    else if (name.length > 120) err('firstName', 'The name is longer than 120 characters');

    const email = get('email').toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) err('email', 'Not a valid email address');

    const roleText = get('role');
    const role = roleText ? ROLE_OF[roleText.toLowerCase().replace(/[^a-z]/g, '')] : 'MEMBER';
    if (!role) err('role', `Use Administrator, Owner/Manager or Viewer, not "${roleText}"`);

    const status = get('status').toLowerCase();
    if (status && status !== 'active' && status !== 'inactive') err('status', 'Use Active or Inactive');

    const alerts = get('emailAlerts').toLowerCase();
    if (alerts && !['yes', 'no', 'y', 'n'].includes(alerts)) err('emailAlerts', 'Use Yes or No');

    const mobile = get('mobile');
    if (mobile && !/^[+\d][\d\s-]{6,19}$/.test(mobile)) err('mobile', 'Not a valid phone number');
    const employeeCode = get('employeeCode');
    if (employeeCode.length > 50) err('employeeCode', 'Longer than 50 characters');

    if (errors.length) return { data: null, errors };
    return {
        data: {
            row,
            name,
            email,
            role: role as Role,
            isActive: status !== 'inactive',
            emailAlerts: !alerts.startsWith('n'),
            manager: get('manager') || null,
            approver: get('approver') || null,
            mobile: mobile || null,
            employeeCode: employeeCode || null,
        },
        errors,
    };
}

export function parseUserSheet(grid: unknown[][]) {
    const fileErrors: string[] = [];
    const warnings: string[] = [];
    const errors: RowError[] = [];
    const rows: UserRow[] = [];

    // The export has a few title lines above the headings
    const headerAt = grid.slice(0, 15).findIndex((r) => r.some((c) => KEY_OF[normHeader(cellText(c))] === 'email'));
    if (headerAt < 0) {
        fileErrors.push('Could not find the heading row with an Email column');
        return { rows, errors, fileErrors, warnings, totalRows: 0 };
    }

    const columnOf = new Map<Key, number>();
    const unused: string[] = [];
    grid[headerAt].forEach((h, i) => {
        const text = cellText(h);
        if (!text) return;
        const norm = normHeader(text);
        const key = KEY_OF[norm];
        if (key && !columnOf.has(key)) columnOf.set(key, i);
        else if (!key) unused.push(KNOWN_UNUSED.has(norm) ? text.replace(/\*$/, '') : `"${text}"`);
    });
    if (!columnOf.has('name') && !columnOf.has('firstName')) fileErrors.push('The sheet needs a Name column, or First Name and Last Name');
    if (unused.length) warnings.push(`These columns are not used and were ignored: ${unused.join(', ')}`);
    if (fileErrors.length) return { rows, errors, fileErrors, warnings, totalRows: 0 };

    let totalRows = 0;
    const notes: number[] = [];
    const seen = new Map<string, number>();
    for (let i = headerAt + 1; i < grid.length; i++) {
        const values: Partial<Record<Key, string>> = {};
        for (const [key, col] of columnOf) values[key] = cellText(grid[i][col]);
        if (Object.values(values).every((v) => !v)) continue;
        // A line with text but no email is a note under the list, not a person
        if (!values.email) {
            notes.push(i + 1);
            continue;
        }
        totalRows++;
        if (totalRows > MAX_USER_ROWS) continue;
        const out = parseUserRow(values, i + 1);
        errors.push(...out.errors);
        if (!out.data) continue;
        const earlier = seen.get(out.data.email);
        if (earlier) {
            errors.push({ row: i + 1, field: 'Email', message: `The same email is already on row ${earlier}` });
            continue;
        }
        seen.set(out.data.email, i + 1);
        rows.push(out.data);
    }
    if (notes.length) warnings.push(`Row(s) ${notes.join(', ')} have no email and were skipped`);
    if (totalRows === 0) fileErrors.push('The sheet has no users under the heading row');
    if (totalRows > MAX_USER_ROWS) fileErrors.push(`At most ${MAX_USER_ROWS} users per upload`);
    return { rows, errors, fileErrors, warnings, totalRows };
}

// ---- Matching against the company's users ------------------------------------------------

export type ExistingUser = {
    id: string;
    orgId: string;
    email: string;
    name: string;
    role: Role;
    isActive: boolean;
    managerId: string | null;
    defaultApproverId: string | null;
};

export type PlannedUser = {
    row: UserRow;
    existingId: string | null; // null: a new user
    changes: string[]; // what changes for an existing user
    managerRef: string | null; // an existing id, or "email:<email>" for someone in this file, or null
    approverRef: string | null; // the same, for the default approver
};

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function planUserImport(rows: readonly UserRow[], existing: readonly ExistingUser[], orgId: string, actorId: string) {
    const errors: RowError[] = [];
    const warnings: string[] = [];
    const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

    // Managers and approvers are written as a name (Complinity) or an email. Names are matched against this file and the company.
    const byName = new Map<string, string[]>();
    const addName = (name: string, ref: string) => byName.set(key(name), [...new Set([...(byName.get(key(name)) ?? []), ref])]);
    for (const u of existing) if (u.orgId === orgId) addName(u.name, u.id);
    for (const r of rows) {
        const found = byEmail.get(r.email);
        addName(r.name, found && found.orgId === orgId ? found.id : `email:${r.email}`);
    }
    const refOfEmail = (email: string) => {
        const found = byEmail.get(email);
        if (found && found.orgId === orgId) return found.id;
        return rows.some((r) => r.email === email) ? `email:${email}` : null;
    };

    const planned: PlannedUser[] = [];
    const missingManagers = new Map<string, number[]>();
    const missingApprovers = new Map<string, number[]>();
    for (const r of rows) {
        const found = byEmail.get(r.email);
        if (found && found.orgId !== orgId) {
            errors.push({ row: r.row, field: 'Email', message: `${r.email} belongs to another company on this platform` });
            continue;
        }
        if (found?.id === actorId && (!r.isActive || r.role !== 'ORG_ADMIN')) {
            errors.push({ row: r.row, field: 'Status', message: 'This is you. You cannot deactivate yourself or remove your own admin role.' });
            continue;
        }

        // A person written as a name (Complinity) or an email, in this file or already a user
        const selfRef = found ? found.id : `email:${r.email}`;
        const findPerson = (text: string | null, what: 'manager' | 'approver', missing: Map<string, number[]>): string | null => {
            if (!text) return null;
            const byEmailRef = text.includes('@') ? refOfEmail(text.toLowerCase()) : null;
            const byNameRefs = text.includes('@') ? [] : (byName.get(key(text)) ?? []);
            let ref: string | null = null;
            if (byEmailRef) ref = byEmailRef;
            else if (byNameRefs.length === 1) ref = byNameRefs[0];
            else if (byNameRefs.length > 1) warnings.push(`Row ${r.row}: more than one user is called "${text}", so the ${what} was left empty`);
            else missing.set(text, [...(missing.get(text) ?? []), r.row]);
            if (ref === selfRef) {
                warnings.push(`Row ${r.row}: a person cannot be their own ${what}, so it was left empty`);
                return null;
            }
            return ref;
        };
        const managerRef = findPerson(r.manager, 'manager', missingManagers);
        const approverRef = findPerson(r.approver, 'approver', missingApprovers);
        if (approverRef) {
            const a = rows.find((x) => `email:${x.email}` === approverRef) ?? existing.find((u) => u.id === approverRef);
            const inactive = !!a && !a.isActive;
            const viewer = !!a && a.role === 'VIEWER';
            if (inactive || viewer) {
                errors.push({ row: r.row, field: 'Approver', message: `${r.approver} is ${inactive ? 'inactive' : 'a viewer'}, so cannot approve` });
                continue;
            }
        }

        const changes: string[] = [];
        if (found) {
            if (found.name !== r.name) changes.push('name');
            if (found.role !== r.role) changes.push('role');
            if (found.isActive !== r.isActive) changes.push(r.isActive ? 'activated' : 'deactivated');
            if (r.manager && managerRef && managerRef !== found.managerId) changes.push('manager');
            if (r.approver && approverRef && approverRef !== found.defaultApproverId) changes.push('approver');
        }
        planned.push({ row: r, existingId: found?.id ?? null, changes, managerRef, approverRef });
    }

    for (const [name, rowsOf] of missingManagers) {
        warnings.push(`Manager "${name}" (row ${rowsOf.join(', ')}) is not a user yet, so it was left empty. Add them and upload again to link.`);
    }
    for (const [name, rowsOf] of missingApprovers) {
        warnings.push(`Approver "${name}" (row ${rowsOf.join(', ')}) is not a user yet, so it was left empty. Add them and upload again to link.`);
    }
    return { planned, errors, warnings };
}