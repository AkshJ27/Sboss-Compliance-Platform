import { DatePicker, Segmented, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { fyChoices, fyStartYear } from '../../core/filters';
import type { PeriodKind, PeriodState } from '../../core/filters';

const OPTIONS = [
    { label: 'This month', value: 'MONTH' },
    { label: 'Q1', value: 'Q1' },
    { label: 'Q2', value: 'Q2' },
    { label: 'Q3', value: 'Q3' },
    { label: 'Q4', value: 'Q4' },
    { label: 'YTD', value: 'YTD' },
    { label: 'Custom', value: 'CUSTOM' },
];

type Props = { period: PeriodState; onChange: (next: PeriodState) => void };

export function PeriodBar({ period, onChange }: Props) {
    const quarterly = period.kind !== 'MONTH' && period.kind !== 'CUSTOM';

    const pick = (value: string | number) => {
        const kind = value as PeriodKind;
        if (kind === 'CUSTOM') {
            const now = dayjs();
            onChange({
                kind,
                from: now.startOf('month').format('YYYY-MM-DD'),
                to: now.endOf('month').format('YYYY-MM-DD'),
            });
        } else if (kind === 'MONTH') {
            onChange({ kind });
        } else {
            onChange({ kind, fy: period.fy });
        }
    };

    return (
        <Space wrap>
            <Segmented options={OPTIONS} value={period.kind} onChange={pick} />
            {quarterly && (
                <Select
                    style={{ width: 120 }}
                    value={period.fy ?? fyStartYear()}
                    options={fyChoices()}
                    onChange={(fy: number) => onChange({ kind: period.kind, fy })}
                />
            )}
            {period.kind === 'CUSTOM' && period.from && period.to && (
                <DatePicker.RangePicker
                    allowClear={false}
                    value={[dayjs(period.from), dayjs(period.to)]}
                    onChange={(range) => {
                        if (range?.[0] && range[1]) {
                            onChange({
                                kind: 'CUSTOM',
                                from: range[0].format('YYYY-MM-DD'),
                                to: range[1].format('YYYY-MM-DD'),
                            });
                        }
                    }}
                />
            )}
        </Space>
    );
}