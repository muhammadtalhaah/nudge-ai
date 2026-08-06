/**
 * Auth API calls. Transport only — no state, no side effects beyond the request.
 */

import { ENDPOINTS } from './endpoints';
import { request } from './client';

const signup = (payload) => request('post', ENDPOINTS.AUTH.SIGNUP, payload);
const login = (payload) => request('post', ENDPOINTS.AUTH.LOGIN, payload);
const logout = () => request('post', ENDPOINTS.AUTH.LOGOUT);
const me = () => request('get', ENDPOINTS.AUTH.ME);

export default { signup, login, logout, me };
