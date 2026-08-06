/**
 * Request validation against the shared Zod schemas.
 *
 * The parsed (and coerced) result replaces `req.body` / `req.query` / `req.params`, so
 * controllers downstream receive typed, normalised data and never re-check it. Anything
 * not described by the schema is dropped rather than passed through — a request cannot
 * smuggle an extra field into a service.
 */

import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

import { ValidationError, type FieldIssue } from '../errors/AppError.ts';

interface ValidationTargets {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Flatten Zod issues into the `details` array the client maps onto form fields. */
const toFieldIssues = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): FieldIssue[] =>
  issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '_root',
    message: issue.message,
  }));

export const validate = (targets: ValidationTargets) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const problems: FieldIssue[] = [];

    if (targets.body) {
      const result = targets.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        problems.push(...toFieldIssues(result.error.issues));
      }
    }

    if (targets.query) {
      const result = targets.query.safeParse(req.query);
      if (result.success) {
        // Express 5 exposes req.query via a getter, so it is redefined rather than assigned.
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        problems.push(...toFieldIssues(result.error.issues));
      }
    }

    if (targets.params) {
      const result = targets.params.safeParse(req.params);
      if (result.success) {
        Object.defineProperty(req, 'params', {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        problems.push(...toFieldIssues(result.error.issues));
      }
    }

    if (problems.length > 0) {
      next(new ValidationError('The request contains invalid data', problems));
      return;
    }

    next();
  };
};
