import ExcelJS from 'exceljs';
import { HttpError } from '../../lib/errors';
import type { AuthUser } from '../../middleware/auth';
import { notifyLawChange } from '../notifications/law-change.notify';
import { parseComplinityLibrary } from './complinity.parser';
import type { Sheet } from './complinity.parser';
import { commitImport, planImport } from './import.service';

const MAX_ERRORS_SHOWN = 200;

async function readSheets(buffer: Buffer): Promise<Sheet[]> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
        throw new HttpError(400, 'Could not read the file. Save it as an Excel workbook (.xlsx) and try again.');
    }
    return wb.worksheets.map((ws) => {
        const width = ws.columnCount;
        const grid: unknown[][] = [];
        for (let r = 1; r <= ws.rowCount; r++) {
            const row = ws.getRow(r);
            grid.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).value as unknown));
        }
        return { name: ws.name, grid };
    });
}

// Loads Complinity's compliance details export into the shared statutory library. Checked first with dryRun.
export async function importComplinityLibrary(actor: AuthUser, buffer: Buffer, dryRun: boolean) {
    const parsed = parseComplinityLibrary(await readSheets(buffer));
    if (parsed.fileErrors.length || parsed.errors.length) {
        return {
            ok: false as const,
            fileErrors: parsed.fileErrors,
            errorCount: parsed.errors.length,
            errors: parsed.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => ({ row: e.row, field: `${e.sheet}: ${e.field ?? ''}`, message: e.message })),
            ignoredColumns: [] as string[],
            warnings: parsed.warnings,
        };
    }

    const plan = await planImport(parsed.rows);
    const body = {
        ok: true as const,
        dryRun,
        ignoredColumns: [] as string[],
        ...plan.summary,
        mapped: parsed.rows.filter((r) => r.mapped).length,
        inactive: parsed.rows.filter((r) => r.data.isActive === false).length,
        warnings: parsed.warnings,
    };
    if (dryRun) return body;

    await commitImport(actor, plan);
    // After saving, and never allowed to break the reply. Items already in use whose rules changed are flagged for review.
    void notifyLawChange(plan.updates.map((u) => u.id)).catch((e) => console.error('[law-change] could not notify', e));
    return body;
}