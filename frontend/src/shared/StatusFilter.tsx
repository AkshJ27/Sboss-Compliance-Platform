import { Segmented } from 'antd';

// The Active / Inactive / All choice on master lists
export type StatusFilterValue = 'active' | 'inactive' | 'all';

export function StatusFilter({ value, onChange }: { value: StatusFilterValue; onChange: (v: StatusFilterValue) => void }) {
    return (
        <Segmented
            value={value}
            onChange={(v) => onChange(v as StatusFilterValue)}
            options={[
                { label: 'Active', value: 'active' },
                { label: 'Inactive', value: 'inactive' },
                { label: 'All', value: 'all' },
            ]}
        />
    );
}

// For lists loaded whole: keeps the rows that match the choice
export const byStatus = <T extends { isActive: boolean }>(rows: readonly T[], status: StatusFilterValue): T[] =>
    status === 'all' ? [...rows] : rows.filter((r) => r.isActive === (status === 'active'));