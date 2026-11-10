import dayjs from 'dayjs';

// The sixteen filters of the filter panel, with the names the API uses
export const DIMENSIONS = [
    { key: 'entityId', label: 'Entity' },
    { key: 'locationId', label: 'Location' },
    { key: 'departmentId', label: 'Department' },
    { key: 'verticalId', label: 'Vertical' },
    { key: 'locationTypeId', label: 'Location type' },
    { key: 'state', label: 'State' },
    { key: 'lawCategoryId', label: 'Law category' },
    { key: 'actId', label: 'Act' },
    { key: 'ruleId', label: 'Rule' },
    { key: 'natureId', label: 'Compliance nature' },
    { key: 'typeId', label: 'Compliance type' },
    { key: 'risk', label: 'Risk' },
    { key: 'frequency', label: 'Periodicity' },
    { key: 'attachment', label: 'Attachment' },
    { key: 'ownerId', label: 'Owner' },
    { key: 'managerId', label: 'Manager' },
] as const;

export type DimKey = (typeof DIMENSIONS)[number]['key'];
export type Dims = Partial<Record<DimKey, string[]>>;

export function parseDims(sp: URLSearchParams): Dims {
    const out: Dims = {};
    for (const { key } of DIMENSIONS) {
        const values = sp
            .getAll(key)
            .flatMap((v) => v.split(','))
            .map((v) => v.trim())
            .filter(Boolean);
        if (values.length) out[key] = [...new Set(values)];
    }
    return out;
}

export function dimsToParams(dims: Dims, sp = new URLSearchParams()): URLSearchParams {
    for (const { key } of DIMENSIONS) {
        const values = dims[key];
        if (values?.length) sp.set(key, values.join(','));
    }
    return sp;
}

export type PeriodKind = 'MONTH' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'YTD' | 'CUSTOM';
export type PeriodState = { kind: PeriodKind; fy?: number; from?: string; to?: string };

export function parsePeriod(sp: URLSearchParams): PeriodState {
    const from = sp.get('dueFrom');
    const to = sp.get('dueTo');
    if (from && to) return { kind: 'CUSTOM', from, to };

    const q = sp.get('quarter');
    if (q === 'Q1' || q === 'Q2' || q === 'Q3' || q === 'Q4' || q === 'YTD') {
        const fy = Number(sp.get('fy'));
        return { kind: q, fy: Number.isInteger(fy) && fy > 0 ? fy : undefined };
    }
    return { kind: 'MONTH' };
}

export function periodToParams(p: PeriodState, sp = new URLSearchParams()): URLSearchParams {
    if (p.kind === 'CUSTOM') {
        if (p.from && p.to) {
            sp.set('dueFrom', p.from);
            sp.set('dueTo', p.to);
        }
    } else if (p.kind !== 'MONTH') {
        sp.set('quarter', p.kind);
        if (p.fy) sp.set('fy', String(p.fy));
    }
    return sp;
}

// The financial year runs April to March
export const fyStartYear = (d = dayjs()) => (d.month() >= 3 ? d.year() : d.year() - 1);
export const fyLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
export const fyChoices = () => {
    const now = fyStartYear();
    return [now, now - 1, now - 2].map((y) => ({ value: y, label: fyLabel(y) }));
};

export const STATUS_META = {
    NON_COMPLIANCE: { label: 'Non compliance', color: '#e5383b' },
    LATE_CLOSURE: { label: 'Late closure', color: '#f59e0b' },
    ON_TIME: { label: 'On time', color: '#22c55e' },
    DUE: { label: 'Due', color: '#facc15' },
    NOT_APPLICABLE: { label: 'Not applicable', color: '#9ca3af' },
    PENDING_APPROVAL: { label: 'Pending approval', color: '#f472b6' },
} as const;

export type DashStatus = keyof typeof STATUS_META;

export const STATUS_ORDER: DashStatus[] = [
    'NON_COMPLIANCE',
    'LATE_CLOSURE',
    'ON_TIME',
    'DUE',
    'NOT_APPLICABLE',
    'PENDING_APPROVAL',
];

// The name each status has in the API's summary
export const CARD_KEY = {
    NON_COMPLIANCE: 'nonCompliance',
    LATE_CLOSURE: 'lateClosure',
    ON_TIME: 'onTime',
    DUE: 'due',
    NOT_APPLICABLE: 'notApplicable',
    PENDING_APPROVAL: 'pendingApproval',
} as const;