/**
 * Auth routes. Wiring only: rate limit, validate, authenticate, controller.
 */

import { Router } from 'express';

import { loginSchema, signupSchema } from '@shared/schemas.ts';

import authController from '../controllers/authController.ts';
import { authRateLimit } from '../middlewares/rateLimit.ts';
import { requireAuth } from '../middlewares/requireAuth.ts';
import { validate } from '../middlewares/validate.ts';

const router = Router();

router.post('/auth/signup', authRateLimit, validate({ body: signupSchema }), authController.signup);

router.post('/auth/login', authRateLimit, validate({ body: loginSchema }), authController.login);

// Rate limited too: the refresh cookie is the highest-value credential in the system, so
// brute-forcing it should not be cheap.
router.post('/auth/refresh', authRateLimit, authController.refresh);

router.post('/auth/logout', authController.logout);
router.post('/auth/logout-all', requireAuth, authController.logoutAll);

router.get('/auth/me', requireAuth, authController.me);

export default router;
