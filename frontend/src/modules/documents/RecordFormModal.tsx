import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Button, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Skeleton, Space, Table,
    Typography, Upload, message,
} from 'antd';
import type { UploadFile } from 'antd';
import { DeleteOutlined, DownloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { ACCESS_LABEL, checkFileBeforeUpload, downloadDocument, formatSize } from '../../shared/documents';
import type { AccessLevel } from '../../shared/documents';
import { errorText } from '../../shared/errors';
import { useEntities, useSimple, useUsers, userOptions } from '../admin/api';
import { ACCESS_HELP, useDocCategories, useEntityLocations } from './api';
import type { DocRecord } from './api';

type FormValues = {
    entityId: string;
    verticalId: string;
    locationId: string;
    departmentId: string;
    categoryId: string;
    subCategoryId?: string;
    subSubCategoryId?: string;
    name: string;
    docNumber?: string;
    accessLevel: AccessLevel;
    storedAt?: string;
    ownerId?: string;
    managerId?: string;
    reviewDate?: Dayjs | null;
    expiryDate?: Dayjs | null;
    alertDays?: number | null;
    additionalUserIds?: string[];
    remarks?: string;
};

type Props = {
    recordId: string | 'new';
    onClose: () => void;
};

const DATE_FORMAT = 'DD-MMM-YYYY';
const toDay = (d: Dayjs | null | undefined) => (d ? d.format('YYYY-MM-DD') : null);
const fromDay = (s: string | null) => (s ? dayjs(s.slice(0, 10)) : null);
const MAX_FILES = 10;

const limitLabel = (text: string, limit: string) => (
    <span>
        {text}{' '}
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            (max {limit})
        </Typography.Text>
    </span>
);

function toForm(r: DocRecord): FormValues {
    return {
        entityId: r.entityId,
        verticalId: r.verticalId,
        locationId: r.locationId,
        departmentId: r.departmentId,
        categoryId: r.categoryId,
        subCategoryId: r.subCategoryId ?? undefined,
        subSubCategoryId: r.subSubCategoryId ?? undefined,
        name: r.name,
        docNumber: r.docNumber ?? undefined,
        accessLevel: r.accessLevel,
        storedAt: r.storedAt ?? undefined,
        ownerId: r.ownerId,
        managerId: r.managerId ?? undefined,
        reviewDate: fromDay(r.reviewDate),
        expiryDate: fromDay(r.expiryDate),
        alertDays: r.alertDays,
        additionalUserIds: r.additionalUsers.map((u) => u.id),
        remarks: r.remarks ?? undefined,
    };
}

// What the server receives: text trimmed, empty values as null, dates as YYYY-MM-DD
function toBody(v: FormValues) {
    const t = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
    return {
        entityId: v.entityId,
        verticalId: v.verticalId,
        locationId: v.locationId,
        departmentId: v.departmentId,
        categoryId: v.categoryId,
        subCategoryId: v.subCategoryId ?? null,
        subSubCategoryId: v.subSubCategoryId ?? null,
        name: v.name.trim(),
        docNumber: t(v.docNumber),
        accessLevel: v.accessLevel,
        storedAt: t(v.storedAt),
        ...(v.ownerId ? { ownerId: v.ownerId } : {}),
        managerId: v.managerId ?? null,
        reviewDate: toDay(v.reviewDate),
        expiryDate: toDay(v.expiryDate),
        alertDays: v.alertDays ?? null,
        additionalUserIds: v.additionalUserIds ?? [],
        remarks: t(v.remarks),
    };
}

// Only what changed, so an edit never trips over values nobody touched
function changes(before: ReturnType<typeof toBody>, after: ReturnType<typeof toBody>) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(after)) {
        const b = (before as Record<string, unknown>)[k];
        const same = Array.isArray(v) && Array.isArray(b) ? [...v].sort().join() === [...b].sort().join() : v === b;
        if (!same) out[k] = v;
    }
    return out;
}

export function RecordFormModal({ recordId: initialId, onClose }: Props) {
    const qc = useQueryClient();
    const { user } = useAuth();
    const isAdmin = user?.role === 'ORG_ADMIN';
    const [notify, holder] = message.useMessage();
    const [form] = Form.useForm<FormValues>();
    const [recordId, setRecordId] = useState(initialId);
    const [files, setFiles] = useState<UploadFile[]>([]);
    const [busy, setBusy] = useState(false);
    const isNew = recordId === 'new';

    const rec = useQuery({
        queryKey: ['documents', 'record', recordId],
        queryFn: ({ signal }) => api<DocRecord>(`/documents/records/${recordId}`, { signal }),
        enabled: !isNew,
    });

    const entities = useEntities(false);
    const verticals = useSimple('verticals', false);
    const departments = useSimple('departments', false);
    const users = useUsers();

    const entityId = Form.useWatch('entityId', form);
    const categoryId = Form.useWatch('categoryId', form);
    const subCategoryId = Form.useWatch('subCategoryId', form);
    const expiryDate = Form.useWatch('expiryDate', form);
    const locations = useEntityLocations(entityId);
    const cats = useDocCategories(1);
    const subs = useDocCategories(2, categoryId);
    const subSubs = useDocCategories(3, subCategoryId);

    const loaded = rec.data;
    const readOnly = !!loaded && !loaded.can.edit;

    useEffect(() => {
        if (loaded) form.setFieldsValue(toForm(loaded));
    }, [loaded, form]);

    // Keeps an inactive value that is already saved visible in its dropdown
    const withCurrent = (opts: { value: string; label: string }[], current: { id: string; name: string } | null | undefined) =>
        current && !opts.some((o) => o.value === current.id) ? [...opts, { value: current.id, label: `${current.name} (inactive)` }] : opts;

    const opts = useMemo(
        () => ({
            entities: withCurrent((entities.data ?? []).map((e) => ({ value: e.id, label: e.name })), loaded?.entity),
            verticals: withCurrent((verticals.data ?? []).map((e) => ({ value: e.id, label: e.name })), loaded?.vertical),
            departments: withCurrent((departments.data ?? []).map((e) => ({ value: e.id, label: e.name })), loaded?.department),
            locations: withCurrent(
                (locations.data?.items ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.name })),
                loaded && loaded.entityId === entityId ? loaded.location : null,
            ),
            cats: withCurrent((cats.data ?? []).map((c) => ({ value: c.id, label: c.name })), loaded?.category),
            subs: withCurrent((subs.data ?? []).map((c) => ({ value: c.id, label: c.name })), loaded?.categoryId === categoryId ? loaded?.subCategory : null),
            subSubs: withCurrent(
                (subSubs.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                loaded?.subCategoryId === subCategoryId ? loaded?.subSubCategory : null,
            ),
            people: userOptions(users.data),
            everyone: (users.data ?? []).filter((u) => u.isActive).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [entities.data, verticals.data, departments.data, locations.data, cats.data, subs.data, subSubs.data, users.data, loaded, entityId, categoryId, subCategoryId],
    );

    const refresh = () => qc.invalidateQueries({ queryKey: ['documents'] });

    const uploadFiles = async (id: string) => {
        if (!files.length) return;
        const fd = new FormData();
        for (const f of files) fd.append('files', f.originFileObj as File);
        await api(`/documents/records/${id}/files`, { method: 'POST', form: fd });
        setFiles([]);
    };

    const save = async (v: FormValues) => {
        setBusy(true);
        let savedId: string | null = null;
        try {
            const body = toBody(v);
            if (isNew) {
                const created = await api<DocRecord>('/documents/records', { method: 'POST', body });
                savedId = created.id;
            } else if (loaded) {
                const diff = changes(toBody(toForm(loaded)), body);
                if (Object.keys(diff).length) await api(`/documents/records/${loaded.id}`, { method: 'PATCH', body: diff });
                savedId = loaded.id;
            }
            if (savedId) await uploadFiles(savedId);
            notify.success(isNew ? 'Document added' : 'Document saved');
            await refresh();
            onClose();
        } catch (e) {
            await refresh();
            if (isNew && savedId) {
                // The details were saved; only the files failed. Stay open on the saved document.
                notify.error(`The document was saved, but the files were not uploaded: ${errorText(e)}`);
                setRecordId(savedId);
            } else {
                notify.error(errorText(e));
            }
        } finally {
            setBusy(false);
        }
    };

    const removeRecord = async () => {
        if (!loaded) return;
        try {
            await api(`/documents/records/${loaded.id}`, { method: 'DELETE' });
            notify.success('Document deleted');
            await refresh();
            onClose();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const removeFile = async (fileId: string) => {
        if (!loaded) return;
        try {
            await api(`/documents/records/${loaded.id}/files/${fileId}`, { method: 'DELETE' });
            notify.success('File removed');
            await refresh();
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const download = async (fileId: string) => {
        try {
            await downloadDocument(fileId);
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const ownerName = loaded?.owner.name ?? (users.data ?? []).find((u) => u.id === user?.id)?.name ?? '';

    const footer = (
        <Space>
            {loaded?.can.delete && (
                <Popconfirm
                    title="Delete this document?"
                    description="Its files are removed from the list too. The audit log keeps the history."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void removeRecord()}
                >
                    <Button danger>Delete</Button>
                </Popconfirm>
            )}
            <Button onClick={onClose}>Close</Button>
            {!readOnly && (
                <Button type="primary" loading={busy} onClick={() => form.submit()}>
                    {isNew ? 'Add' : 'Modify'}
                </Button>
            )}
        </Space>
    );

    return (
        <Modal
            open
            width={1100}
            title={isNew ? 'Add Document' : readOnly ? 'View Document' : 'Modify Document'}
            onCancel={onClose}
            footer={footer}
            destroyOnClose
            maskClosable={false}
        >
            {holder}
            {!isNew && rec.isLoading && <Skeleton active />}
            {rec.isError && <Alert type="error" showIcon message="The document could not be loaded" description={rec.error.message} />}
            {readOnly && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="You can view this document but not change it" />}

            {(isNew || loaded) && (
                <Form<FormValues>
                    form={form}
                    layout="vertical"
                    disabled={readOnly}
                    initialValues={{ accessLevel: 'PROTECTED' }}
                    onFinish={(v) => void save(v)}
                >
                    <Row gutter={16}>
                        <Col xs={24} md={8}>
                            <Form.Item name="entityId" label="Entity" rules={[{ required: true, message: 'Choose the entity' }]}>
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select Entity"
                                    options={opts.entities}
                                    onChange={() => form.setFieldValue('locationId', undefined)}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={16}>
                        <Col xs={24} md={8}>
                            <Form.Item name="verticalId" label="Vertical" rules={[{ required: true, message: 'Choose the vertical' }]}>
                                <Select showSearch optionFilterProp="label" placeholder="Select Vertical" options={opts.verticals} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="locationId" label="Location" rules={[{ required: true, message: 'Choose the location' }]}>
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder={entityId ? 'Select Location' : 'Choose the entity first'}
                                    disabled={readOnly || !entityId}
                                    loading={locations.isFetching}
                                    options={opts.locations}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="departmentId" label="Department" rules={[{ required: true, message: 'Choose the department' }]}>
                                <Select showSearch optionFilterProp="label" placeholder="Select Department" options={opts.departments} />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={8}>
                            <Form.Item name="categoryId" label="Category" rules={[{ required: true, message: 'Choose the category' }]}>
                                <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select Category"
                                    options={opts.cats}
                                    onChange={() => form.setFieldsValue({ subCategoryId: undefined, subSubCategoryId: undefined })}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="subCategoryId" label="Sub Category">
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select Sub Category"
                                    disabled={readOnly || !categoryId}
                                    options={opts.subs}
                                    onChange={() => form.setFieldValue('subSubCategoryId', undefined)}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="subSubCategoryId" label="Sub Sub Category">
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="Select Sub Sub Category"
                                    disabled={readOnly || !subCategoryId}
                                    options={opts.subSubs}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={8}>
                            <Form.Item
                                name="name"
                                label={limitLabel('Document Name', '500 chars')}
                                rules={[{ required: true, whitespace: true, message: 'Enter the document name' }, { max: 500 }]}
                            >
                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={500} placeholder="Enter Document Name" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="docNumber" label={limitLabel('Document Number', '100 chars')} rules={[{ max: 100 }]}>
                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={100} placeholder="Enter Document No" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="accessLevel" label="Document Type" rules={[{ required: true }]}>
                                <Select
                                    optionLabelProp="label"
                                    options={(['PUBLIC', 'PRIVATE', 'PROTECTED', 'RESTRICTED'] as AccessLevel[]).map((a) => ({
                                        value: a,
                                        label: ACCESS_LABEL[a],
                                        disabled: a === 'RESTRICTED' && !isAdmin && loaded?.accessLevel !== 'RESTRICTED',
                                        title: ACCESS_HELP[a],
                                    }))}
                                    optionRender={(o) => (
                                        <div>
                                            <div>{o.label}</div>
                                            <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'normal' }}>
                                                {ACCESS_HELP[o.value as AccessLevel]}
                                            </Typography.Text>
                                        </div>
                                    )}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={8}>
                            <Form.Item name="storedAt" label={limitLabel('Document Location', '200 chars')} rules={[{ max: 200 }]}>
                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} maxLength={200} placeholder="Where the physical copy is kept" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            {isAdmin ? (
                                <Form.Item name="ownerId" label="Owner" tooltip="Left empty, you are the owner">
                                    <Select allowClear showSearch optionFilterProp="label" placeholder={ownerName || 'You'} options={opts.people} />
                                </Form.Item>
                            ) : (
                                <Form.Item label="Owner">
                                    <Input value={ownerName} disabled />
                                </Form.Item>
                            )}
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="managerId" label="Manager">
                                <Select allowClear showSearch optionFilterProp="label" placeholder="Select Manager" options={opts.people} />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={8}>
                            <Form.Item name="reviewDate" label="Review Date">
                                <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} placeholder="Choose Date" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name="expiryDate" label="Expiry Date">
                                <DatePicker format={DATE_FORMAT} style={{ width: '100%' }} placeholder="Choose Date" />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name="alertDays"
                                label={limitLabel('Alert Days', '3 digits')}
                                tooltip="How many days before the expiry date to start reminding the owner"
                                rules={[
                                    {
                                        validator: (_, v: number | null | undefined) =>
                                            v !== null && v !== undefined && !expiryDate
                                                ? Promise.reject(new Error('Set the expiry date first'))
                                                : Promise.resolve(),
                                    },
                                ]}
                            >
                                <InputNumber min={0} max={999} precision={0} style={{ width: '100%' }} placeholder="Enter Alert Days" />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={16}>
                            <Form.Item name="additionalUserIds" label="Additional User" tooltip="People who can see and open this document besides the owner and manager">
                                <Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Select Additional User" options={opts.everyone} maxTagCount="responsive" />
                            </Form.Item>
                        </Col>

                        <Col span={24}>
                            <Form.Item name="remarks" label={limitLabel('Remarks', '1000 chars')} rules={[{ max: 1000 }]}>
                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} placeholder="Enter Remarks" />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            )}

            {loaded && (
                <div style={{ marginBottom: 16 }}>
                    <Typography.Title level={5}>Attachments</Typography.Title>
                    {!loaded.can.open ? (
                        <Alert type="warning" showIcon message={`This document has ${loaded.fileCount} file(s), but only the named people can open them`} />
                    ) : (
                        <Table
                            size="small"
                            rowKey="id"
                            pagination={false}
                            dataSource={loaded.files}
                            locale={{ emptyText: 'No files yet' }}
                            columns={[
                                { title: 'File Name', key: 'n', render: (_, f) => `${f.fileName} (${formatSize(f.sizeBytes)})` },
                                { title: 'Uploaded By', key: 'u', width: 180, render: (_, f) => f.uploadedBy.name },
                                { title: 'Uploaded On', key: 'd', width: 190, render: (_, f) => dayjs(f.createdAt).format('DD-MMM-YYYY hh:mm A') },
                                {
                                    title: 'Download',
                                    key: 'dl',
                                    width: 90,
                                    render: (_, f) => <Button type="link" icon={<DownloadOutlined />} onClick={() => void download(f.id)} />,
                                },
                                ...(loaded.can.edit
                                    ? [
                                        {
                                            title: 'Remove',
                                            key: 'rm',
                                            width: 80,
                                            render: (_: unknown, f: { id: string; fileName: string }) => (
                                                <Popconfirm title={`Remove ${f.fileName}?`} okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => void removeFile(f.id)}>
                                                    <Button type="link" danger icon={<DeleteOutlined />} />
                                                </Popconfirm>
                                            ),
                                        },
                                    ]
                                    : []),
                            ]}
                        />
                    )}
                </div>
            )}

            {!readOnly && (isNew || loaded) && (
                <Space direction="vertical">
                    <Upload
                        multiple
                        fileList={files}
                        beforeUpload={(file) => {
                            const problem = checkFileBeforeUpload(file);
                            if (problem) {
                                notify.error(`${file.name}: ${problem}`);
                                return Upload.LIST_IGNORE;
                            }
                            return false; // uploaded when the form is saved
                        }}
                        onChange={({ fileList }) => setFiles(fileList.slice(0, MAX_FILES))}
                    >
                        <Button icon={<PaperClipOutlined />}>Choose Files</Button>
                    </Upload>
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                        Up to {MAX_FILES} files at a time, 10 MB each. Allowed: PDF, Word, Excel, CSV, text and images. Programs (.exe, .dll) are never accepted.
                    </Typography.Text>
                </Space>
            )}
        </Modal>
    );
}