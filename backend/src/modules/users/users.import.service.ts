import { randomBytes } from 'crypto';
import ExcelJS from 'exceljs';
import { recordAudit } from '../../lib/audit';
import { HttpError } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { prisma } from '../../lib/prisma';
import type { AuthUser } from '../../middleware/auth';
import { sendLinkAsAdmin } from '../auth/auth-tokens.service';
import { parseUserSheet, planUserImport } from './users.import.parser';
import type { RowError } from './users.import.parser';

const MAX_ERRORS_SHOWN = 200;
const TX = { timeout: 5 * 60 * 1000, maxWait: 10_000 };

async function readGrid(buffer: Buffer): Promise<unknown[][]> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
        throw new HttpError(400, 'Could not read the file. Save it as an Excel workbook (.xlsx) and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount === 0) throw new HttpError(400, 'The file is empty');
    const width = ws.columnCount;
    const grid: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        grid.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).value as unknown));
    }
    return grid;
}

const failure = (errors: RowError[], warnings: string[], fileErrors: string[] = []) => ({
    ok: false as const,
    fileErrors,
    errorCount: errors.length,
    errors: [...errors].sort((a, b) => a.row - b.row).slice(0, MAX_ERRORS_SHOWN),
    warnings,
});

const ROLE_LABEL = { ORG_ADMIN: 'Admin', MEMBER: 'Member', VIEWER: 'Viewer' } as const;

export async function importUsers(actor: AuthUser, buffer: Buffer, dryRun: boolean, invite: boolean) {
    const parsed = parseUserSheet(await readGrid(buffer));
    if (parsed.fileErrors.length || parsed.errors.length) return failure(parsed.errors, parsed.warnings, parsed.fileErrors);

    // Emails are unique across the whole platform, so another company's users are looked up too
    const existing = await prisma.user.findMany({
        where: { OR: [{ orgId: actor.orgId }, { email: { in: parsed.rows.map((r) => r.email), mode: 'insensitive' } }] },
        select: { id: true, orgId: true, email: true, name: true, role: true, isActive: true, managerId: true, defaultApproverId: true },
    });
    const plan = planUserImport(parsed.rows, existing, actor.orgId, actor.id);
    const warnings = [...parsed.warnings, ...plan.warnings];
    if (plan.errors.length) return failure(plan.errors, warnings);

    const inFile = new Set(parsed.rows.map((r) => r.email));
    const notInFile = existing.filter((u) => u.orgId === actor.orgId && !inFile.has(u.email.toLowerCase())).length;
    if (notInFile) warnings.push(`${notInFile} existing user(s) are not in the file. They are left as they are.`);

    const toCreate = plan.planned.filter((p) => !p.existingId);
    const toUpdate = plan.planned.filter((p) => p.existingId && p.changes.length);
    const result = {
        ok: true as const,
        dryRun,
        totalRows: parsed.totalRows,
        toCreate: toCreate.length,
        toUpdate: toUpdate.length,
        unchanged: plan.planned.length - toCreate.length - toUpdate.length,
        admins: plan.planned.filter((p) => p.row.role === 'ORG_ADMIN').length,
        inactive: plan.planned.filter((p) => !p.row.isActive).length,
        withManager: plan.planned.filter((p) => p.managerRef).length,
        withApprover: plan.planned.filter((p) => p.approverRef).length,
        warnings,
        invited: 0,
        inviteFailed: 0,
        sample: plan.planned.slice(0, 50).map((p) => ({
            row: p.row.row,
            name: p.row.name,
            email: p.row.email,
            role: ROLE_LABEL[p.row.role],
            status: p.row.isActive ? 'Active' : 'Inactive',
            manager: p.row.manager && p.managerRef ? p.row.manager : '',
            approver: p.row.approver && p.approverRef ? p.row.approver : '',
            action: !p.existingId ? 'New' : p.changes.length ? `Update: ${p.changes.join(', ')}` : 'No change',
        })),
    };
    if (dryRun) return result;

    // Passwords are hashed before the transaction, since hashing is slow on purpose
    const hashes = await Promise.all(toCreate.map(() => hashPassword(randomBytes(32).toString('base64url'))));

    const newIds = await prisma.$transaction(async (tx) => {
        const idOfEmail = new Map<string, string>();
        for (const [i, p] of toCreate.entries()) {
            const u = await tx.user.create({
                data: {
                    orgId: actor.orgId,
                    name: p.row.name,
                    email: p.row.email,
                    role: p.row.role,
                    isActive: p.row.isActive,
                    emailAlerts: p.row.emailAlerts,
                    mobile: p.row.mobile,
                    employeeCode: p.row.employeeCode,
                    passwordHash: hashes[i],
                    passwordSetAt: null, // invited: they choose their own password
                },
                select: { id: true },
            });
            idOfEmail.set(p.row.email, u.id);
        }
        const resolve = (ref: string | null) => (ref?.startsWith('email:') ? (idOfEmail.get(ref.slice(6)) ?? null) : ref);

        for (const p of plan.planned) {
            const id = p.existingId ?? (idOfEmail.get(p.row.email) as string);
            const data: Record<string, unknown> = {
                emailAlerts: p.row.emailAlerts,
                ...(p.row.mobile ? { mobile: p.row.mobile } : {}),
                ...(p.row.employeeCode ? { employeeCode: p.row.employeeCode } : {}),
                ...(p.managerRef ? { managerId: resolve(p.managerRef) } : {}),
                ...(p.approverRef ? { defaultApproverId: resolve(p.approverRef) } : {}),
            };
            if (p.existingId) Object.assign(data, { name: p.row.name, role: p.row.role, isActive: p.row.isActive });
            await tx.user.update({ where: { id }, data });
            // A deactivation or a role change ends the person's sessions, as on the Users page
            if (p.existingId && (p.changes.includes('deactivated') || p.changes.includes('role'))) {
                await tx.refreshToken.deleteMany({ where: { userId: id } });
            }
            if (p.existingId && p.changes.includes('deactivated')) {
                await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
            }
        }
        await recordAudit(tx, actor, 'USERS_IMPORTED', 'User', actor.orgId, {
            created: toCreate.length,
            updated: toUpdate.length,
            emails: plan.planned.map((p) => p.row.email).slice(0, 200),
        });
        return toCreate.filter((p) => p.row.isActive).map((p) => idOfEmail.get(p.row.email) as string);
    }, TX);

    // Invitations go out after saving, one by one. A failure here never undoes the upload.
    let invited = 0;
    let inviteFailed = 0;
    if (invite) {
        for (const id of newIds) {
            try {
                if (await sendLinkAsAdmin(actor, id, 'INVITE')) invited++;
                else inviteFailed++;
            } catch {
                inviteFailed++;
            }
        }
    }
    return { ...result, invited, inviteFailed };
}

// The format to fill in: the same columns as Complinity's users list
export async function userUploadFormat(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';
    const ws = wb.addWorksheet('User-Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols: [string, number, boolean][] = [
        ['First Name', 18, true], ['Last Name', 18, false], ['Email', 32, true], ['Status', 10, false], ['Manager', 26, false], ['Approver', 26, false],
        ['Compliance Role', 18, false], ['Email Alerts', 12, false], ['Mobile No.', 16, false], ['User ID', 12, false],
    ];
    ws.columns = cols.map(([header, width]) => ({ header, width }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    cols.forEach(([, , required], i) => {
        head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FFFFFF00' : 'FFD9E1F2' } };
    });
    for (let c = 1; c <= cols.length; c++) ws.getColumn(c).numFmt = '@';

    const help = wb.addWorksheet('Instructions');
    help.columns = [{ header: 'Column', width: 22 }, { header: 'How to fill it', width: 110 }];
    help.getRow(1).font = { bold: true };
    for (const r of [
        ['Complinity export', "Complinity's \"List of Users\" export can be uploaded as it is. Its title lines and extra columns are fine."],
        ['First Name, Last Name', 'Or one Name column instead.'],
        ['Email', 'Each person once. A person already here is matched by email and updated.'],
        ['Status', 'Active or Inactive. Blank means Active. Inactive people cannot sign in.'],
        ['Manager', "The reporting manager's full name as written in this list, or their email. They must be in this file or already a user."],
        ['Approver', "Who gives the final approval on this person's compliance items: full name as written in this list, or email. It fills in the Approver when compliances are assigned to them. Leave blank if none."],
        ['Compliance Role', 'Administrator (manages the setup), Owner/Manager (does the work) or Viewer (read only). Blank means Owner/Manager.'],
        ['Email Alerts', 'Yes or No. Blank means Yes.'],
        ['User ID', 'Their ID in another system, kept for reference.'],
        ['Passwords', 'New users choose their own password from an invitation email. Tick "Send invitations" when uploading, or send them later from the Users page.'],
    ]) help.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
}