import { useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Radio, Select, Space } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import type { MessageInstance } from 'antd/es/message/interface';
import { api } from '../../core/api/client';
import { useAuth } from '../../core/auth/AuthContext';
import { errorText } from '../../shared/errors';
import { useRefreshAfterChange } from './api';
import type { RecordDetail } from './types';

type FormValues = {
    submissionType: 'APPLICABLE' | 'NOT_APPLICABLE';
    doneDate: Dayjs | null;
    refNo?: string;
    challanNo?: string;
    actualImprisonment: boolean;
    payableAmount: number | null;
    amountPaid: number | null;
    penaltyPaid: number | null;
    remarks?: string;
};

type Props = {
    record: RecordDetail;
    notify: MessageInstance;
    onNavigate: (id: string) => void;
};

const toNumber = (s: string | null) => (s === null ? null : Number(s));

// The server refuses fields it does not know and empty numbers, so only send what is filled in
function buildBody(v: FormValues) {
    const body: Record<string, unknown> = { submissionType: v.submissionType };
    if (v.doneDate) body.doneDate = v.doneDate.format('YYYY-MM-DD');
    body.remarks = (v.remarks ?? '').trim();

    if (v.submissionType === 'APPLICABLE') {
        body.refNo = (v.refNo ?? '').trim();
        body.challanNo = (v.challanNo ?? '').trim();
        body.actualImprisonment = v.actualImprisonment;
        if (v.payableAmount !== null && v.payableAmount !== undefined) body.payableAmount = v.payableAmount;
        if (v.amountPaid !== null && v.amountPaid !== undefined) body.amountPaid = v.amountPaid;
        if (v.penaltyPaid !== null && v.penaltyPaid !== undefined) body.penaltyPaid = v.penaltyPaid;
    }
    return body;
}

// The owner's next open item, oldest due date first
async function findNextOpen(ownerId: string, currentId: string): Promise<string | null> {
    const res = await api<{ items: { id: string }[] }>(
        `/compliance/instances?ownerId=${ownerId}&status=DUE,RETURNED&order=asc&limit=100`,
    );
    const ids = res.items.map((i) => i.id);
    const at = ids.indexOf(currentId);
    // After a submit the current item is no longer open, so the first one is the next
    return (at === -1 ? ids[0] : ids[at + 1]) ?? null;
}

export function SubmitForm({ record, notify, onNavigate }: Props) {
    const { user } = useAuth();
    const refresh = useRefreshAfterChange();
    const [form] = Form.useForm<FormValues>();
    const [busy, setBusy] = useState<null | 'draft' | 'submit' | 'next' | 'skip'>(null);

    // From the period start, or for the few items due before their period starts, up to a year before the due date
    const periodStart = dayjs(record.periodStart.slice(0, 10));
    const dueDate = dayjs(record.dueDate.slice(0, 10));
    const earliest = dueDate.isBefore(periodStart, 'day') ? dueDate.subtract(365, 'day') : periodStart;
    const disabledDate = (d: Dayjs) => d.isAfter(dayjs(), 'day') || d.isBefore(earliest, 'day');

    const initial: FormValues = {
        submissionType: record.submissionType ?? 'APPLICABLE',
        doneDate: record.doneDate ? dayjs(record.doneDate.slice(0, 10)) : null,
        refNo: record.refNo ?? '',
        challanNo: record.challanNo ?? '',
        actualImprisonment: record.actualImprisonment,
        payableAmount: toNumber(record.payableAmount),
        amountPaid: toNumber(record.amountPaid),
        penaltyPaid: toNumber(record.penaltyPaid),
        remarks: record.remarks ?? '',
    };

    const goNext = async () => {
        if (!user) return;
        try {
            const next = await findNextOpen(user.id, record.id);
            if (next) onNavigate(next);
            else notify.info('There are no more open items for you');
        } catch (e) {
            notify.error(errorText(e));
        }
    };

    const saveDraft = async () => {
        setBusy('draft');
        try {
            await api(`/compliance/instances/${record.id}/draft`, {
                method: 'PUT',
                body: buildBody(form.getFieldsValue()),
            });
            notify.success('Draft saved');
            await refresh(record.id);
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const submit = async (andNext: boolean) => {
        let values: FormValues;
        try {
            values = await form.validateFields();
        } catch {
            return; // the form shows what is missing
        }
        setBusy(andNext ? 'next' : 'submit');
        try {
            await api(`/compliance/instances/${record.id}/submit`, {
                method: 'POST',
                body: buildBody(values),
            });
            notify.success('Submitted for review');
            await refresh(record.id);
            if (andNext) await goNext();
        } catch (e) {
            notify.error(errorText(e));
        } finally {
            setBusy(null);
        }
    };

    const skip = async () => {
        setBusy('skip');
        try {
            await goNext();
        } finally {
            setBusy(null);
        }
    };

    const working = busy !== null;
    const mandatory = record.compliance.attachment === 'MANDATORY';

    return (
        <Card size="small" title="Submit this compliance">
            {mandatory && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Proof is mandatory"
                    description="Attach at least one valid document in the Proof tab before you submit this as applicable."
                />
            )}
            <Form<FormValues> form={form} layout="vertical" initialValues={initial} requiredMark>
                <Form.Item
                    label="Submission type"
                    name="submissionType"
                    rules={[{ required: true, message: 'Choose a submission type' }]}
                >
                    <Radio.Group
                        optionType="button"
                        options={[
                            { label: 'Applicable', value: 'APPLICABLE' },
                            { label: 'Not applicable', value: 'NOT_APPLICABLE' },
                        ]}
                    />
                </Form.Item>

                <Form.Item
                    label="Done date"
                    name="doneDate"
                    extra="From the start of the period up to today."
                    rules={[{ required: true, message: 'Select the date the work was done' }]}
                >
                    <DatePicker disabledDate={disabledDate} style={{ width: 220 }} />
                </Form.Item>

                <Form.Item noStyle shouldUpdate={(p, c) => p.submissionType !== c.submissionType}>
                    {({ getFieldValue }) =>
                        getFieldValue('submissionType') === 'APPLICABLE' ? (
                            <>
                                <Space size="middle" wrap align="start">
                                    <Form.Item label="Reference no" name="refNo">
                                        <Input maxLength={50} style={{ width: 220 }} />
                                    </Form.Item>
                                    <Form.Item label="Challan no" name="challanNo">
                                        <Input maxLength={50} style={{ width: 220 }} />
                                    </Form.Item>
                                </Space>
                                <Space size="middle" wrap align="start">
                                    <Form.Item label="Payable amount" name="payableAmount">
                                        <InputNumber min={0} max={9999999999.99} precision={2} controls={false} style={{ width: 180 }} />
                                    </Form.Item>
                                    <Form.Item label="Amount paid" name="amountPaid">
                                        <InputNumber min={0} max={9999999999.99} precision={2} controls={false} style={{ width: 180 }} />
                                    </Form.Item>
                                    <Form.Item label="Penalty / interest paid" name="penaltyPaid">
                                        <InputNumber min={0} max={9999999999.99} precision={2} controls={false} style={{ width: 180 }} />
                                    </Form.Item>
                                </Space>
                                <Form.Item label="Actual imprisonment" name="actualImprisonment">
                                    <Select
                                        style={{ width: 120 }}
                                        options={[
                                            { value: false, label: 'No' },
                                            { value: true, label: 'Yes' },
                                        ]}
                                    />
                                </Form.Item>
                            </>
                        ) : null
                    }
                </Form.Item>

                <Form.Item
                    label="Remarks"
                    name="remarks"
                    rules={[
                        ({ getFieldValue }) => ({
                            validator: (_, value?: string) =>
                                getFieldValue('submissionType') === 'NOT_APPLICABLE' && !(value ?? '').trim()
                                    ? Promise.reject(new Error('Explain why this is not applicable'))
                                    : Promise.resolve(),
                        }),
                    ]}
                >
                    <Input.TextArea rows={3} maxLength={5000} showCount />
                </Form.Item>

                <Space wrap>
                    <Button onClick={() => void saveDraft()} loading={busy === 'draft'} disabled={working && busy !== 'draft'}>
                        Save draft
                    </Button>
                    <Button
                        type="primary"
                        onClick={() => void submit(false)}
                        loading={busy === 'submit'}
                        disabled={working && busy !== 'submit'}
                    >
                        Submit
                    </Button>
                    <Button onClick={() => void submit(true)} loading={busy === 'next'} disabled={working && busy !== 'next'}>
                        Submit &amp; next
                    </Button>
                    <Button type="link" onClick={() => void skip()} loading={busy === 'skip'} disabled={working && busy !== 'skip'}>
                        Skip &amp; next
                    </Button>
                </Space>
            </Form>
        </Card>
    );
}