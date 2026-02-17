/**
 * Standardized API response helpers.
 *
 * Usage:
 *   import { sendSuccess, sendError, sendPaginated } from "../utils/responseHelpers.js";
 *
 *   // Success with data
 *   sendSuccess(res, data);
 *   sendSuccess(res, data, "Creado correctamente", 201);
 *
 *   // Error
 *   sendError(res, "No encontrado", 404);
 *   sendError(res, e);  // extracts message from Error object
 *
 *   // Paginated list
 *   sendPaginated(res, items, { total: 523, page: 1, pageSize: 50 });
 */

/**
 * Send a successful response.
 * @param {import('express').Response} res
 * @param {any} data - Payload (object, array, or primitive)
 * @param {string|null} [message] - Optional human-readable message
 * @param {number} [status=200]
 */
export function sendSuccess(res, data, message = null, status = 200) {
  const body = { success: true, data };
  if (message) body.message = message;
  return res.status(status).json(body);
}

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {string|Error} error - Error message or Error instance
 * @param {number} [status=500]
 */
export function sendError(res, error, status = 500) {
  const message = error instanceof Error ? error.message : error;
  return res.status(status).json({ success: false, error: message });
}

/**
 * Send a paginated list response.
 * @param {import('express').Response} res
 * @param {any[]} items
 * @param {{ total: number, page: number, pageSize: number }} meta
 */
export function sendPaginated(res, items, { total, page, pageSize }) {
  return res.json({
    success: true,
    data: items,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}
