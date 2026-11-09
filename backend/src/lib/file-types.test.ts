import { describe, it, expect } from 'vitest';
import { checkFile, cleanFileName } from './file-types';

describe('checkFile', () => {
    it('accepts a real pdf', () => {
        expect(checkFile('a.pdf', Buffer.from('%PDF-1.4\n'))).toEqual({
            ext: 'pdf',
            contentType: 'application/pdf',
        });
    });

    it('ignores the case of the extension', () => {
        expect(checkFile('SCAN.PDF', Buffer.from('%PDF-1.7')).ext).toBe('pdf');
    });

    it('rejects a pdf that is not a pdf', () => {
        expect(() => checkFile('a.pdf', Buffer.from('MZ this is a program'))).toThrow(/does not look like/);
    });

    it('rejects types that are not on the list', () => {
        for (const name of ['a.exe', 'a.html', 'a.svg', 'readme', 'x.constructor', 'x.__proto__']) {
            expect(() => checkFile(name, Buffer.from('hello'))).toThrow(/not allowed/);
        }
    });

    it('rejects an empty file', () => {
        expect(() => checkFile('a.pdf', Buffer.alloc(0))).toThrow(/empty/);
    });

    it('accepts zip based office files', () => {
        expect(checkFile('a.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14])).ext).toBe('docx');
    });

    it('rejects binary content in a text file', () => {
        expect(() => checkFile('a.txt', Buffer.from([0x68, 0x00, 0x69]))).toThrow(/does not look like/);
    });
});

describe('cleanFileName', () => {
    it('removes folders from the name', () => {
        expect(cleanFileName('C:\\Users\\me\\proof.pdf')).toBe('proof.pdf');
        expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    });

    it('removes control characters', () => {
        expect(cleanFileName('a\u0000b\u001f.pdf')).toBe('ab.pdf');
    });

    it('keeps the extension when shortening', () => {
        const n = cleanFileName('a'.repeat(300) + '.pdf');
        expect(n).toHaveLength(200);
        expect(n.endsWith('.pdf')).toBe(true);
    });

    it('repairs names that were decoded as latin1', () => {
        expect(cleanFileName(Buffer.from('café.pdf', 'utf8').toString('latin1'))).toBe('café.pdf');
    });

    it('leaves real accented names alone', () => {
        expect(cleanFileName('café.pdf')).toBe('café.pdf');
    });
});