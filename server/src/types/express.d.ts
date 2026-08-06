/**
 * Express request augmentation.
 *
 * `req.auth` is populated by requireAuth from a verified access token. It is the only
 * source of caller identity in the application: ids are never read from the body, the
 * query string, or anything else the client controls.
 */

import type { UserRole } from '@shared/constants.ts';

declare global {
  namespace Express {
    interface AuthContext {
      userId: string;
      businessId: string;
      role: UserRole;
      email: string;
    }

    interface Request {
      auth?: AuthContext;
    }

    interface Locals {
      requestId?: string;
    }
  }
}

export {};
