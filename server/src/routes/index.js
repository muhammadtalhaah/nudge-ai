/**
 * API route table. Routes only wire middleware to controllers — no logic lives here.
 */

import { Router } from 'express';

import appointmentRoutes from './appointment.routes.js';
import authRoutes from './auth.routes.js';
import chatRoutes from './chat.routes.js';
import healthRoutes from './health.routes.js';

const router = Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(appointmentRoutes);
router.use(chatRoutes);

export default router;
