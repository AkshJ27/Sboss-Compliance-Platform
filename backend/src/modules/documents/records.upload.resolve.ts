import type { Role } from '@prisma/client';
import type { RowError, UploadRow } from './records.upload.parser';

// Turns names and emails in the upload into the company's records, and file names into zip entries.
// Plain logic with no database, so it is easy to test.

type Named = { id: string; name: string; isActive: boolean };
export type UploadLookups = {
    entities: (Named & { code: string })[];
    verticals: Named[];
    departments: Named[];
    locations: (Named & { entityId: string })[];
    categories: (Named & { level: number; parentId: string | null })[];
    users: { id: string; email: string; isActive: boolean; role: Role }[];
    zipPaths: string[]; // every file in the zip, with its folder
    existing: Set<string>; // existingKey() of documents already saved
};

export type ResolvedUploadRow = {
    raw: UploadRow;
    entityId: string;
    verticalId: string;
    departmentId: string;
    locationId: string;
    categoryId: string;
    subCategoryId: string | null;
    subSubCategoryId: string | null;
    ownerId: string;
    managerId: string | null;
    fileIndexes: number[]; // positions in zipPaths
    locationLabel: string;
};

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const existingKey = (locationId: string, name: string) => `${locationId}|${key(name)}`;

export function resolveUploadRows(rows: readonly UploadRow[], lk: UploadLookups) {
    const errors: RowError[] = [];
    const warnings: string[] = [];
    const resolved: ResolvedUploadRow[] = [];

    const byName = <T extends Named>(list: T[]) => {
        const m = new Map<string, T>();
        for (const x of list) m.set(key(x.name), x);
        return m;
    };
    const entities = byName(lk.entities);
    for (const e of lk.entities) if (!entities.has(key(e.code))) entities.set(key(e.code), e);
    const verticals = byName(lk.verticals);
    const departments = byName(lk.departments);
    const locations = new Map(lk.locations.map((l) => [`${l.entityId}|${key(l.name)}`, l]));
    const categories = new Map(lk.categories.map((c) => [`${c.level}|${c.parentId ?? ''}|${key(c.name)}`, c]));
    const users = new Map(lk.users.map((u) => [u.email.toLowerCase(), u]));

    // A file can be named with its folder ("contracts/a.pdf") or just by its name ("a.pdf")
    const byPath = new Map<string, number>();
    const byFileName = new Map<string, number[]>();
    lk.zipPaths.forEach((p, i) => {
        byPath.set(p.toLowerCase(), i);
        const name = (p.split('/').pop() as string).toLowerCase();
        byFileName.set(name, [...(byFileName.get(name) ?? []), i]);
    });

    const used = new Set<number>();
    const seenInFile = new Map<string, number>();

    for (const r of rows) {
        const before = errors.length;
        const err = (field: string, message: string) => errors.push({ row: r.row, field, message });
        const active = <T extends Named>(found: T | undefined, given: string, field: string, what: string): T | undefined => {
            if (!found) err(field, `No ${what} named "${given}" in your company. Check the data sheets in the format.`);
            else if (!found.isActive) err(field, `The ${what} "${found.name}" is inactive`);
            return found;
        };

        const entity = active(entities.get(key(r.entity)), r.entity, 'Entity', 'entity');
        const vertical = active(verticals.get(key(r.vertical)), r.vertical, 'Vertical', 'vertical');
        const department = active(departments.get(key(r.department)), r.department, 'Department', 'department');
        let location: (Named & { entityId: string }) | undefined;
        if (entity) {
            location = locations.get(`${entity.id}|${key(r.location)}`);
            if (!location) err('Location', `"${r.location}" is not a location of ${entity.name}`);
            else if (!location.isActive) err('Location', `The location "${location.name}" is inactive`);
        }

        const level = (lvl: number, parentId: string | null, name: string | null, field: string, under: string) => {
            if (!name) return null;
            const c = categories.get(`${lvl}|${parentId ?? ''}|${key(name)}`);
            if (!c) err(field, `No ${field.toLowerCase()} named "${name}"${under}. Add it under Document Master first.`);
            else if (!c.isActive) err(field, `The ${field.toLowerCase()} "${c.name}" is inactive`);
            return c ?? null;
        };
        const category = level(1, null, r.category, 'Category', '');
        const sub = category ? level(2, category.id, r.subCategory, 'Sub Category', ` under ${category.name}`) : null;
        const subSub = sub ? level(3, sub.id, r.subSubCategory, 'Sub Sub Category', ` under ${sub.name}`) : null;

        const person = (email: string | null, field: string, label: string) => {
            if (!email) return null;
            const u = users.get(email);
            if (!u) err(field, `No user with the email ${email}`);
            else if (!u.isActive) err(field, `${email} is inactive`);
            else if (u.role === 'VIEWER') err(field, `${email} is a view-only user and cannot be the ${label}`);
            return u ?? null;
        };
        const owner = person(r.owner, 'Document Owner Email', 'owner');
        const manager = person(r.manager, 'Document Manager Email', 'manager');

        const fileIndexes: number[] = [];
        for (const f of r.files) {
            const exact = byPath.get(f.toLowerCase());
            const matches = exact !== undefined ? [exact] : (byFileName.get((f.split('/').pop() as string).toLowerCase()) ?? []);
            if (!matches.length) err('Attachment Filename', `"${f}" is not in the zip`);
            else if (matches.length > 1) err('Attachment Filename', `The zip has more than one "${f}" in different folders. Write it with its folder, like "folder/${f}".`);
            else fileIndexes.push(matches[0]);
        }

        if (errors.length > before || !entity || !vertical || !department || !location || !category || !owner) continue;

        const dupKey = existingKey(location.id, r.name);
        if (lk.existing.has(dupKey)) {
            warnings.push(`Row ${r.row}: a document named "${r.name}" already exists at ${location.name}. It will be added again.`);
        }
        const earlier = seenInFile.get(dupKey);
        if (earlier) warnings.push(`Rows ${earlier} and ${r.row} both add "${r.name}" at ${location.name}`);
        else seenInFile.set(dupKey, r.row);
        for (const i of fileIndexes) used.add(i);

        resolved.push({
            raw: r,
            entityId: entity.id,
            verticalId: vertical.id,
            departmentId: department.id,
            locationId: location.id,
            categoryId: category.id,
            subCategoryId: sub?.id ?? null,
            subSubCategoryId: subSub?.id ?? null,
            ownerId: owner.id,
            managerId: manager?.id ?? null,
            fileIndexes,
            locationLabel: `${entity.name} / ${location.name}`,
        });
    }

    if (!errors.length) {
        const unused = lk.zipPaths.filter((_, i) => !used.has(i));
        if (unused.length) {
            const shown = unused.slice(0, 10).map((p) => `"${p}"`).join(', ');
            warnings.push(`${unused.length} file(s) in the zip are not named in the sheet and will be skipped: ${shown}${unused.length > 10 ? ' ...' : ''}`);
        }
    }
    return { resolved, errors, warnings };
}