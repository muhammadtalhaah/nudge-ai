/**
 * Appointment and provider routes.
 *
 * Every route here requires authentication. Ownership scoping happens in the service, which
 * is where the record is actually loaded — middleware cannot check what it has not fetched.
 */

import { Router } from 'express';

import {
  appointmentListQuerySchema,
  availabilityQuerySchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  idParamSchema,
  providerListQuerySchema,
  rescheduleAppointmentSchema,
} from '@shared/schemas.ts';

import appointmentController from '../controllers/appointmentController.ts';
import providerController from '../controllers/providerController.ts';
import { requireAuth } from '../middlewares/requireAuth.ts';
import { validate } from '../middlewares/validate.ts';

const router = Router();

// Scoped to these prefixes rather than a bare router.use(requireAuth): an unscoped guard
// also intercepts paths that match no route at all, so /api/typo would answer 401 instead of
// falling through to the 404 handler.
router.use(['/appointments', '/providers'], requireAuth);

// ------------------------------------------------------------------- providers ----
router.get('/providers', validate({ query: providerListQuerySchema }), providerController.list);
router.get('/providers/specialties', providerController.specialties);

// ---------------------------------------------------------------- appointments ----
// Declared before '/appointments/:id' so 'availability' is not parsed as an id.
router.get(
  '/appointments/availability',
  validate({ query: availabilityQuerySchema }),
  appointmentController.availability,
);

router.post(
  '/appointments',
  validate({ body: createAppointmentSchema }),
  appointmentController.create,
);

router.get(
  '/appointments',
  validate({ query: appointmentListQuerySchema }),
  appointmentController.list,
);

router.get('/appointments/:id', validate({ params: idParamSchema }), appointmentController.getOne);

router.patch(
  '/appointments/:id/cancel',
  validate({ params: idParamSchema, body: cancelAppointmentSchema }),
  appointmentController.cancel,
);

router.patch(
  '/appointments/:id/reschedule',
  validate({ params: idParamSchema, body: rescheduleAppointmentSchema }),
  appointmentController.reschedule,
);

export default router;
