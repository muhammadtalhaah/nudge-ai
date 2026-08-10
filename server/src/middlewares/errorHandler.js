/**
 * The single place an error becomes an HTTP response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically, so route
 * handlers need no try/catch and no asyncHandler wrapper.
 */

import { ERROR_CODES } from '../../../shared/constants.js';

import { env } from '../config/env.js';
import { isAppError } from '../errors/AppError.js';
import { translatePgError } from '../errors/pgErrors.js';
import { logger } from '../logger/index.js';
import { sendError } from '../utils/httpResponse.js';

export const notFoundHandler = (req, res) => {
  sendError(res, 404, ERROR_CODES.NOT_FOUND, `No route matches ${req.method} ${req.originalUrl}`);
};

/**
 * Express identifies an error handler by its arity, so all four parameters must stay
 * declared even though `next` is only used for the headers-sent case.
 */
export const errorHandler = (error, req, res, next) => {
  // Headers already sent means the response is mid-flight; Express's default handler is
  // the only thing that can deal with that correctly.
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = res.locals.requestId;

  // A database constraint doing its job is an expected outcome, not a crash — translate
  // it before deciding this is a 500.
  const appError = isAppError(error) ? error : translatePgError(error);

  if (appError) {
    // 4xx is client behaviour and belongs at warn/info; only 5xx is our problem.
    const level = appError.statusCode >= 500 ? 'error' : 'warn';
    logger[level](
      {
        requestId,
        code: appError.code,
        statusCode: appError.statusCode,
        method: req.method,
        path: req.originalUrl,
        ...(appError.statusCode >= 500 ? { err: appError } : {}),
      },
      appError.message,
    );

    sendError(res, appError.statusCode, appError.code, appError.message, appError.details);
    return;
  }

  // Anything reaching here is unexpected. Log it in full, tell the client nothing beyond
  // the request id — stack traces and SQL fragments are not the client's business.
  logger.error(
    { err: error, requestId, method: req.method, path: req.originalUrl },
    'unhandled error',
  );

  sendError(
    res,
    500,
    ERROR_CODES.INTERNAL_ERROR,
    env.isProduction
      ? 'Something went wrong on our end. Please try again.'
      : `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
  );
};
