/**
 * The response envelope.
 *
 * Every endpoint answers in one of exactly two shapes, so the client needs one success
 * path and one error path rather than per-endpoint special cases.
 *
 *   success: { success: true,  data, meta? }
 *   failure: { success: false, error: { code, message, details? }, requestId }
 */

import type { Response } from 'express';

import type { ErrorCode } from '@shared/constants.ts';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export const sendData = <T>(res: Response, data: T, statusCode = 200): void => {
  res.status(statusCode).json({ success: true, data });
};

export const sendList = <T>(
  res: Response,
  items: T[],
  meta: PaginationMeta,
  statusCode = 200,
): void => {
  res.status(statusCode).json({ success: true, data: items, meta });
};

export const sendError = (
  res: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: Array<{ path: string; message: string }>,
): void => {
  res.status(statusCode).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId: res.locals.requestId ?? null,
  });
};

/**
 * Build pagination metadata from a total count. `hasNextPage` is computed here rather than
 * by the client, so desktop page controls and mobile infinite scroll agree by definition.
 */
export const buildPaginationMeta = (page: number, limit: number, total: number): PaginationMeta => {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNextPage: page < totalPages };
};
