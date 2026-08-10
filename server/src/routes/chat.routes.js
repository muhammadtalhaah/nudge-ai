/**
 * Chat routes.
 *
 * Sending a message is rate limited per user rather than per IP, because each one may cost a
 * model call. Reads are covered by the global limiter only.
 */

import { Router } from 'express';

import { createSessionSchema, idParamSchema, sendMessageSchema } from '../../../shared/schemas.js';

import chatController from '../controllers/chatController.js';
import { chatRateLimit } from '../middlewares/rateLimit.js';
import { requireAuth } from '../middlewares/requireAuth.js';
import { validate } from '../middlewares/validate.js';

const router = Router();

// Path-scoped so an unmatched /api path still reaches the 404 handler. See the note in
// appointment.routes.js.
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
