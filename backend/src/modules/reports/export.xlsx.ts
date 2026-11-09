import ExcelJS from 'exceljs';
import { neutralize, type Column } from './export.format';

export async function toXlsx<T>(rows: T[], columns: Column<T>[], sheetName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Compliance Platform';
    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

    ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(columns.map((c) => neutralize(c.get(r))));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

    return Buffer.from(await wb.xlsx.writeBuffer());
}