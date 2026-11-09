import { Router } from 'express';
import { getUser } from '../../middleware/auth';
import { dashboardQuerySchema, dimensionSchema } from './filters';
import * as dash from './dashboard.service';

// Everyone logged in can read the dashboard. What they see depends on their visibility.
export const dashboardRouter = Router();

dashboardRouter.get('/summary', async (req, res) => {
    res.json(await dash.summary(getUser(req), dashboardQuerySchema.parse(req.query)));
});

dashboardRouter.get('/charts', async (req, res) => {
    res.json(await dash.charts(getUser(req), dashboardQuerySchema.parse(req.query)));
});

dashboardRouter.get('/filters', async (req, res) => {
    res.json(await dash.facets(getUser(req), dimensionSchema.parse(req.query)));
});