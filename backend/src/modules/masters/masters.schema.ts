import { z } from 'zod';
import { INDIAN_STATES } from '../../lib/india';
import { nameField } from '../../lib/validators';

const nonEmpty = (v: object) => Object.keys(v).length > 0;
const uuid = z.string().uuid();

export const idParamSchema = z.object({ id: uuid });

const boolQuery = z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true');

export const listQuerySchema = z.object({ includeInactive: boolQuery });

// Verticals, departments and location types all share this shape
export const simpleCreateSchema = z.object({ name: nameField }).strict();
export const simpleUpdateSchema = z
    .object({ name: nameField.optional(), isActive: z.boolean().optional() })
    .strict()
    .refine(nonEmpty, 'Nothing to update');

// Entities
const codeField = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Use 2 to 10 letters or digits');

export const entityCreateSchema = z.object({ name: nameField, code: codeField }).strict();
export const entityUpdateSchema = z
    .object({
        name: nameField.optional(),
        code: codeField.optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, 'Nothing to update');

// Locations
const stateField = z.enum(INDIAN_STATES);
const cityField = z.string().trim().min(1).max(120);
const addressField = z.string().trim().min(1).max(500);

export const locationCreateSchema = z
    .object({
        entityId: uuid,
        locationTypeId: uuid.optional(),
        name: nameField,
        state: stateField,
        city: cityField.optional(),
        address: addressField.optional(),
    })
    .strict();

export const locationUpdateSchema = z
    .object({
        name: nameField.optional(),
        locationTypeId: uuid.nullable().optional(),
        state: stateField.optional(),
        city: cityField.nullable().optional(),
        address: addressField.nullable().optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, 'Nothing to update');

export const locationListQuerySchema = z.object({
    entityId: uuid.optional(),
    locationTypeId: uuid.optional(),
    state: stateField.optional(),
    search: z.string().trim().max(100).optional(),
    includeInactive: boolQuery,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Financial years
const dateOnly = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((s) => {
        const d = new Date(`${s}T00:00:00.000Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, 'Invalid date');

const labelField = z.string().trim().min(4).max(20);

export const fyCreateSchema = z
    .object({
        label: labelField,
        startDate: dateOnly,
        endDate: dateOnly,
        isCurrent: z.boolean().default(false),
    })
    .strict()
    .refine((v) => v.endDate > v.startDate, {
        message: 'End date must be after start date',
        path: ['endDate'],
    });

export const fyUpdateSchema = z
    .object({
        label: labelField.optional(),
        startDate: dateOnly.optional(),
        endDate: dateOnly.optional(),
        isCurrent: z.boolean().optional(),
    })
    .strict()
    .refine(nonEmpty, 'Nothing to update');