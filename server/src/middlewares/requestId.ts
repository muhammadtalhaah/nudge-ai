/**
 * Assigns every request a correlation id, echoes it in a response header, and exposes it
 * on `res.locals` so the error envelope can quote it.
 *
 * When a user reports "it failed", the id in their error message is what locates the exact
 * log line.
 */

import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

/** Only accept an inbound id that looks safe to log and echo. */
const isSaneId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[\w.-]+$/.test(value);

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const inbound = req.headers[HEADER];
  const id = isSaneId(inbound) ? inbound : randomUUID();

  res.locals.requestId = id;
  res.setHeader(HEADER, id);
  next();
};
