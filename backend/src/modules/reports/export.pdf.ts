import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

// One sheet per record: a coloured status banner, then a two-column table of labels and values.
// Plain logic with no database, so a sample can be rendered and checked.

export type DetailSheet = {
    status: string;
    color: string; // the status colour, such as #e5383b
    rows: [string, string][];
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const LABEL_W = 135;
const SIZE = 8.5;
const LINE = 11;
const PAD = 3.5;
const FOOTER_SPACE = 28;
const BORDER = rgb(0.96, 0.76, 0.48);
const LABEL_BG = rgb(1, 0.97, 0.91);
const DARK = rgb(0.13, 0.13, 0.13);

const hexToRgb = (hex: string): RGB => {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
// Dark text on light colours (yellow, pink, grey), white text on dark ones (red, green)
const textOn = (hex: string) => {
    const n = Number.parseInt(hex.replace('#', ''), 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum > 170 ? DARK : rgb(1, 1, 1);
};

// The built-in PDF fonts only have Western European letters. Common symbols are swapped
// for close equivalents and anything else becomes "?", so no record can break the file.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfSafe(text: string): string {
    return text
        .replace(/₹/g, 'Rs.')
        .replace(/\t/g, ' ')
        .replace(/\r\n?/g, '\n')
        .split('')
        .map((ch) => {
            if (ch === '\n') return ch;
            const c = ch.charCodeAt(0);
            if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) return ch;
            return '?';
        })
        .join('');
}

// Splits text into lines that fit the width, breaking very long words when they must
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const tryLine = line ? `${line} ${word}` : word;
            if (font.widthOfTextAtSize(tryLine, size) <= width) {
                line = tryLine;
                continue;
            }
            if (line) out.push(line);
            let rest = word;
            while (font.widthOfTextAtSize(rest, size) > width) {
                let cut = rest.length - 1;
                while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
                out.push(rest.slice(0, cut));
                rest = rest.slice(cut);
            }
            line = rest;
        }
        out.push(line);
    }
    return out.length ? out : [''];
}

export async function toDetailPdf(sheets: DetailSheet[], opts: { heading: string; footer: string }): Promise<Buffer> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(opts.heading);
    pdf.setCreator('Compliance Platform');
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const width = A4[0] - MARGIN * 2;
    const valueW = width - LABEL_W;
    let page: PDFPage = pdf.addPage(A4);
    let y = A4[1] - MARGIN;

    const newPage = () => {
        page = pdf.addPage(A4);
        y = A4[1] - MARGIN;
    };

    sheets.forEach((sheet, index) => {
        if (index > 0) newPage();

        // Heading and status banner
        const heading = pdfSafe(opts.heading);
        const hw = bold.widthOfTextAtSize(heading, 13);
        page.drawText(heading, { x: MARGIN + (width - hw) / 2, y: y - 13, size: 13, font: bold, color: DARK });
        y -= 24;
        const status = pdfSafe(sheet.status);
        page.drawRectangle({ x: MARGIN, y: y - 16, width, height: 16, color: hexToRgb(sheet.color) });
        const sw = bold.widthOfTextAtSize(status, 9);
        page.drawText(status, { x: MARGIN + (width - sw) / 2, y: y - 11.5, size: 9, font: bold, color: textOn(sheet.color) });
        y -= 24;

        for (const [label, value] of sheet.rows) {
            const labelLines = wrap(label, bold, SIZE, LABEL_W - PAD * 2);
            const valueLines = wrap(value, regular, SIZE, valueW - PAD * 2);
            const lines = Math.max(labelLines.length, valueLines.length);
            let start = 0;

            // A long value carries on over as many pages as it needs
            while (start < lines) {
                const room = Math.floor((y - MARGIN - FOOTER_SPACE - PAD * 2) / LINE);
                if (room < 1) {
                    newPage();
                    continue;
                }
                const take = Math.min(room, lines - start);
                const h = take * LINE + PAD * 2;

                page.drawRectangle({ x: MARGIN, y: y - h, width: LABEL_W, height: h, color: LABEL_BG, borderColor: BORDER, borderWidth: 0.6 });
                page.drawRectangle({ x: MARGIN + LABEL_W, y: y - h, width: valueW, height: h, borderColor: BORDER, borderWidth: 0.6 });
                for (let i = 0; i < take; i++) {
                    const ty = y - PAD - (i + 1) * LINE + 2.5;
                    const l = labelLines[start + i];
                    const v = valueLines[start + i];
                    if (l) page.drawText(l, { x: MARGIN + PAD, y: ty, size: SIZE, font: bold, color: DARK });
                    if (v) page.drawText(v, { x: MARGIN + LABEL_W + PAD, y: ty, size: SIZE, font: regular, color: DARK });
                }
                y -= h;
                start += take;
                if (start < lines) newPage();
            }
        }
    });

    // Footer on every page
    const pages = pdf.getPages();
    const footer = pdfSafe(opts.footer);
    pages.forEach((p, i) => {
        p.drawText(footer, { x: MARGIN, y: MARGIN / 2, size: 7.5, font: regular, color: rgb(0.4, 0.4, 0.4) });
        const label = `Page ${i + 1} of ${pages.length}`;
        p.drawText(label, {
            x: A4[0] - MARGIN - regular.widthOfTextAtSize(label, 7.5),
            y: MARGIN / 2,
            size: 7.5,
            font: regular,
            color: rgb(0.4, 0.4, 0.4),
        });
    });

    return Buffer.from(await pdf.save());
}