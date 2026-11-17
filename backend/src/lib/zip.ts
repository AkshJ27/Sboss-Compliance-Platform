import { inflateRawSync } from 'zlib';
import { HttpError } from './errors';

// Reads the files out of a .zip held in memory, with Node's own zlib (no extra package).
// Nothing is written to disk, so folder names inside the zip can never escape anywhere.
// Supports the two methods every zip tool uses (stored and deflate). Rejects encrypted and zip64 files.

export type ZipEntry = { path: string; name: string; data: Buffer };
export type ZipLimits = { maxEntries: number; maxFileBytes: number; maxTotalBytes: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const bad = (message: string) => new HttpError(400, message);

// Junk that Mac and Windows add to zips
const isJunk = (path: string) => {
    const name = path.split('/').pop() ?? '';
    return path.startsWith('__MACOSX/') || name.startsWith('._') || name === '.DS_Store' || name.toLowerCase() === 'thumbs.db';
};

export function readZip(buf: Buffer, limits: ZipLimits): ZipEntry[] {
    // The end record sits in the last 22 bytes plus up to 64 KB of comment
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === EOCD) {
            end = i;
            break;
        }
    }
    if (end < 0) throw bad('The zip file could not be read. Create it again with "Send to > Compressed (zipped) folder".');

    const count = buf.readUInt16LE(end + 10);
    const cdSize = buf.readUInt32LE(end + 12);
    const cdOffset = buf.readUInt32LE(end + 16);
    if (count === 0xffff || cdOffset === 0xffffffff) throw bad('This zip is too large to read here. Split it into smaller zips.');
    if (cdOffset + cdSize > end) throw bad('The zip file is damaged');

    const entries: ZipEntry[] = [];
    let total = 0;
    let p = cdOffset;
    for (let n = 0; n < count; n++) {
        if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw bad('The zip file is damaged');
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const rawName = buf.subarray(p + 46, p + 46 + nameLen);
        // Bit 11 means the name is UTF-8. Older tools use the DOS code page, read here as Latin-1.
        const path = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
        p += 46 + nameLen + extraLen + commentLen;

        if (path.endsWith('/') || isJunk(path)) continue; // folders and system junk
        if (flags & 0x1) throw bad(`"${path}" is password protected. Zip the files without a password.`);
        if (method !== 0 && method !== 8) throw bad(`"${path}" uses a compression this app cannot read. Use a normal zip.`);
        if (entries.length >= limits.maxEntries) throw bad(`The zip has more than ${limits.maxEntries} files`);
        if (size > limits.maxFileBytes) throw bad(`"${path}" is larger than ${Math.round(limits.maxFileBytes / 1048576)} MB`);
        total += size;
        if (total > limits.maxTotalBytes) throw bad(`The files in the zip add up to more than ${Math.round(limits.maxTotalBytes / 1048576)} MB`);

        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) throw bad('The zip file is damaged');
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        if (start + compSize > buf.length) throw bad('The zip file is damaged');
        const packed = buf.subarray(start, start + compSize);

        let data: Buffer;
        try {
            // The output cap stops a tiny file that expands to gigabytes
            data = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) });
        } catch {
            throw bad(`"${path}" in the zip is damaged`);
        }
        if (data.length !== size) throw bad(`"${path}" in the zip is damaged`);
        entries.push({ path, name: path.split('/').pop() as string, data });
    }
    return entries;
}