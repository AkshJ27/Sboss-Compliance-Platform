import type { Level } from '../api';

export type ChangeView = {
    field: string;
    label: string;
    kind: 'RULE' | 'LIVE'; // RULE changes need a decision. LIVE changes are already visible.
    from: string | null;
    to: string | null;
    opaque: boolean;
};

export type Summary = { waiting: number; needDecision: number; informational: number };

export type WaitingItem = {
    complianceId: string;
    code: string;
    title: string;
    act: { name: string; state: string | null };
    risk: Level;
    fromVersion: number;
    toVersion: number;
    schedules: number;
    needsDecision: boolean;
    changes: ChangeView[];
};
export type WaitingPage = { items: WaitingItem[]; total: number };

export type Preview = {
    complianceId: string;
    code: string;
    title: string;
    act: { name: string; state: string | null };
    risk: Level;
    fromVersion: number;
    version: number;
    needsDecision: boolean;
    changes: ChangeView[];
    newRule: string;
    currentRules: { rule: string; schedules: number }[];
    schedules: number;
    sampleLocations: string[];
    items: { open: number; willMove: number; unchanged: number; kept: number };
    notes: string[];
    sampleMoves: { location: string; from: string; to: string }[];
};

export type DecisionResult = {
    decision: 'APPLIED' | 'KEPT' | 'ACKNOWLEDGED';
    code: string;
    schedulesUpdated: number;
    itemsMoved: number;
    itemsKept: number;
    approvalRuleUpdated: number;
};

export type HistoryItem = {
    id: string;
    decision: 'APPLIED' | 'KEPT' | 'ACKNOWLEDGED';
    fromVersion: number;
    toVersion: number;
    changes: ChangeView[];
    schedulesUpdated: number;
    itemsMoved: number;
    note: string | null;
    createdAt: string;
    compliance: { id: string; code: string; title: string };
    decidedBy: { id: string; name: string };
};
export type HistoryPage = { items: HistoryItem[]; total: number };