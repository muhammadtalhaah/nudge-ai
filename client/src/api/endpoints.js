/**
 * API paths in one place, so a route rename is a single edit.
 */

export const ENDPOINTS = {
  AUTH: {
    SIGNUP: '/auth/signup',
    LOGIN: '/auth/login',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
  },
  PROVIDERS: '/providers',
  SPECIALTIES: '/providers/specialties',
  APPOINTMENTS: '/appointments',
  AVAILABILITY: '/appointments/availability',
  CHAT_SESSIONS: '/chat/sessions',
};

export const appointmentPath = (id) => `${ENDPOINTS.APPOINTMENTS}/${id}`;
export const cancelAppointmentPath = (id) => `${ENDPOINTS.APPOINTMENTS}/${id}/cancel`;
export const reschedulePath = (id) => `${ENDPOINTS.APPOINTMENTS}/${id}/reschedule`;
export const sessionMessagesPath = (id) => `${ENDPOINTS.CHAT_SESSIONS}/${id}/messages`;
