import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Input, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { formatDate } from '../../core/format';
import { LoadWarning } from '../admin/LoadWarning';
import { useEntities, useUsers } from '../admin/api';
import { useRefreshAfterTaskChange } from './api';
import { STATUS_PARAM, STATUS_TABS, UUID, isStatusTab } from './filters';
import type { CardPick, Scope, StatusTab } from './filters';
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, STATUS_COLOR, STATUS_LABEL } from './meta';
import { SummaryCards } from './SummaryCards';
import { TaskFormModal } from './TaskFormModal';
import type { TaskPage, TaskPriority, TaskRow } from './types';

const TaskDrawer = lazy(() => import('./TaskDrawer'));

const PAGE_SIZES = [10, 25, 50, 100];
type SortBy = 'due' | 'created' | 'priority';

export default function TasksPage() {
    const { user } = useAuth();
    const me = user?.id ?? '';
    const isAdmin = user?.role === 'ORG_ADMIN';
    const [sp, setSp] = useSearchParams();
    const [notify, holder] = message.useMessage();
    const refresh = useRefreshAfterTaskChange();
    const [creating, setCreating] = useState(false);
    const spKey = sp.toString();

    const users = useUsers();
    const entities = useEntities(true);

    // Everything on screen comes from the web address, so a reload, the back button and shared links all work
    const rawScope = sp.get('scope');
    const scope: Scope = rawScope === 'created' || rawScope === 'all' ? rawScope : 'mine';
    const rawStatus = sp.get('status');
    const status: StatusTab = isStatusTab(rawStatus) ? rawStatus : 'ACTIVE';
    const overdue = sp.get('overdue') === 'true';
    const priorityKey = (sp.get('priority') ?? '')
        .split(',')
        .filter((p) => (PRIORITIES as string[]).includes(p))
        .join(',');
    const priority = priorityKey ? (priorityKey.split(',') as TaskPriority[]) : [];
    const rawAssignee = sp.get('assignee') ?? '';
    const assignee = scope !== 'mine' && UUID.test(rawAssignee) ? rawAssignee : '';
    const rawEntity = sp.get('entity') ?? '';
    const entity = UUID.test(rawEntity) ? rawEntity : '';
    const dueFrom = sp.get('dueFrom') ?? '';
    const dueTo = sp.get('dueTo') ?? '';
    const search = sp.get('search') ?? '';
    const rawSort = sp.get('sortBy');
    const sortBy: SortBy = rawSort === 'created' || rawSort === 'priority' ? rawSort : 'due';
    const order = sp.get('order') === 'desc' ? 'desc' : 'asc';
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const requested = Number(sp.get('limit'));
    const limit = PAGE_SIZES.includes(requested) ? requested : 25;
    const rawOpen = sp.get('open');
    const openId = rawOpen && UUID.test(rawOpen) ? rawOpen : null;

    // What the cards count: your scope, priority, assignee, entity and search
    const baseQs = useMemo(() => {
        const p = new URLSearchParams();
        if (scope === 'mine') {
            p.set('assigneeId', me);
        } else {
            if (scope === 'created') p.set('createdById', me);
            if (assignee) p.set('assigneeId', assignee);
        }
        if (priorityKey) p.set('priority', priorityKey);
        if (entity) p.set('entityId', entity);
        if (search) p.set('search', search);
        return p.toString();
    }, [scope, me, assignee, priorityKey, entity, search]);

    const listQs = useMemo(() => {
        const p = new URLSearchParams(baseQs);
        const s = STATUS_PARAM[status];
        if (s) p.set('status', s);
        if (overdue) p.set('overdue', 'true');
        if (dueFrom && dueTo) {
            p.set('dueFrom', dueFrom);
            p.set('dueTo', dueTo);
        }
        p.set('sortBy', sortBy);
        p.set('order', order);
        p.set('page', String(page));
        p.set('limit', String(limit));
        return p.toString();
    }, [baseQs, status, overdue, dueFrom, dueTo, sortBy, order, page, limit]);

    const q = useQuery({
        queryKey: ['tasks', 'list', listQs],
        enabled: !!me,
        queryFn: ({ signal }) => api<TaskPage>(`/tasks?${listQs}`, { signal }),
        placeholderData: keepPreviousData,
    });

    const patch = useCallback(
        (changes: Record<string, string | null>) => {
            const next = new URLSearchParams(spKey);
            for (const [k, v] of Object.entries(changes)) {
                if (v) next.set(k, v);
                else next.delete(k);
            }
            next.delete('page');
            setSp(next, { replace: true });
        },
        [spKey, setSp],
    );

    const setOpen = useCallback(
        (id: string | null) => {
            const next = new URLSearchParams(spKey);
            if (id) next.set('open', id);
            else next.delete('open');
            setSp(next, { replace: id === null });
        },
        [spKey, setSp],
    );

    const onPick = (p: CardPick) => {
        if (p.priority) {
            patch({ priority: p.priority });
        } else if (p.due) {
            patch({ status: null, overdue: null, dueFrom: p.due.from, dueTo: p.due.to });
        } else if (p.overdue) {
            patch({ status: null, overdue: 'true', dueFrom: null, dueTo: null });
        } else if (p.status) {
            patch({ status: p.status === 'ACTIVE' ? null : p.status, overdue: null });
        }
    };

    const hasFilters = status !== 'ACTIVE' || overdue || !!priorityKey || !!assignee || !!entity || !!dueFrom || !!search;
    const clearFilters = () => {
        const next = new URLSearchParams(spKey);
        for (const k of ['status', 'overdue', 'priority', 'assignee', 'entity', 'dueFrom', 'dueTo', 'search', 'page']) next.delete(k);
        setSp(next, { replace: true });
    };

    const sortOrderFor = (key: SortBy): 'ascend' | 'descend' | null =>
        sortBy === key ? (order === 'desc' ? 'descend' : 'ascend') : null;

    const onTableChange: TableProps<TaskRow>['onChange'] = (pagination, _filters, sorter) => {
        const s = Array.isArray(sorter) ? sorter[0] : sorter;
        const next = new URLSearchParams(spKey);
        next.set('page', String(pagination.current ?? 1));
        next.set('limit', String(pagination.pageSize ?? 25));
        const key = s?.columnKey;
        if (key === 'due' || key === 'priority' || key === 'created') {
            if (key === 'due') next.delete('sortBy');
            else next.set('sortBy', key);
            if (s?.order === 'descend') next.set('order', 'desc');
            else next.delete('order');
        }
        setSp(next, { replace: true });
    };

    const personOptions = (users.data ?? []).map((u) => ({
        value: u.id,
        label: u.isActive ? u.name : `${u.name} (inactive)`,
    }));
    const entityOptions = (entities.data ?? []).map((e) => ({
        value: e.id,
        label: e.isActive ? e.name : `${e.name} (inactive)`,
    }));

    const columns: TableProps<TaskRow>['columns'] = [
        {
            title: 'Task',
            key: 'title',
            width: 340,
            render: (_, r) => (
                <div>
                    <Typography.Text strong>{r.title}</Typography.Text>
                    {r.entity && (
                        <div>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                {r.entity.name}
                            </Typography.Text>
                        </div>
                    )}
                </div>
            ),
        },
        {
            title: 'Priority',
            key: 'priority',
            width: 110,
            sorter: true,
            sortDirections: ['ascend', 'descend'],
            sortOrder: sortOrderFor('priority'),
            render: (_, r) => <Tag color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABEL[r.priority]}</Tag>,
        },
        {
            title: 'Status',
            key: 'status',
            width: 170,
            render: (_, r) => (
                <Space size={4} wrap>
                    <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Tag>
                    {r.overdue && <Tag color="red">Overdue</Tag>}
                </Space>
            ),
        },
        { title: 'Assigned to', key: 'assignee', width: 150, render: (_, r) => r.assignee.name },
        { title: 'Created by', key: 'by', width: 150, render: (_, r) => r.createdBy.name },
        {
            title: 'Due date',
            key: 'due',
            width: 130,
            sorter: true,
            sortDirections: ['ascend', 'descend'],
            sortOrder: sortOrderFor('due'),
            render: (_, r) => (r.dueDate ? formatDate(r.dueDate) : ''),
        },
        {
            title: 'Created',
            key: 'created',
            width: 130,
            sorter: true,
            sortDirections: ['ascend', 'descend'],
            sortOrder: sortOrderFor('created'),
            render: (_, r) => dayjs(r.createdAt).format('DD MMM YYYY'),
        },
    ];

    return (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {holder}
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Typography.Title level={4} style={{ margin: 0 }}>
                    Tasks
                </Typography.Title>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                    New task
                </Button>
            </Space>

            <ModuleBoundary compact label="The task summary" resetKey={baseQs}>
                <SummaryCards params={baseQs} onPick={onPick} />
            </ModuleBoundary>

            <LoadWarning label="The people list" error={users.isError} onRetry={() => void users.refetch()} />
            <LoadWarning label="The entity list" error={entities.isError} onRetry={() => void entities.refetch()} />

            <Segmented
                value={scope}
                onChange={(v) => patch({ scope: v === 'mine' ? null : String(v), assignee: null })}
                options={[
                    { label: 'Assigned to me', value: 'mine' },
                    { label: 'Created by me', value: 'created' },
                    { label: isAdmin ? 'All tasks' : 'All my tasks', value: 'all' },
                ]}
            />

            <Segmented
                value={status}
                onChange={(v) => patch({ status: v === 'ACTIVE' ? null : String(v), overdue: null })}
                options={STATUS_TABS}
            />

            <Space wrap>
                <Input.Search
                    key={search}
                    allowClear
                    maxLength={100}
                    placeholder="Search by title"
                    defaultValue={search}
                    style={{ width: 260 }}
                    onSearch={(v) => patch({ search: v.trim() || null })}
                />
                <Select
                    mode="multiple"
                    allowClear
                    maxTagCount="responsive"
                    placeholder="Any priority"
                    style={{ width: 190 }}
                    value={priority}
                    options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                    onChange={(v: string[]) => patch({ priority: v.length ? v.join(',') : null })}
                />
                {scope !== 'mine' && (
                    <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="Anyone assigned"
                        style={{ width: 200 }}
                        value={assignee || undefined}
                        options={personOptions}
                        onChange={(v: string | undefined) => patch({ assignee: v ?? null })}
                    />
                )}
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Any entity"
                    style={{ width: 200 }}
                    value={entity || undefined}
                    options={entityOptions}
                    onChange={(v: string | undefined) => patch({ entity: v ?? null })}
                />
                <DatePicker.RangePicker
                    value={dueFrom && dueTo ? [dayjs(dueFrom), dayjs(dueTo)] : null}
                    placeholder={['Due from', 'Due to']}
                    onChange={(range) => {
                        if (range?.[0] && range[1]) {
                            patch({ dueFrom: range[0].format('YYYY-MM-DD'), dueTo: range[1].format('YYYY-MM-DD') });
                        } else {
                            patch({ dueFrom: null, dueTo: null });
                        }
                    }}
                />
                <Checkbox
                    checked={overdue}
                    onChange={(e) => patch(e.target.checked ? { overdue: 'true', status: null } : { overdue: null })}
                >
                    Overdue only
                </Checkbox>
                {hasFilters && (
                    <Button type="link" onClick={clearFilters}>
                        Clear filters
                    </Button>
                )}
            </Space>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The tasks could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<TaskRow>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data?.items ?? []}
                loading={q.isFetching}
                scroll={{ x: 1180 }}
                onChange={onTableChange}
                onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
                locale={{
                    emptyText: scope === 'mine' ? 'Nothing assigned to you matches these filters.' : 'No tasks match these filters.',
                }}
                pagination={{
                    current: page,
                    pageSize: limit,
                    total: q.data?.total ?? 0,
                    showSizeChanger: true,
                    pageSizeOptions: PAGE_SIZES,
                    showTotal: (total) => `${total} tasks`,
                }}
            />

            {creating && (
                <TaskFormModal
                    task={null}
                    notify={notify}
                    onClose={() => setCreating(false)}
                    onSaved={(t) => {
                        setCreating(false);
                        notify.success('Task created');
                        void refresh();
                        setOpen(t.id);
                    }}
                />
            )}

            {openId && (
                <ModuleBoundary compact label="The task panel" resetKey={openId}>
                    <Suspense fallback={null}>
                        <TaskDrawer id={openId} notify={notify} onClose={() => setOpen(null)} />
                    </Suspense>
                </ModuleBoundary>
            )}
        </Space>
    );
}