/**
 * API route table. Routes only wire middleware to controllers — no logic lives here.
 */

import { Router } from 'express';

import appointmentRoutes from './appointment.routes.ts';
import authRoutes from './auth.routes.ts';
import chatRoutes from './chat.routes.ts';
import healthRoutes from './health.routes.ts';

const router = Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(appointmentRoutes);
router.use(chatRoutes);

export default router;
