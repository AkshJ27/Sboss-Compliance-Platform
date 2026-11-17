import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../../middleware/auth';

// Who can see a document in the repository and who can open its files.
//
//   Public      everyone in the company sees it and opens its files
//   Protected   everyone sees it in the list; only the named people open its files
//   Private     only the named people see it at all
//   Restricted  only the owner, the person who added it and the additional users (not the manager).
//               Only an admin can choose this level.
//
// "Named people" are the owner, the manager, the person who added it and the additional users.
// Company admins see and open everything.

type Where = Prisma.DocumentRecordWhereInput;

const named = (me: string): Where[] => [
    { ownerId: me },
    { managerId: me },
    { createdById: me },
    { additionalUsers: { some: { userId: me } } },
];
const namedNoManager = (me: string): Where[] => [
    { ownerId: me },
    { createdById: me },
    { additionalUsers: { some: { userId: me } } },
];

const base = (actor: AuthUser): Where => ({ orgId: actor.orgId, deletedAt: null });

export function visibleRecords(actor: AuthUser): Where {
    if (actor.role === 'ORG_ADMIN') return base(actor);
    return {
        ...base(actor),
        OR: [
            { accessLevel: { in: ['PUBLIC', 'PROTECTED'] } },
            { accessLevel: { in: ['PRIVATE'] }, OR: named(actor.id) },
            { accessLevel: { in: ['RESTRICTED'] }, OR: namedNoManager(actor.id) },
        ],
    };
}

export function openableRecords(actor: AuthUser): Where {
    if (actor.role === 'ORG_ADMIN') return base(actor);
    return {
        ...base(actor),
        OR: [
            { accessLevel: { in: ['PUBLIC'] } },
            { accessLevel: { in: ['PRIVATE', 'PROTECTED'] }, OR: named(actor.id) },
            { accessLevel: { in: ['RESTRICTED'] }, OR: namedNoManager(actor.id) },
        ],
    };
}

type RecordPeople = {
    accessLevel: string;
    ownerId: string;
    managerId: string | null;
    createdById: string;
    additionalUserIds: string[];
};

// The same rules for one record already loaded, so the screen can grey out buttons
export function canOpenFiles(actor: AuthUser, r: RecordPeople): boolean {
    if (actor.role === 'ORG_ADMIN' || r.accessLevel === 'PUBLIC') return true;
    const me = actor.id;
    const core = r.ownerId === me || r.createdById === me || r.additionalUserIds.includes(me);
    return r.accessLevel === 'RESTRICTED' ? core : core || r.managerId === me;
}

// Viewers never change anything. Admins, the owner, the manager and the person who added it can.
export function canEdit(actor: AuthUser, r: RecordPeople): boolean {
    if (actor.role === 'VIEWER') return false;
    if (actor.role === 'ORG_ADMIN') return true;
    return r.ownerId === actor.id || r.createdById === actor.id || r.managerId === actor.id;
}

// Deleting is for admins and the owner only
export function canDelete(actor: AuthUser, r: RecordPeople): boolean {
    if (actor.role === 'VIEWER') return false;
    return actor.role === 'ORG_ADMIN' || r.ownerId === actor.id;
}