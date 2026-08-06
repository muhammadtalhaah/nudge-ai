/**
 * Query key factory.
 *
 * Keys are built here rather than inlined at call sites so that invalidation is reliable: a
 * mutation invalidates `queryKeys.appointments.all` and every appointment list, filtered or
 * not, refetches. Hand-written array literals drift, and the symptom is a stale screen after
 * a successful action — which reads as a bug in the action.
 */

export const queryKeys = {
  auth: {
    me: ['auth', 'me'],
  },
  providers: {
    all: ['providers'],
    list: (filters = {}) => ['providers', 'list', filters],
    specialties: ['providers', 'specialties'],
  },
  appointments: {
    all: ['appointments'],
    list: (filters = {}) => ['appointments', 'list', filters],
    detail: (id) => ['appointments', 'detail', id],
    availability: (providerId, date) => ['appointments', 'availability', providerId, date],
  },
  chat: {
    all: ['chat'],
    sessions: ['chat', 'sessions'],
    messages: (sessionId) => ['chat', 'messages', sessionId],
  },
};

export default queryKeys;
