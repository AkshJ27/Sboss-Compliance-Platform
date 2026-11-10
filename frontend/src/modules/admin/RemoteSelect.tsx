import { useEffect, useState } from 'react';
import { Select } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

export type Opt = { value: string; label: string };

function useDebounced<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return debounced;
}

type Props = {
    cacheKey: string; // anything that changes what the list means, such as the chosen entity
    load: (search: string, signal: AbortSignal) => Promise<Opt[]>;
    multiple?: boolean;
    disabled?: boolean;
    placeholder?: string;
    value?: Opt | Opt[];
    onChange?: (value: Opt | Opt[] | undefined) => void;
};

export function RemoteSelect({ cacheKey, load, multiple, disabled, placeholder, value, onChange }: Props) {
    const [search, setSearch] = useState('');
    const debounced = useDebounced(search.trim(), 300);
    const q = useQuery({
        queryKey: ['remote', cacheKey, debounced],
        queryFn: ({ signal }) => load(debounced, signal),
        placeholderData: keepPreviousData,
        enabled: !disabled,
    });

    return (
        <Select
            mode={multiple ? 'multiple' : undefined}
            labelInValue
            showSearch
            allowClear
            filterOption={false}
            disabled={disabled}
            maxTagCount="responsive"
            placeholder={placeholder}
            style={{ width: '100%' }}
            value={value}
            onChange={onChange}
            onSearch={setSearch}
            onOpenChange={(open) => {
                if (!open) setSearch('');
            }}
            options={q.data ?? []}
            loading={q.isFetching}
            notFoundContent={q.isError ? 'The list could not be loaded' : undefined}
        />
    );
}