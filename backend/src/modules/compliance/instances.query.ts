import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { todayInIndia } from '../../lib/dates';
import type { AuthUser } from '../../middleware/auth';
import { buildInstanceWhere, dashboardStatusWhere, dueRange } from './filters';
import type { InstanceListQuery } from './filters';
import { instanceInclude, withOverdue } from './instances.service';

const insensitive = Prisma.QueryMode.insensitive;

export type ListFilters = Omit<InstanceListQuery, 'order' | 'page' | 'limit'>;

// One definition of "which items match these filters", used by the list and by exports
export function buildListWhere(actor: AuthUser, q: ListFilters): Prisma.ComplianceInstanceWhereInput {
    const today = todayInIndia();
    const and: Prisma.ComplianceInstanceWhereInput[] = [
        buildInstanceWhere(actor, q),
        dueRange(q.dueFrom, q.dueTo),
    ];

    if (q.status) and.push({ status: { in: q.status } });
    if (q.dashboardStatus) and.push(dashboardStatusWhere(q.dashboardStatus, today));
    if (q.overdue) and.push(dashboardStatusWhere(['NON_COMPLIANCE'], today));
    if (q.search) {
        and.push({
            compliance: {
                OR: [
                    { title: { contains: q.search, mode: insensitive } },
                    { code: { contains: q.search, mode: insensitive } },
                    { act: { name: { contains: q.search, mode: insensitive } } },
                ],
            },
        });
    }
    return { AND: and };
}

export async function listInstances(actor: AuthUser, q: InstanceListQuery) {
    const where = buildListWhere(actor, q);
    const [total, items] = await prisma.$transaction([
        prisma.complianceInstance.count({ where }),
        prisma.complianceInstance.findMany({
            where,
            include: instanceInclude,
            orderBy: [{ dueDate: q.order }, { id: 'asc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
        }),
    ]);
    return { items: items.map(withOverdue), total, page: q.page, limit: q.limit };
}