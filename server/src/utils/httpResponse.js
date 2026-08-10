/**
 * The response envelope.
 *
 * Every endpoint answers in one of exactly two shapes, so the client needs one success
 * path and one error path rather than per-endpoint special cases.
 *
 *   success: { success: true,  data, meta? }
 *   failure: { success: false, error: { code, message, details? }, requestId }
 */

/**
 * @typedef {object} PaginationMeta
 * @property {number} page
 * @property {number} limit
 * @property {number} total
 * @property {number} totalPages
 * @property {boolean} hasNextPage
 */

export const sendData = (res, data, statusCode = 200) => {
  res.status(statusCode).json({ success: true, data });
};

export const sendList = (res, items, meta, statusCode = 200) => {
  res.status(statusCode).json({ success: true, data: items, meta });
};

export const sendError = (res, statusCode, code, message, details) => {
  res.status(statusCode).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId: res.locals.requestId ?? null,
  });
};

/**
 * Build pagination metadata from a total count. `hasNextPage` is computed here rather than
 * by the client, so desktop page controls and mobile infinite scroll agree by definition.
 *
 * @returns {PaginationMeta}
 */
export const buildPaginationMeta = (page, limit, total) => {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNextPage: page < totalPages };
};
