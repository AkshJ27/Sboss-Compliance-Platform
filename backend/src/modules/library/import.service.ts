import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { recordAudit, changedFields } from '../../lib/audit';
import type { AuthUser } from '../../middleware/auth';
import { COMPARE_KEYS } from './library.schema';
import type { ParsedRow } from './import.parser';

const IMPORT_KEYS = [...COMPARE_KEYS, 'actId', 'ruleId', 'natureId', 'typeId'];
const BATCH = 1000;

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const actKey = (name: string, jurisdiction: string, state: string | null | undefined) =>
    `${key(name)}|${jurisdiction}|${state ?? ''}`;

type Named = { id: string; name: string };

// Finds an existing name (ignoring case) or reserves a new id for it in memory
function lookup(existing: Named[]) {
    const ids = new Map(existing.map((e) => [key(e.name), e.id]));
    const pending: Named[] = [];
    return {
        pending,
        resolve(name: string) {
            const k = key(name);
            let id = ids.get(k);
            if (!id) {
                id = randomUUID();
                ids.set(k, id);
                pending.push({ id, name: name.trim() });
            }
            return id;
        },
    };
}

function* chunks<T>(arr: T[], size = BATCH) {
    for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Works out everything the import would do, without writing anything
export async function planImport(rows: ParsedRow[]) {
    const named = { select: { id: true, name: true } };
    const [cats, auths, natures, types, acts, rules, existing] = await Promise.all([
        prisma.lawCategory.findMany(named),
        prisma.statutoryAuthority.findMany(named),
        prisma.complianceNature.findMany(named),
        prisma.complianceType.findMany(named),
        prisma.act.findMany({ select: { id: true, name: true, jurisdiction: true, state: true } }),
        prisma.rule.findMany({ select: { id: true, actId: true, name: true } }),
        prisma.compliance.findMany({ where: { code: { in: rows.map((r) => r.data.code) } } }),
    ]);

    const categories = lookup(cats);
    const authorities = lookup(auths);
    const natureLookup = lookup(natures);
    const typeLookup = lookup(types);
    const actIds = new Map(acts.map((a) => [actKey(a.name, a.jurisdiction, a.state), a.id]));
    const ruleIds = new Map(rules.map((r) => [`${r.actId}|${key(r.name)}`, r.id]));
    const byCode = new Map(existing.map((c) => [c.code, c]));

    const pendingActs: Prisma.ActCreateManyInput[] = [];
    const pendingRules: Prisma.RuleCreateManyInput[] = [];
    const creates: Prisma.ComplianceCreateManyInput[] = [];
    const updates: {
        id: string;
        code: string;
        version: number;
        data: Prisma.ComplianceUncheckedUpdateInput;
        changes: Record<string, unknown>;
    }[] = [];
    let unchanged = 0;

    for (const { data: d } of rows) {
        const lawCategoryId = categories.resolve(d.lawCategory);
        const statutoryAuthorityId = d.statutoryAuthority ? authorities.resolve(d.statutoryAuthority) : null;

        const ak = actKey(d.act, d.jurisdiction, d.state);
        let actId = actIds.get(ak);
        if (!actId) {
            actId = randomUUID();
            actIds.set(ak, actId);
            pendingActs.push({
                id: actId,
                name: d.act.trim(),
                jurisdiction: d.jurisdiction,
                state: d.state ?? null,
                lawCategoryId,
                statutoryAuthorityId,
            });
        }

        let ruleId: string | null = null;
        if (d.rule) {
            const rk = `${actId}|${key(d.rule)}`;
            ruleId = ruleIds.get(rk) ?? null;
            if (!ruleId) {
                ruleId = randomUUID();
                ruleIds.set(rk, ruleId);
                pendingRules.push({ id: ruleId, actId, name: d.rule.trim() });
            }
        }

        const data = {
            actId,
            ruleId,
            natureId: d.nature ? natureLookup.resolve(d.nature) : null,
            typeId: d.type ? typeLookup.resolve(d.type) : null,
            title: d.title,
            description: d.description ?? null,
            form: d.form ?? null,
            reference: d.reference ?? null,
            risk: d.risk ?? 'MEDIUM',
            impact: d.impact ?? 'MEDIUM',
            attachment: d.attachment ?? 'OPTIONAL',
            frequency: d.frequency,
            periodBasis: d.periodBasis ?? 'FINANCIAL_YEAR',
            dueDay: d.dueDay ?? null,
            dueMonthOffset: d.dueMonthOffset ?? 0,
            event: d.event ?? null,
            dueDaysAfterEvent: d.dueDaysAfterEvent ?? null,
            penalty: d.penalty ?? null,
            imprisonment: d.imprisonment ?? false,
            isActive: d.isActive ?? true,
        } as const;

        const current = byCode.get(d.code);
        if (!current) {
            creates.push({ id: randomUUID(), code: d.code, ...data });
            continue;
        }

        const changes = changedFields(current, data, IMPORT_KEYS) as Record<string, unknown>;
        if (Object.keys(changes).length === 0) {
            unchanged++;
        } else {
            updates.push({ id: current.id, code: d.code, version: current.version + 1, data, changes });
        }
    }

    return {
        creates,
        updates,
        pending: {
            categories: categories.pending,
            authorities: authorities.pending,
            natures: natureLookup.pending,
            types: typeLookup.pending,
            acts: pendingActs,
            rules: pendingRules,
        },
        summary: {
            totalRows: rows.length,
            compliancesNew: creates.length,
            compliancesUpdated: updates.length,
            compliancesUnchanged: unchanged,
            newLawCategories: categories.pending.length,
            newStatutoryAuthorities: authorities.pending.length,
            newNatures: natureLookup.pending.length,
            newTypes: typeLookup.pending.length,
            newActs: pendingActs.length,
            newRules: pendingRules.length,
            sampleUpdates: updates.slice(0, 20).map((u) => ({ code: u.code, changed: Object.keys(u.changes) })),
        },
    };
}

type Plan = Awaited<ReturnType<typeof planImport>>;

export async function commitImport(actor: AuthUser, plan: Plan) {
    try {
        await prisma.$transaction(
            async (tx) => {
                const p = plan.pending;
                if (p.categories.length) await tx.lawCategory.createMany({ data: p.categories });
                if (p.authorities.length) await tx.statutoryAuthority.createMany({ data: p.authorities });
                if (p.natures.length) await tx.complianceNature.createMany({ data: p.natures });
                if (p.types.length) await tx.complianceType.createMany({ data: p.types });
                for (const part of chunks(p.acts)) await tx.act.createMany({ data: part });
                for (const part of chunks(p.rules)) await tx.rule.createMany({ data: part });
                for (const part of chunks(plan.creates)) await tx.compliance.createMany({ data: part });

                const revisions: Prisma.ComplianceRevisionCreateManyInput[] = plan.creates.map((c) => ({
                    complianceId: c.id as string,
                    version: 1,
                    changes: { created: true },
                    changedById: actor.id,
                }));

                for (const u of plan.updates) {
                    await tx.compliance.update({ where: { id: u.id }, data: { ...u.data, version: u.version } });
                    revisions.push({
                        complianceId: u.id,
                        version: u.version,
                        changes: u.changes as Prisma.InputJsonValue,
                        changedById: actor.id,
                    });
                }
                for (const part of chunks(revisions)) await tx.complianceRevision.createMany({ data: part });

                await recordAudit(tx, actor, 'LIBRARY_IMPORTED', 'Library', 'import', plan.summary as Prisma.InputJsonValue);
            },
            { timeout: 5 * 60 * 1000, maxWait: 10_000 },
        );
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new HttpError(409, 'The library changed while importing. Run the import again.');
        }
        throw e;
    }
}