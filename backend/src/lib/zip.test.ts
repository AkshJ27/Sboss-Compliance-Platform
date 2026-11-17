import { describe, it, expect } from 'vitest';
import { readZip } from './zip';

// Made with Python's zipfile: a folder, a deflated PDF inside it, a stored text file and Mac junk
const SAMPLE =
    'UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAFAAAAZG9jcy9QSwMEFAAAAAgAoDVxXXwmX/4WAAAALAEAABUAAABkb2NzL05EQSAwNzAzMjAyNC5wZGZTDXBx0zXUM1HISM3JyVdQHeXi5gIAUEsDBBQAAAAAAKA1cV24DwtECgAAAAoAAAAIAAAAbm90ZS50eHRwbGFpbiB0ZXh0UEsDBBQAAAAAAKA1cV05nPsGBAAAAAQAAAAgAAAAX19NQUNPU1gvZG9jcy8uX05EQSAwNzAzMjAyNC5wZGZqdW5rUEsBAhQDFAAAAAAAAAAhAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAIABAAAAAGRvY3MvUEsBAhQDFAAAAAgAoDVxXXwmX/4WAAAALAEAABUAAAAAAAAAAAAAAIABIwAAAGRvY3MvTkRBIDA3MDMyMDI0LnBkZlBLAQIUAxQAAAAAAKA1cV24DwtECgAAAAoAAAAIAAAAAAAAAAAAAACAAWwAAABub3RlLnR4dFBLAQIUAxQAAAAAAKA1cV05nPsGBAAAAAQAAAAgAAAAAAAAAAAAAACAAZwAAABfX01BQ09TWC9kb2NzLy5fTkRBIDA3MDMyMDI0LnBkZlBLBQYAAAAABAAEAPoAAADeAAAAAAA=';
// One 5,000-byte file that packs down to a few bytes
const BIG =
    'UEsDBBQAAAAIAKA1cV12WfRMFwAAAIgTAAAHAAAAYmlnLnR4dO3BMQEAAADCoKzrX8IUfkABAAAAAG8DUEsBAhQDFAAAAAgAoDVxXXZZ9EwXAAAAiBMAAAcAAAAAAAAAAAAAAIABAAAAAGJpZy50eHRQSwUGAAAAAAEAAQA1AAAAPAAAAAAA';

const limits = { maxEntries: 100, maxFileBytes: 10_000, maxTotalBytes: 20_000 };

describe('readZip', () => {
    it('reads stored and deflated files and skips folders and Mac junk', () => {
        const entries = readZip(Buffer.from(SAMPLE, 'base64'), limits);
        expect(entries.map((e) => e.path)).toEqual(['docs/NDA 07032024.pdf', 'note.txt']);
        expect(entries[0].name).toBe('NDA 07032024.pdf');
        expect(entries[0].data.toString().startsWith('%PDF-1.4')).toBe(true);
        expect(entries[0].data.length).toBe(300);
        expect(entries[1].data.toString()).toBe('plain text');
    });

    it('refuses files that expand beyond the limits', () => {
        expect(() => readZip(Buffer.from(BIG, 'base64'), { ...limits, maxFileBytes: 4000 })).toThrow('larger than');
        expect(() => readZip(Buffer.from(BIG, 'base64'), { ...limits, maxTotalBytes: 4000 })).toThrow('add up to');
        expect(readZip(Buffer.from(BIG, 'base64'), limits)[0].data.length).toBe(5000);
    });

    it('refuses things that are not zips', () => {
        expect(() => readZip(Buffer.from('definitely not a zip file at all'), limits)).toThrow('could not be read');
    });
});