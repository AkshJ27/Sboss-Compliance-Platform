import { useEffect, useState } from 'react';
import { Alert, Checkbox, Col, DatePicker, Form, Input, Modal, Row, Select, Skeleton, Space, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { api } from '../../core/api/client';
import { errorText } from '../../shared/errors';
import { RemoteSelect } from '../admin/RemoteSelect';
import type { Opt } from '../admin/RemoteSelect';
import { useLegalDetail } from './api';

type Values = {
    ruleId?: string;
    ministry?: string;
    notificationDate: Dayjs;
    effectiveDate?: Dayjs | null;
    publishedDate?: Dayjs | null;
    referenceNumber?: string;
    title: string;
    description: string;
    flags: string[];
    impactedCompliance?: string;
    notify: boolean;
};

const FLAGS = [
    { value: 'complianceImpact', label: 'Compliance impact' },
    { value: 'isChange', label: 'Change' },
    { value: 'isAddition', label: 'Addition' },
    { value: 'isDeletion', label: 'Deletion' },
    { value: 'isSchedule', label: 'Schedule' },
] as const;
type FlagKey = (typeof FLAGS)[number]['value'];

const DATE = 'DD-MMM-YYYY';
const day = (d: Dayjs | null | undefined) => (d ? d.format('YYYY-MM-DD') : null);
const fromDay = (s: string | null) => (s ? dayjs(s.slice(0, 10)) : null);

// The shared library's Acts, searched as you type
async function loadActs(search: string, signal: AbortSignal): Promise<Opt[]> {
    const qs = new URLSearchParams({ limit: '50' });
    if (search) qs.set('search', search);
    const page = await api<{ items: { id: string; name: string; state: string | null; orgId: string | null }[] }>(`/library/acts?${qs.toString()}`, { signal });
    return page.items.filter((a) => !a.orgId).map((a) => ({ value: a.id, label: a.state ? `${a.name} (${a.state})` : a.name }));
}

// Add or change a legal update (platform administrator)
export function LegalUpdateForm({ id, onClose, onSaved }: { id: string | 'new'; onClose: () => void; onSaved: (id: string) => void }) {
    const qc = useQueryClient();
    const [form] = Form.useForm<Values>();
    const [notify, holder] = message.useMessage();
    const [act, setAct] = useState<Opt | undefined>();
    const [busy, setBusy] = useState(false);
    const isNew = id === 'new';
    const detail = useLegalDetail(isNew ? null : id);

    const rules = useQuery({
        queryKey: ['library', 'rules', 'for-legal', act?.value],
        queryFn: ({ signal }) =>
            api<{ items: { id: string; name: string }[] }>(`/library/masters/rules?actId=${act?.value}&limit=100`, { signal }),
        enabled: !!act,
    });

    useEffect(() => {
        const d = detail.data;
        if (!d) return;
        setAct({ value: d.act.id, label: d.act.state ? `${d.act.name} (${d.act.state})` : d.act.name });
        form.setFieldsValue({
            ruleId: d.ruleId ?? undefined,
            ministry: d.ministry ?? undefined,
            notificationDate: fromDay(d.notificationDate) as Dayjs,
            effectiveDate: fromDay(d.effectiveDate),
            publishedDate: fromDay(d.publishedDate),
            referenceNumber: d.referenceNumber ?? undefined,
            title: d.title,
            description: d.description,
            flags: FLAGS.filter((f) => d[f.value]).map((f) => f.value),
            impactedCompliance: d.impactedCompliance ?? undefined,
        });
    }, [detail.data, form]);

    const save = async (v: Values) => {
        if (!act) {
            notify.error('Choose the Act');
            return;
        }
        setBusy(true);
        try {
            const flags = Object.fromEntries(FLAGS.map((f) => [f.value, v.flags?.includes(f.value) ?? false])) as Record<FlagKey, boolean>;
            const body = {
                actId: act.value,
                ruleId: v.ruleId ?? null,
                ministry: v.ministry?.trim() || null,
                notificationDate: day(v.notificationDate),
                effectiveDate: day(v.effectiveDate),
                ...(v.publishedDate ? { publishedDate: day(v.publishedDate) } : {}),
                referenceNumber: v.referenceNumber?.trim() || null,
                title: v.title.trim(),
                description: v.description.trim(),
                ...flags,
                impactedCompliance: v.impactedCompliance?.trim() || null,
            };
            const out = isNew
                ? await api<{ id: string; notified: number }>('/legal-updates', { method: 'POST', body: { ...body, notify: v.notify } })
                : await api<{ id: string }>(`/legal-updates/${id}`, { method: 'PATCH', body });
            notify.success(isNew && 'notified' in out && out.notified ? `Saved. ${out.notified} follower(s) told.` : 'Saved');
            await qc.invalidateQueries({ queryKey: ['legal'] });
            onSaved(out.id);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            width={900}
            title={isNew ? 'Add Legal Update' : 'Modify Legal Update'}
            okText={isNew ? 'Add' : 'Modify'}
            confirmLoading={busy}
            onOk={() => form.submit()}
            onCancel={onClose}
            destroyOnClose
            maskClosable={false}
        >
            {holder}
            {!isNew && detail.isLoading && <Skeleton active />}
            {detail.isError && <Alert type="error" showIcon message="The update could not be loaded" />}
            {(isNew || detail.data) && (
                <Form<Values> form={form} layout="vertical" initialValues={{ flags: [], notify: true }} onFinish={(v) => void save(v)}>
                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item label="Act" required>
                                <RemoteSelect
                                    cacheKey="legal-acts"
                                    load={loadActs}
                                    placeholder="Search the law library"
                                    value={act}
                                    onChange={(v) => {
                                        setAct(v as Opt | undefined);
                                        form.setFieldValue('ruleId', undefined);
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="ruleId" label="Rule">
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    disabled={!act}
                                    placeholder={act ? 'No particular rule' : 'Choose the Act first'}
                                    loading={rules.isFetching}
                                    options={(rules.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }))}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="notificationDate" label="Notification Date" rules={[{ required: true, message: 'Choose the date' }]}>
                                <DatePicker format={DATE} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="effectiveDate" label="Effective Date">
                                <DatePicker format={DATE} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="publishedDate" label="Published Date" tooltip="Left empty: the notification date">
                                <DatePicker format={DATE} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="referenceNumber" label="Notification No / Reference Number" rules={[{ max: 200 }]}>
                                <Input maxLength={200} placeholder="G.S.R. 968(E)" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="ministry" label="Ministry" rules={[{ max: 200 }]}>
                                <Input maxLength={200} placeholder="Ministry of Corporate Affairs" />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="title" label="Title" rules={[{ required: true, whitespace: true, message: 'Enter the title' }, { min: 3 }, { max: 500 }]}>
                                <Input maxLength={500} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="description" label="Description" rules={[{ required: true, whitespace: true, message: 'Enter the description' }, { min: 3 }, { max: 20000 }]}>
                                <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} maxLength={20000} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="flags" label="What it does">
                                <Checkbox.Group options={FLAGS.map((f) => ({ value: f.value, label: f.label }))} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name="impactedCompliance" label="Impacted Compliance" rules={[{ max: 5000 }]}>
                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={5000} />
                            </Form.Item>
                        </Col>
                        {isNew && (
                            <Col span={24}>
                                <Space>
                                    <Form.Item name="notify" valuePropName="checked" noStyle>
                                        <Checkbox>Tell the people who follow this Act</Checkbox>
                                    </Form.Item>
                                </Space>
                            </Col>
                        )}
                    </Row>
                </Form>
            )}
        </Modal>
    );
}