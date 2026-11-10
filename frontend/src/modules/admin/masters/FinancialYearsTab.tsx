import { useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, Modal, Space, Switch, Table, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { fyLabel } from '../../../core/filters';
import { formatDate } from '../../../core/format';
import { errorText } from '../../../shared/errors';
import { useFinancialYears } from '../api';
import type { FinancialYear } from '../api';

type FormValues = { label: string; range: [Dayjs, Dayjs]; isCurrent: boolean };

type ModalProps = {
    initial: FinancialYear | null;
    busy: boolean;
    onSave: (v: FormValues) => void;
    onCancel: () => void;
};

function FyModal({ initial, busy, onSave, onCancel }: ModalProps) {
    const [form] = Form.useForm<FormValues>();
    return (
        <Modal
            open
            title={initial ? 'Edit financial year' : 'New financial year'}
            okText="Save"
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={onCancel}
            destroyOnClose
        >
            <Form<FormValues>
                form={form}
                layout="vertical"
                initialValues={{
                    label: initial?.label ?? '',
                    range: initial ? [dayjs(initial.startDate.slice(0, 10)), dayjs(initial.endDate.slice(0, 10))] : undefined,
                    isCurrent: false,
                }}
                onValuesChange={(changed: Partial<FormValues>) => {
                    const start = changed.range?.[0];
                    if (start && !form.getFieldValue('label')) form.setFieldValue('label', fyLabel(start.year()));
                }}
                onFinish={(v) => onSave({ ...v, label: v.label.trim() })}
            >
                <Form.Item
                    label="Dates"
                    name="range"
                    extra="The financial year normally runs from 1 April to 31 March."
                    rules={[{ required: true, message: 'Choose the start and end dates' }]}
                >
                    <DatePicker.RangePicker format="DD MMM YYYY" style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                    label="Label"
                    name="label"
                    rules={[
                        { required: true, whitespace: true, message: 'Enter a label, such as 2027-28' },
                        { min: 4, message: 'At least 4 characters' },
                    ]}
                >
                    <Input maxLength={20} />
                </Form.Item>
                {!initial && (
                    <Form.Item label="Make this the current year" name="isCurrent" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                )}
            </Form>
        </Modal>
    );
}

export function FinancialYearsTab() {
    const qc = useQueryClient();
    const [notify, holder] = message.useMessage();
    const [editing, setEditing] = useState<FinancialYear | 'new' | null>(null);
    const [busy, setBusy] = useState(false);
    const q = useFinancialYears();

    const refresh = () => qc.invalidateQueries({ queryKey: ['masters'] });

    const save = async (v: FormValues) => {
        const startDate = v.range[0].format('YYYY-MM-DD');
        const endDate = v.range[1].format('YYYY-MM-DD');
        setBusy(true);
        try {
            if (editing === 'new') {
                await api('/masters/financial-years', {
                    method: 'POST',
                    body: { label: v.label, startDate, endDate, isCurrent: v.isCurrent },
                });
            } else if (editing) {
                await api(`/masters/financial-years/${editing.id}`, {
                    method: 'PATCH',
                    body: { label: v.label, startDate, endDate },
                });
            }
            notify.success('Saved');
            setEditing(null);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    const makeCurrent = async (row: FinancialYear) => {
        try {
            await api(`/masters/financial-years/${row.id}`, { method: 'PATCH', body: { isCurrent: true } });
            notify.success(`${row.label} is now the current year`);
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const columns: TableProps<FinancialYear>['columns'] = [
        { title: 'Label', dataIndex: 'label', key: 'label' },
        { title: 'Starts', key: 'start', render: (_, r) => formatDate(r.startDate) },
        { title: 'Ends', key: 'end', render: (_, r) => formatDate(r.endDate) },
        {
            title: 'Status',
            key: 'status',
            width: 110,
            render: (_, r) => (r.isCurrent ? <Tag color="blue">Current</Tag> : ''),
        },
        {
            title: '',
            key: 'actions',
            width: 200,
            render: (_, r) => (
                <Space>
                    <Button size="small" onClick={() => setEditing(r)}>
                        Edit
                    </Button>
                    {!r.isCurrent && (
                        <Button size="small" onClick={() => void makeCurrent(r)}>
                            Make current
                        </Button>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {holder}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')} style={{ width: 'fit-content' }}>
                New financial year
            </Button>

            {q.isError && (
                <Alert
                    type="error"
                    showIcon
                    message="The financial years could not be loaded"
                    description={q.error.message}
                    action={
                        <Button size="small" onClick={() => void q.refetch()}>
                            Retry
                        </Button>
                    }
                />
            )}

            <Table<FinancialYear>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={q.data ?? []}
                loading={q.isFetching}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />

            {editing && (
                <FyModal
                    initial={editing === 'new' ? null : editing}
                    busy={busy}
                    onSave={(v) => void save(v)}
                    onCancel={() => setEditing(null)}
                />
            )}
        </Space>
    );
}