import type { Counts, Period } from '../dashboard/types';

// The ways the summary can be grouped. Each one is also a filter of the record list.
export const GROUP_OPTIONS = [
    { value: 'entityId', label: 'Entity' },
    { value: 'locationId', label: 'Location' },
    { value: 'state', label: 'State' },
    { value: 'departmentId', label: 'Department' },
    { value: 'verticalId', label: 'Vertical' },
    { value: 'lawCategoryId', label: 'Law category' },
    { value: 'actId', label: 'Act' },
    { value: 'ownerId', label: 'Owner' },
    { value: 'managerId', label: 'Manager' },
    { value: 'risk', label: 'Risk' },
    { value: 'frequency', label: 'Periodicity' },
] as const;

export type GroupBy = (typeof GROUP_OPTIONS)[number]['value'];

export const isGroupBy = (v: string | null): v is GroupBy => GROUP_OPTIONS.some((o) => o.value === v);

export type Money = { payable: number; paid: number; penalty: number };

export type SummaryRow = {
    key: string | null; // null for items with no value, such as no department
    label: string;
    counts: Counts;
    total: number;
    applicable: number;
    decided: number;
    onTimePercent: number | null;
    money: Money;
};

export type SummaryReport = {
    asOf: string;
    period: Period;
    groupBy: GroupBy;
    groupLabel: string;
    rows: SummaryRow[];
    totals: SummaryRow;
};