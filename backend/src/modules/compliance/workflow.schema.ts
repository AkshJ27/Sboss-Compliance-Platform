import { z } from 'zod';
import { dateOnlyField } from '../../lib/validators';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);

export const idParamSchema = z.object({ id: uuid });

const money = z
    .number()
    .min(0)
    .max(9_999_999_999.99)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places');

const details = {
    refNo: text(50).optional(),
    challanNo: text(50).optional(),
    actualImprisonment: z.boolean().optional(),
    penaltyPaid: money.optional(),
    payableAmount: money.optional(),
    amountPaid: money.optional(),
    remarks: text(5000).optional(),
};

export const submitSchema = z
    .object({
        submissionType: z.enum(['APPLICABLE', 'NOT_APPLICABLE']),
        doneDate: dateOnlyField,
        ...details,
    })
    .strict();
export type SubmitInput = z.infer<typeof submitSchema>;

export const draftSchema = z
    .object({
        submissionType: z.enum(['APPLICABLE', 'NOT_APPLICABLE']).optional(),
        doneDate: dateOnlyField.optional(),
        ...details,
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to save');
export type DraftInput = z.infer<typeof draftSchema>;

export const approveSchema = z.object({ remarks: text(2000).optional() }).strict();

export const returnSchema = z
    .object({
        remarks: text(2000).min(3, 'Remarks are required when returning an item'),
    })
    .strict();

export const assigneesSchema = z
    .object({
        ownerId: uuid.optional(),
        managerId: uuid.optional(),
        approverId: uuid.nullable().optional(),
        remarks: text(500).optional(),
    })
    .strict()
    .refine(
        (v) => v.ownerId !== undefined || v.managerId !== undefined || v.approverId !== undefined,
        'Nothing to change',
    );
export type AssigneesInput = z.infer<typeof assigneesSchema>;

// Moving the due date of an item nobody has submitted yet. Files are uploaded first as
// separate documents and listed here, so they stay apart from the item's proof.
export const dueDateSchema = z
    .object({
        dueDate: dateOnlyField,
        remarks: text(500).min(3, 'Remarks are required when changing the due date'),
        documentIds: z.array(uuid).max(10).optional(),
    })
    .strict();
export type DueDateInput = z.infer<typeof dueDateSchema>;