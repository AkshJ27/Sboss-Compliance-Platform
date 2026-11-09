import { HttpError } from './errors';

type Rule = { contentType: string; matches: (b: Buffer) => boolean };

const starts = (b: Buffer, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const isText = (b: Buffer) => !b.subarray(0, 8192).includes(0);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx and xlsx are zip files
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // old doc and xls

// A Map, so a name like "x.constructor" can never match something it shouldn't
const RULES = new Map<string, Rule>([
    ['pdf', { contentType: 'application/pdf', matches: (b) => starts(b, PDF) }],
    ['png', { contentType: 'image/png', matches: (b) => starts(b, PNG) }],
    ['jpg', { contentType: 'image/jpeg', matches: (b) => starts(b, JPEG) }],
    ['jpeg', { contentType: 'image/jpeg', matches: (b) => starts(b, JPEG) }],
    ['docx', { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matches: (b) => starts(b, ZIP) }],
    ['xlsx', { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', matches: (b) => starts(b, ZIP) }],
    ['doc', { contentType: 'application/msword', matches: (b) => starts(b, OLE) }],
    ['xls', { contentType: 'application/vnd.ms-excel', matches: (b) => starts(b, OLE) }],
    ['csv', { contentType: 'text/csv', matches: isText }],
    ['txt', { contentType: 'text/plain', matches: isText }],
]);

export const ALLOWED_EXTENSIONS = [...RULES.keys()];

export function checkFile(fileName: string, buffer: Buffer) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
    const rule = RULES.get(ext);

    if (!rule) {
        throw new HttpError(400, `This file type is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }
    if (buffer.length === 0) throw new HttpError(400, 'The file is empty');
    if (!rule.matches(buffer)) {
        throw new HttpError(400, `The file does not look like a real .${ext} file`);
    }
    return { ext, contentType: rule.contentType };
}

// A safe name for display and download: no folders, no control characters, at most 200 characters
export function cleanFileName(raw: string): string {
    let name = raw;

    // Uploads arrive decoded as latin1. Undo that when the bytes were really UTF-8.
    if ([...name].every((c) => c.charCodeAt(0) <= 0xff)) {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        if (!decoded.includes('\uFFFD')) name = decoded;
    }

    const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
    const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (cleaned.length <= 200) return cleaned;

    const dot = cleaned.lastIndexOf('.');
    const ext = dot > 0 && cleaned.length - dot <= 20 ? cleaned.slice(dot) : '';
    return cleaned.slice(0, 200 - ext.length) + ext;
}