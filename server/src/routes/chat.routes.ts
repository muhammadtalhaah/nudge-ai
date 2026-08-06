/**
 * Chat routes.
 *
 * Sending a message is rate limited per user rather than per IP, because each one may cost a
 * model call. Reads are covered by the global limiter only.
 */

import { Router } from 'express';

import { createSessionSchema, idParamSchema, sendMessageSchema } from '@shared/schemas.ts';

import chatController from '../controllers/chatController.ts';
import { chatRateLimit } from '../middlewares/rateLimit.ts';
import { requireAuth } from '../middlewares/requireAuth.ts';
import { validate } from '../middlewares/validate.ts';

const router = Router();

// Path-scoped so an unmatched /api path still reaches the 404 handler. See the note in
// appointment.routes.ts.
router.use('/chat', requireAuth);

router.post(
  '/chat/sessions',
  validate({ body: createSessionSchema }),
  chatController.createSession,
);

router.get('/chat/sessions', chatController.listSessions);

router.get(
  '/chat/sessions/:id/messages',
  validate({ params: idParamSchema }),
  chatController.listMessages,
);

router.post(
  '/chat/sessions/:id/messages',
  chatRateLimit,
  validate({ params: idParamSchema, body: sendMessageSchema }),
  chatController.sendMessage,
);

export default router;
