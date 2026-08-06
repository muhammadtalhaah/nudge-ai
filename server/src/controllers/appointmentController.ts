/**
 * Appointment controllers.
 *
 * Note what is absent: no ownership checks, no status rules, no SQL. Those belong to the
 * service. The controller's whole job is to turn a validated request into a service call and
 * a service result into a response.
 */

import type { Request, Response } from 'express';

import type {
  AppointmentListQuery,
  AvailabilityQuery,
  CancelAppointmentInput,
  CreateAppointmentInput,
  RescheduleAppointmentInput,
} from '@shared/schemas.ts';

import appointmentService, { type Caller } from '../services/appointmentService.ts';
import { buildPaginationMeta, sendData, sendList } from '../utils/httpResponse.ts';

/**
 * Identity comes exclusively from the verified token. If this read ever moved to req.body,
 * any user could act as any other — so it lives in one helper, used everywhere.
 */
const callerFrom = (req: Request): Caller => ({
  userId: req.auth!.userId,
  businessId: req.auth!.businessId,
  role: req.auth!.role,
});

/**
 * Express 5 types route params as `string | string[]`. Every route reading this has already
 * passed `validate({ params: idParamSchema })`, so the value is a verified UUID string.
 */
const idParam = (req: Request): string => (req.params as unknown as { id: string }).id;

export const create = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as CreateAppointmentInput;

  const appointment = await appointmentService.book(callerFrom(req), {
    providerId: input.providerId,
    startsAt: new Date(input.startsAt),
    notes: input.notes ?? null,
    // A client claiming source 'chat' is harmless (it is analytics metadata), but default
    // to 'form' so only the chat service can attribute a booking to itself.
    source: 'form',
    chatSessionId: input.chatSessionId ?? null,
  });

  sendData(res, { appointment }, 201);
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const queryParams = req.query as unknown as AppointmentListQuery;

  const { items, total } = await appointmentService.list(callerFrom(req), {
    status: queryParams.status,
    scope: queryParams.scope,
    page: queryParams.page,
    limit: queryParams.limit,
  });

  sendList(res, items, buildPaginationMeta(queryParams.page, queryParams.limit, total));
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const appointment = await appointmentService.getById(callerFrom(req), idParam(req));
  sendData(res, { appointment });
};

export const cancel = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as CancelAppointmentInput;
  const appointment = await appointmentService.cancel(
    callerFrom(req),
    idParam(req),
    input?.reason ?? null,
  );
  sendData(res, { appointment });
};

export const reschedule = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RescheduleAppointmentInput;
  const appointment = await appointmentService.reschedule(
    callerFrom(req),
    idParam(req),
    new Date(input.startsAt),
  );
  sendData(res, { appointment });
};

export const availability = async (req: Request, res: Response): Promise<void> => {
  const queryParams = req.query as unknown as AvailabilityQuery;
  const result = await appointmentService.getAvailability(
    callerFrom(req),
    queryParams.providerId,
    queryParams.date,
  );
  sendData(res, result);
};

export default { create, list, getOne, cancel, reschedule, availability };
