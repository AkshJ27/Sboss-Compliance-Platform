import { Router } from 'express';
import { INDIAN_STATES } from '../../lib/india';
import { getUser, requireRole } from '../../middleware/auth';
import { verticalLimit } from '../../lib/vertical-limit';
import * as s from './masters.schema';
import * as simple from './simple-masters.service';
import * as entities from './entities.service';
import * as locations from './locations.service';
import * as fy from './financial-years.service';

export const mastersRouter = Router();

const admin = requireRole('ORG_ADMIN');

mastersRouter.get('/states', (_req, res) => {
    res.json(INDIAN_STATES);
});

// Entities
mastersRouter.get('/entities', async (req, res) => {
    const { includeInactive } = s.listQuerySchema.parse(req.query);
    res.json(await entities.list(getUser(req).orgId, includeInactive));
});

mastersRouter.post('/entities', admin, async (req, res) => {
    const input = s.entityCreateSchema.parse(req.body);
    res.status(201).json(await entities.create(getUser(req), input));
});

mastersRouter.patch('/entities/:id', admin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const input = s.entityUpdateSchema.parse(req.body);
    res.json(await entities.update(getUser(req), id, input));
});

// Verticals, departments and location types
const SIMPLE = [
    { path: 'verticals', kind: 'vertical' },
    { path: 'departments', kind: 'department' },
    { path: 'location-types', kind: 'locationType' },
] as const;

for (const { path, kind } of SIMPLE) {
    mastersRouter.get(`/${path}`, async (req, res) => {
        const { includeInactive } = s.listQuerySchema.parse(req.query);
        const me = getUser(req);
        res.json(await simple.list(me.orgId, kind, includeInactive, verticalLimit(me)));
    });

    mastersRouter.post(`/${path}`, admin, async (req, res) => {
        const input = s.simpleCreateSchema.parse(req.body);
        res.status(201).json(await simple.create(getUser(req), kind, input));
    });

    mastersRouter.patch(`/${path}/:id`, admin, async (req, res) => {
        const { id } = s.idParamSchema.parse(req.params);
        const input = s.simpleUpdateSchema.parse(req.body);
        res.json(await simple.update(getUser(req), kind, id, input));
    });
}

// Locations
mastersRouter.get('/locations', async (req, res) => {
    const query = s.locationListQuerySchema.parse(req.query);
    const me = getUser(req);
    res.json(await locations.list(me.orgId, query, verticalLimit(me)));
});

mastersRouter.post('/locations', admin, async (req, res) => {
    const input = s.locationCreateSchema.parse(req.body);
    res.status(201).json(await locations.create(getUser(req), input));
});

mastersRouter.patch('/locations/:id', admin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const input = s.locationUpdateSchema.parse(req.body);
    res.json(await locations.update(getUser(req), id, input));
});

// Financial years
mastersRouter.get('/financial-years', async (req, res) => {
    res.json(await fy.list(getUser(req).orgId));
});

mastersRouter.post('/financial-years', admin, async (req, res) => {
    const input = s.fyCreateSchema.parse(req.body);
    res.status(201).json(await fy.create(getUser(req), input));
});

mastersRouter.patch('/financial-years/:id', admin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const input = s.fyUpdateSchema.parse(req.body);
    res.json(await fy.update(getUser(req), id, input));
});