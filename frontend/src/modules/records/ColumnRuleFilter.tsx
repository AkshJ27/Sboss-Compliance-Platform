import { useState } from 'react';
import { Button, Input, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

// A filter on one column, built from rules, like Complinity's: match all or any of up to five rules.

export const FILTER_KEYS = ['owner', 'manager', 'entity', 'vertical', 'department', 'location', 'act', 'title', 'code'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const OPS = [
    { value: 'startsWith', label: 'Starts with' },
    { value: 'contains', label: 'Contains' },
    { value: 'notContains', label: 'Not contains' },
    { value: 'endsWith', label: 'Ends with' },
    { value: 'equals', label: 'Equals' },
    { value: 'notEquals', label: 'Not equals' },
] as const;
export type Op = (typeof OPS)[number]['value'];

export type Rule = { op: Op; value: string };
export type ColumnFilter = { col: FilterKey; match: 'all' | 'any'; rules: Rule[] };

const MAX_RULES = 5;

// The filters live in the address as JSON. Anything that does not look right is ignored.
export function parseColumnFilters(raw: string | null): ColumnFilter[] {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw) as unknown;
        if (!Array.isArray(v)) return [];
        return v.flatMap((f) => {
            const o = f as Partial<ColumnFilter>;
            if (!o || !FILTER_KEYS.includes(o.col as FilterKey) || !Array.isArray(o.rules)) return [];
            const rules = o.rules.filter(
                (r): r is Rule => !!r && OPS.some((op) => op.value === r.op) && typeof r.value === 'string' && r.value.trim() !== '',
            );
            return rules.length ? [{ col: o.col as FilterKey, match: o.match === 'any' ? 'any' : 'all', rules: rules.slice(0, MAX_RULES) }] : [];
        });
    } catch {
        return [];
    }
}

type Props = {
    col: FilterKey;
    value: ColumnFilter | undefined;
    onApply: (next: ColumnFilter | undefined) => void;
    close: () => void;
};

export function ColumnRuleFilter({ col, value, onApply, close }: Props) {
    const [match, setMatch] = useState<'all' | 'any'>(value?.match ?? 'all');
    const [rules, setRules] = useState<Rule[]>(value?.rules.length ? value.rules : [{ op: 'startsWith', value: '' }]);

    const set = (i: number, patch: Partial<Rule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

    const apply = () => {
        const kept = rules.map((r) => ({ ...r, value: r.value.trim().slice(0, 100) })).filter((r) => r.value);
        onApply(kept.length ? { col, match, rules: kept } : undefined);
        close();
    };
    const clear = () => {
        setRules([{ op: 'startsWith', value: '' }]);
        setMatch('all');
        onApply(undefined);
        close();
    };

    return (
        <div style={{ padding: 12, width: 260 }} onKeyDown={(e) => e.stopPropagation()}>
            <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                    value={match}
                    style={{ width: '100%' }}
                    onChange={setMatch}
                    options={[
                        { value: 'all', label: 'Match all' },
                        { value: 'any', label: 'Match any' },
                    ]}
                />
                {rules.map((r, i) => (
                    <Space.Compact key={i} direction="vertical" style={{ width: '100%' }}>
                        <Space.Compact style={{ width: '100%' }}>
                            <Select<Op> value={r.op} style={{ width: '100%' }} options={[...OPS]} onChange={(op) => set(i, { op })} />
                            {rules.length > 1 && (
                                <Button
                                    icon={<DeleteOutlined />}
                                    aria-label="Remove this rule"
                                    onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                                />
                            )}
                        </Space.Compact>
                        <Input
                            value={r.value}
                            maxLength={100}
                            placeholder="Value"
                            onChange={(e) => set(i, { value: e.target.value })}
                            onPressEnter={apply}
                        />
                    </Space.Compact>
                ))}
                <Button
                    block
                    icon={<PlusOutlined />}
                    disabled={rules.length >= MAX_RULES}
                    onClick={() => setRules((rs) => [...rs, { op: 'contains', value: '' }])}
                >
                    Add rule
                </Button>
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Button onClick={clear}>Clear</Button>
                    <Button type="primary" onClick={apply}>
                        Apply
                    </Button>
                </Space>
            </Space>
        </div>
    );
}