/**
 * Appointment and provider API calls.
 */

import { appointmentPath, cancelAppointmentPath, ENDPOINTS, reschedulePath } from './endpoints';
import { request } from './client';

const listProviders = (params) => request('get', ENDPOINTS.PROVIDERS, params);
const listSpecialties = () => request('get', ENDPOINTS.SPECIALTIES);

const listAppointments = (params) => request('get', ENDPOINTS.APPOINTMENTS, params);
const getAppointment = (id) => request('get', appointmentPath(id));
const createAppointment = (payload) => request('post', ENDPOINTS.APPOINTMENTS, payload);
const cancelAppointment = (id, payload) => request('patch', cancelAppointmentPath(id), payload);
const rescheduleAppointment = (id, payload) => request('patch', reschedulePath(id), payload);

const getAvailability = (params) => request('get', ENDPOINTS.AVAILABILITY, params);

export default {
  listProviders,
  listSpecialties,
  listAppointments,
  getAppointment,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getAvailability,
};
