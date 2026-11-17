import { useEffect, useState } from 'react';
import { Alert, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Table, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../core/api/client';
import { errorText } from '../../../shared/errors';
import { useEntities, useSimple, useUsers } from '../api';
import type { LocationPage } from '../api';
import { addInternal, editInternal, isFailure, useRefreshLibrary } from './internal';
import type { EditValues, Failure, InternalValues, RowError } from './internal';

type Named = { id: string; name: string };
type Lookups = { lawCategories: Named[]; natures: Named[] };

const PERIODICITY = [
    { value: 'M', label: 'Monthly' },
    { value: 'Q', label: 'Quarterly' },
    { value: 'H', label: 'Half yearly' },
    { value: 'A', label: 'Annual' },
    { value: 'O', label: 'One time' },
    { value: 'E', label: 'Event based' },
];
const RISK = [
    { value: 'H', label: 'High' },
    { value: 'M', label: 'Medium' },
    { value: 'L', label: 'Low' },
];
const ATTACHMENT = [
    { value: 'M', label: 'Mandatory' },
    { value: 'O', label: 'Optional' },
];

function useLookups() {
    return useQuery({
        queryKey: ['library', 'lookups'],
        queryFn: ({ signal }) => api<Lookups>('/library/lookups', { signal }),
        staleTime: 5 * 60_000,
    });
}

function ProblemList({ failure }: { failure: Failure }) {
    return (
        <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="Please fix these and save again"
            description={
                <Table<RowError>
                    size="small"
                    pagination={false}
                    rowKey={(r) => `${r.field ?? ''}:${r.message}`}
                    dataSource={failure.errors}
                    columns={[
                        { title: 'Field', key: 'f', width: 180, render: (_, r) => r.field ?? '' },
                        { title: 'Problem', dataIndex: 'message', key: 'm' },
                    ]}
                />
            }
        />
    );
}

type AddForm = Omit<InternalValues, 'effectiveDate' | 'onDay' | 'alertOwner' | 'alertManager'> & {
    effectiveDate?: Dayjs;
    onDay?: number;
    alertOwner?: number;
    alertManager?: number;
};

// One internal compliance, scheduled at one location. It goes through the same checks as an uploaded row.
export function AddInternalModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (code: string) => void }) {
    const [form] = Form.useForm<AddForm>();
    const refresh = useRefreshLibrary();
    const [saving, setSaving] = useState(false);
    const [failure, setFailure] = useState<Failure | null>(null);
    const [error, setError] = useState<string | null>(null);

    const entities = useEntities(false);
    const departments = useSimple('departments', false);
    const verticals = useSimple('verticals', false);
    const users = useUsers();
    const lookups = useLookups();

    const entityCode = Form.useWatch('entity', form);
    const periodicity = Form.useWatch('periodicity', form);
    const entityId = entities.data?.find((e) => e.code === entityCode)?.id;

    const locations = useQuery({
        queryKey: ['masters', 'locations', 'for-entity', entityId],
        queryFn: ({ signal }) => api<LocationPage>(`/masters/locations?entityId=${entityId}&limit=100`, { signal }),
        enabled: !!entityId,
    });

    useEffect(() => {
        if (open) {
            form.resetFields();
            setFailure(null);
            setError(null);
        }
    }, [open, form]);

    const people = (users.data ?? [])
        .filter((u) => u.isActive && u.role !== 'VIEWER')
        .map((u) => ({ value: u.email, label: `${u.name} (${u.email})` }));
    const byName = (list: { name: string }[] | undefined) => (list ?? []).map((x) => ({ value: x.name, label: x.name }));

    const save = async () => {
        let v: AddForm;
        try {
            v = await form.validateFields();
        } catch {
            return;
        }
        setSaving(true);
        setFailure(null);
        setError(null);
        try {
            const out = await addInternal({
                ...v,
                effectiveDate: v.effectiveDate?.format('YYYY-MM-DD'),
                onDay: v.onDay === undefined ? undefined : String(v.onDay),
                alertOwner: v.alertOwner === undefined ? undefined : String(v.alertOwner),
                alertManager: v.alertManager === undefined ? undefined : String(v.alertManager),
            });
            if (isFailure(out)) {
                setFailure(out);
                return;
            }
            await refresh();
            onCreated(out.sample[0]?.code ?? '');
        } catch (e) {
            setError(e instanceof Error ? e.message : errorText(e));
        } finally {
            setSaving(false);
        }
    };

    const req = [{ required: true, message: 'Required' }];

    return (
        <Modal
            open={open}
            title="Add internal compliance"
            width={980}
            okText="Add"
            confirmLoading={saving}
            onOk={() => void save()}
            onCancel={onClose}
            destroyOnClose
        >
            {failure && <ProblemList failure={failure} />}
            {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
            <Form<AddForm> form={form} layout="vertical" requiredMark initialValues={{ startEnd: 'E', yearBasis: 'F', attachment: 'O', risk: 'M' }}>
                <Form.Item name="title" label="Compliance name" rules={[...req, { max: 500 }]}>
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={500} showCount />
                </Form.Item>
                <Form.Item name="description" label="Description" rules={[...req, { max: 20000 }]}>
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={20000} />
                </Form.Item>

                <Row gutter={12}>
                    <Col xs={24} md={6}>
                        <Form.Item name="periodicity" label="Periodicity" rules={req}>
                            <Select options={PERIODICITY} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                        <Form.Item
                            name="onDay"
                            label={periodicity === 'E' ? 'Days after the event' : 'On day'}
                            rules={req}
                            tooltip={periodicity === 'E' ? '0 to 365' : 'Day of the month it is due, 1 to 31'}
                        >
                            <InputNumber min={periodicity === 'E' ? 0 : 1} max={periodicity === 'E' ? 365 : 31} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    {periodicity === 'E' ? (
                        <Col xs={24} md={12}>
                            <Form.Item name="event" label="Event name" rules={[...req, { max: 500 }]}>
                                <Input maxLength={500} />
                            </Form.Item>
                        </Col>
                    ) : (
                        <>
                            <Col xs={24} md={6}>
                                <Form.Item
                                    name="startEnd"
                                    label="Due from"
                                    rules={req}
                                    tooltip="End: that day of the month after the period ends. Start: that day of the first month of the period."
                                >
                                    <Select
                                        options={[
                                            { value: 'E', label: 'End of the period' },
                                            { value: 'S', label: 'Start of the period' },
                                        ]}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={6}>
                                <Form.Item name="yearBasis" label="Year" rules={req}>
                                    <Select
                                        options={[
                                            { value: 'F', label: 'Financial (Apr-Mar)' },
                                            { value: 'C', label: 'Calendar (Jan-Dec)' },
                                        ]}
                                    />
                                </Form.Item>
                            </Col>
                        </>
                    )}
                </Row>

                <Row gutter={12}>
                    <Col xs={24} md={6}>
                        <Form.Item name="effectiveDate" label="Effective date" rules={req}>
                            <DatePicker format="DD-MMM-YYYY" style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                        <Form.Item name="risk" label="Risk" rules={req}>
                            <Select options={RISK} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                        <Form.Item name="attachment" label="Attachment" rules={req}>
                            <Select options={ATTACHMENT} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                        <Form.Item name="nature" label="Compliance nature">
                            <Select allowClear showSearch options={byName(lookups.data?.natures)} />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={12}>
                    <Col xs={24} md={8}>
                        <Form.Item name="entity" label="Entity" rules={req}>
                            <Select
                                showSearch
                                optionFilterProp="label"
                                loading={entities.isLoading}
                                options={(entities.data ?? []).map((e) => ({ value: e.code, label: e.name }))}
                                onChange={() => form.setFieldValue('location', undefined)}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="location" label="Location" rules={req}>
                            <Select
                                showSearch
                                disabled={!entityId}
                                loading={locations.isFetching}
                                placeholder={entityId ? undefined : 'Choose the entity first'}
                                options={(locations.data?.items ?? []).filter((l) => l.isActive).map((l) => ({ value: l.name, label: `${l.name}, ${l.state}` }))}
                            />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="lawCategory" label="Law category" tooltip='Leave empty to file it under "Internal Compliance"'>
                            <Select allowClear showSearch options={byName(lookups.data?.lawCategories)} />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={12}>
                    <Col xs={24} md={12}>
                        <Form.Item name="department" label="Department" rules={req}>
                            <Select showSearch options={byName(departments.data?.filter((d) => d.isActive))} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="vertical" label="Vertical" rules={req}>
                            <Select showSearch options={byName(verticals.data?.filter((d) => d.isActive))} />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={12}>
                    <Col xs={24} md={9}>
                        <Form.Item name="owner" label="Owner" rules={req}>
                            <Select showSearch optionFilterProp="label" options={people} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={3}>
                        <Form.Item name="alertOwner" label="Alert days" rules={req}>
                            <InputNumber min={0} max={999} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={9}>
                        <Form.Item name="manager" label="Manager" rules={req}>
                            <Select showSearch optionFilterProp="label" options={people} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={3}>
                        <Form.Item
                            name="alertManager"
                            label="Alert days"
                            rules={req}
                            tooltip="Must be fewer than the owner's alert days"
                        >
                            <InputNumber min={0} max={999} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={12}>
                    <Col xs={24} md={12}>
                        <Form.Item name="approver" label="Approver" tooltip="Optional. Gives the final approval after the manager.">
                            <Select allowClear showSearch optionFilterProp="label" options={people} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item name="proof" label="Proof of compliance" rules={[{ max: 1000 }]}>
                            <Input maxLength={1000} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="penalty" label="Penalty" rules={[{ max: 2000 }]}>
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} />
                </Form.Item>
            </Form>
        </Modal>
    );
}

export type EditableCompliance = {
    id: string;
    code: string;
    title: string;
    description: string | null;
    attachment: string;
    proofOfCompliance: string | null;
    risk: string;
    applicability: string | null;
    penalty: string | null;
    alertOwnerDays: number | null;
    alertManagerDays: number | null;
    isActive: boolean;
};

type EditForm = Omit<EditValues, 'alertOwnerDays' | 'alertManagerDays'> & { alertOwnerDays: number; alertManagerDays: number };

const LETTER: Record<string, string> = { HIGH: 'H', MEDIUM: 'M', LOW: 'L', MANDATORY: 'M', OPTIONAL: 'O', NOT_REQUIRED: 'O' };

// Changes the descriptive fields. Timing and people are not changed here, because items already exist.
export function EditInternalModal({ item, onClose, onSaved }: { item: EditableCompliance; onClose: () => void; onSaved: () => void }) {
    const [form] = Form.useForm<EditForm>();
    const refresh = useRefreshLibrary();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        let v: EditForm;
        try {
            v = await form.validateFields();
        } catch {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await editInternal(item.id, {
                ...v,
                proofOfCompliance: v.proofOfCompliance ?? '',
                applicability: v.applicability ?? '',
                penalty: v.penalty ?? '',
                alertOwnerDays: String(v.alertOwnerDays),
                alertManagerDays: String(v.alertManagerDays),
            });
            await refresh();
            onSaved();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setSaving(false);
        }
    };

    const req = [{ required: true, message: 'Required' }];

    return (
        <Modal open title={`Modify ${item.code}`} width={860} okText="Save" confirmLoading={saving} onOk={() => void save()} onCancel={onClose}>
            {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}
            <Typography.Paragraph type="secondary">
                Periodicity, due day, location and people cannot be changed here. Change people under Setup, Schedules.
            </Typography.Paragraph>
            <Form<EditForm>
                form={form}
                layout="vertical"
                initialValues={{
                    title: item.title,
                    description: item.description ?? '',
                    attachment: LETTER[item.attachment],
                    proofOfCompliance: item.proofOfCompliance ?? '',
                    risk: LETTER[item.risk],
                    applicability: item.applicability ?? '',
                    penalty: item.penalty ?? '',
                    alertOwnerDays: item.alertOwnerDays ?? 0,
                    alertManagerDays: item.alertManagerDays ?? 0,
                    isActive: item.isActive ? 'Y' : 'N',
                }}
            >
                <Row gutter={12}>
                    <Col xs={24} md={18}>
                        <Form.Item name="title" label="Compliance name" rules={[...req, { min: 3 }, { max: 500 }]}>
                            <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={500} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={6}>
                        <Form.Item name="isActive" label="Active" rules={req} tooltip="Inactive items stop generating new dated items">
                            <Select options={[{ value: 'Y', label: 'Active' }, { value: 'N', label: 'Inactive' }]} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="description" label="Description" rules={[...req, { max: 20000 }]}>
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={20000} />
                </Form.Item>
                <Row gutter={12}>
                    <Col xs={12} md={6}>
                        <Form.Item name="risk" label="Risk" rules={req}>
                            <Select options={RISK} />
                        </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                        <Form.Item name="attachment" label="Attachment" rules={req}>
                            <Select options={ATTACHMENT} />
                        </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                        <Form.Item name="alertOwnerDays" label="Owner alert days" rules={req}>
                            <InputNumber min={0} max={999} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                        <Form.Item name="alertManagerDays" label="Manager alert days" rules={req}>
                            <InputNumber min={0} max={999} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="proofOfCompliance" label="Proof of compliance" rules={[{ max: 1000 }]}>
                    <Input maxLength={1000} />
                </Form.Item>
                <Form.Item name="applicability" label="Applicability" rules={[{ max: 2000 }]}>
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} />
                </Form.Item>
                <Form.Item name="penalty" label="Penalty" rules={[{ max: 2000 }]}>
                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} />
                </Form.Item>
            </Form>
        </Modal>
    );
}