import { Router } from 'express';
import { getUser, requireRole } from '../../middleware/auth';
import * as s from './compliance.schema';
import * as schedules from './schedules.service';
import * as instances from './instances.service';
import { instanceListSchema } from './filters';
import { listInstances } from './instances.query';
import { dashboardRouter } from './dashboard.routes';
import { workflowRouter } from './workflow.routes';

export const complianceRouter = Router();

const admin = requireRole('ORG_ADMIN');

// Schedules (admin only)
complianceRouter.post('/schedules/activate', admin, async (req, res) => {
    const { dryRun } = s.dryRunQuerySchema.parse(req.query);
    const input = s.activateSchema.parse(req.body);
    const result = await schedules.activate(getUser(req), input, dryRun);
    res.status(dryRun ? 200 : 201).json(result);
});

complianceRouter.get('/schedules', admin, async (req, res) => {
    const query = s.scheduleListQuerySchema.parse(req.query);
    res.json(await schedules.listSchedules(getUser(req).orgId, query));
});

complianceRouter.patch('/schedules/:id', admin, async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    const input = s.scheduleUpdateSchema.parse(req.body);
    res.json(await schedules.updateSchedule(getUser(req), id, input));
});

// Dashboard
complianceRouter.use('/dashboard', dashboardRouter);

// Instances
complianceRouter.post('/instances/generate', admin, async (req, res) => {
    const { dryRun } = s.dryRunQuerySchema.parse(req.query);
    const input = s.generateSchema.parse(req.body);
    const result = await instances.generate(getUser(req), input, dryRun);
    res.status(dryRun ? 200 : 201).json(result);
});

complianceRouter.get('/instances', async (req, res) => {
    res.json(await listInstances(getUser(req), instanceListSchema.parse(req.query)));
});

complianceRouter.get('/instances/:id', async (req, res) => {
    const { id } = s.idParamSchema.parse(req.params);
    res.json(await instances.getInstance(getUser(req), id));
});

complianceRouter.use('/instances', workflowRouter);