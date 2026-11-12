import { describe, it, expect } from 'vitest';
import type { TaskStatus } from '@prisma/client';
import {
    canManage,
    canTransition,
    canWork,
    capabilitiesOf,
    isOpen,
    isOverdue,
    statusProblem,
    type Actor,
    type Parties,
} from './tasks.engine';

const STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
const task: Parties = { createdById: 'creator', assigneeId: 'assignee' };
const as = (id: string, role: Actor['role'] = 'MEMBER'): Actor => ({ id, role });
const ADMIN = as('admin', 'ORG_ADMIN');
const CREATOR = as('creator');
const ASSIGNEE = as('assignee');
const OTHER = as('other');
const VIEWER_CREATOR = as('creator', 'VIEWER'); // a creator who was later made a viewer
const VIEWER_ASSIGNEE = as('assignee', 'VIEWER');
const NOTHING = { edit: false, reassign: false, comment: false, start: false, finish: false, reopen: false, cancel: false };

describe('canTransition', () => {
    it('allows the normal moves', () => {
        expect(canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
        expect(canTransition('OPEN', 'DONE')).toBe(true);
        expect(canTransition('IN_PROGRESS', 'OPEN')).toBe(true);
        expect(canTransition('IN_PROGRESS', 'DONE')).toBe(true);
        expect(canTransition('DONE', 'OPEN')).toBe(true);
        expect(canTransition('OPEN', 'CANCELLED')).toBe(true);
        expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(true);
    });

    it('never leaves cancelled, and a done task can only be reopened', () => {
        for (const to of STATUSES) expect(canTransition('CANCELLED', to)).toBe(false);
        expect(canTransition('DONE', 'IN_PROGRESS')).toBe(false);
        expect(canTransition('DONE', 'CANCELLED')).toBe(false);
        expect(canTransition('DONE', 'DONE')).toBe(false);
    });
});

describe('isOpen', () => {
    it('treats open and in progress as open', () => {
        expect(isOpen('OPEN')).toBe(true);
        expect(isOpen('IN_PROGRESS')).toBe(true);
        expect(isOpen('DONE')).toBe(false);
        expect(isOpen('CANCELLED')).toBe(false);
    });
});

describe('permissions', () => {
    it('lets the creator and admins manage a task, not the assignee or others', () => {
        expect(canManage(ADMIN, task)).toBe(true);
        expect(canManage(CREATOR, task)).toBe(true);
        expect(canManage(ASSIGNEE, task)).toBe(false);
        expect(canManage(OTHER, task)).toBe(false);
        expect(canManage(VIEWER_CREATOR, task)).toBe(false);
    });

    it('lets the assignee, the creator and admins work on a task, not others or viewers', () => {
        expect(canWork(ADMIN, task)).toBe(true);
        expect(canWork(CREATOR, task)).toBe(true);
        expect(canWork(ASSIGNEE, task)).toBe(true);
        expect(canWork(OTHER, task)).toBe(false);
        expect(canWork(VIEWER_CREATOR, task)).toBe(false);
        expect(canWork(VIEWER_ASSIGNEE, task)).toBe(false);
    });
});

describe('capabilitiesOf', () => {
    it('lets the assignee start, finish and comment on an open task, but not edit it', () => {
        expect(capabilitiesOf(ASSIGNEE, { ...task, status: 'OPEN' })).toEqual({
            edit: false, reassign: false, comment: true, start: true, finish: true, reopen: false, cancel: false,
        });
    });

    it('lets the creator and an admin do everything on a task in progress', () => {
        const all = { edit: true, reassign: true, comment: true, start: false, finish: true, reopen: false, cancel: true };
        expect(capabilitiesOf(CREATOR, { ...task, status: 'IN_PROGRESS' })).toEqual(all);
        expect(capabilitiesOf(ADMIN, { ...task, status: 'IN_PROGRESS' })).toEqual(all);
    });

    it('allows a done task only to be reopened or commented on', () => {
        expect(capabilitiesOf(ASSIGNEE, { ...task, status: 'DONE' })).toEqual({
            edit: false, reassign: false, comment: true, start: false, finish: false, reopen: true, cancel: false,
        });
    });

    it('allows a cancelled task only to be commented on', () => {
        expect(capabilitiesOf(CREATOR, { ...task, status: 'CANCELLED' })).toEqual({ ...NOTHING, comment: true });
    });

    it('allows other members and viewers nothing', () => {
        expect(capabilitiesOf(OTHER, { ...task, status: 'OPEN' })).toEqual(NOTHING);
        expect(capabilitiesOf(VIEWER_ASSIGNEE, { ...task, status: 'OPEN' })).toEqual(NOTHING);
    });
});

describe('statusProblem', () => {
    const open = { ...task, status: 'OPEN' as TaskStatus };

    it('lets the assignee move a task along', () => {
        expect(statusProblem(ASSIGNEE, open, 'IN_PROGRESS', undefined)).toBeNull();
        expect(statusProblem(ASSIGNEE, { ...task, status: 'IN_PROGRESS' }, 'DONE', undefined)).toBeNull();
        expect(statusProblem(ASSIGNEE, { ...task, status: 'DONE' }, 'OPEN', 'Missed one item')).toBeNull();
    });

    it('lets only the creator or an admin cancel', () => {
        expect(statusProblem(ASSIGNEE, open, 'CANCELLED', 'No longer needed')).toBe('NOT_ALLOWED');
        expect(statusProblem(CREATOR, open, 'CANCELLED', 'No longer needed')).toBeNull();
        expect(statusProblem(ADMIN, open, 'CANCELLED', 'No longer needed')).toBeNull();
    });

    it('asks for a reason when cancelling or reopening, but not when finishing', () => {
        expect(statusProblem(CREATOR, open, 'CANCELLED', undefined)).toBe('REMARKS_REQUIRED');
        expect(statusProblem(CREATOR, open, 'CANCELLED', '  ok  ')).toBe('REMARKS_REQUIRED');
        expect(statusProblem(CREATOR, open, 'CANCELLED', 'abc')).toBeNull();
        expect(statusProblem(ASSIGNEE, { ...task, status: 'DONE' }, 'OPEN', undefined)).toBe('REMARKS_REQUIRED');
        expect(statusProblem(ASSIGNEE, open, 'DONE', undefined)).toBeNull();
    });

    it('refuses people who have no part in the task, and viewers', () => {
        expect(statusProblem(OTHER, open, 'DONE', undefined)).toBe('NOT_ALLOWED');
        expect(statusProblem(VIEWER_ASSIGNEE, open, 'DONE', undefined)).toBe('NOT_ALLOWED');
    });

    it('refuses a move to the same status and moves that are not allowed', () => {
        expect(statusProblem(ASSIGNEE, open, 'OPEN', undefined)).toBe('SAME_STATUS');
        expect(statusProblem(ASSIGNEE, { ...task, status: 'DONE' }, 'IN_PROGRESS', undefined)).toBe('INVALID_MOVE');
        expect(statusProblem(CREATOR, { ...task, status: 'CANCELLED' }, 'OPEN', 'Trying again')).toBe('INVALID_MOVE');
        expect(statusProblem(CREATOR, { ...task, status: 'DONE' }, 'CANCELLED', 'Changed my mind')).toBe('INVALID_MOVE');
    });
});

describe('isOverdue', () => {
    it('is true only for open tasks whose due date has passed', () => {
        expect(isOverdue('OPEN', '2026-11-08', '2026-11-09')).toBe(true);
        expect(isOverdue('IN_PROGRESS', '2026-11-08', '2026-11-09')).toBe(true);
        expect(isOverdue('OPEN', '2026-11-09', '2026-11-09')).toBe(false);
        expect(isOverdue('OPEN', '2026-11-10', '2026-11-09')).toBe(false);
        expect(isOverdue('DONE', '2026-11-08', '2026-11-09')).toBe(false);
        expect(isOverdue('CANCELLED', '2026-11-08', '2026-11-09')).toBe(false);
    });

    it('is false when there is no due date', () => {
        expect(isOverdue('OPEN', null, '2026-11-09')).toBe(false);
    });
});