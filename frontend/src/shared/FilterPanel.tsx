import { useEffect } from 'react';
import { Alert, Button, Col, Collapse, Row, Select, Typography } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../core/api/client';
import { DIMENSIONS, dimsToParams } from '../core/filters';
import type { DimKey, Dims } from '../core/filters';

type FacetOption = { value: string; label: string };
type Facets = Record<DimKey, FacetOption[]>;

// Remembers every label seen, so a selected value never shows up as a raw id
const labelCache = new Map<string, string>();

function withDim(dims: Dims, key: DimKey, values: string[]): Dims {
    const next: Dims = { ...dims };
    if (values.length) next[key] = values;
    else delete next[key];
    return next;
}

type Props = { dims: Dims; onChange: (next: Dims) => void };

export function FilterPanel({ dims, onChange }: Props) {
    const qs = dimsToParams(dims).toString();
    const facets = useQuery({
        queryKey: ['facets', qs],
        queryFn: ({ signal }) => api<Facets>(`/compliance/dashboard/filters?${qs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    if (facets.data) {
        for (const { key } of DIMENSIONS) {
            for (const o of facets.data[key]) labelCache.set(`${key}:${o.value}`, o.label);
        }
    }

    // When the options narrow, drop any selection that no longer exists
    useEffect(() => {
        if (!facets.data || facets.isPlaceholderData) return;
        let changed = false;
        const next: Dims = {};
        for (const { key } of DIMENSIONS) {
            const selected = dims[key];
            if (!selected?.length) continue;
            const valid = new Set(facets.data[key].map((o) => o.value));
            const kept = selected.filter((v) => valid.has(v));
            if (kept.length !== selected.length) changed = true;
            if (kept.length) next[key] = kept;
        }
        if (changed) onChange(next);
    }, [facets.data, facets.isPlaceholderData, dims, onChange]);

    const optionsFor = (key: DimKey): FacetOption[] => {
        const base = facets.data?.[key] ?? [];
        const have = new Set(base.map((o) => o.value));
        const extra = (dims[key] ?? [])
            .filter((v) => !have.has(v))
            .map((v) => ({ value: v, label: labelCache.get(`${key}:${v}`) ?? v }));
        return [...base, ...extra];
    };

    const active = DIMENSIONS.filter(({ key }) => dims[key]?.length).length;

    return (
        <Collapse
            size="small"
            items={[
                {
                    key: 'filters',
                    label: <span>Filters{active ? ` (${active} active)` : ''}</span>,
                    extra: active ? (
                        <Button
                            size="small"
                            type="link"
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange({});
                            }}
                        >
                            Clear all
                        </Button>
                    ) : null,
                    children: (
                        <>
                            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                                Every filter accepts several values. Choosing a value narrows the choices in the other filters.
                            </Typography.Paragraph>
                            {facets.isError && (
                                <Alert
                                    type="warning"
                                    showIcon
                                    style={{ marginBottom: 12 }}
                                    message="Filter options could not be loaded"
                                    action={
                                        <Button size="small" onClick={() => void facets.refetch()}>
                                            Retry
                                        </Button>
                                    }
                                />
                            )}
                            <Row gutter={[12, 8]}>
                                {DIMENSIONS.map(({ key, label }) => (
                                    <Col key={key} xs={24} sm={12} lg={8} xl={6}>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            {label}
                                        </Typography.Text>
                                        <Select
                                            mode="multiple"
                                            allowClear
                                            showSearch
                                            optionFilterProp="label"
                                            maxTagCount="responsive"
                                            placeholder="All"
                                            style={{ width: '100%' }}
                                            loading={facets.isFetching}
                                            value={dims[key] ?? []}
                                            options={optionsFor(key)}
                                            onChange={(values: string[]) => onChange(withDim(dims, key, values))}
                                        />
                                    </Col>
                                ))}
                            </Row>
                        </>
                    ),
                },
            ]}
        />
    );
}