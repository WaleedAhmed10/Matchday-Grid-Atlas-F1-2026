/**
 * Standardized API response formatting
 * Ensures consistent response structure across all endpoints
 */

/**
 * Success response wrapper
 */
function successResponse(data, message = 'Success', statusCode = 200) {
  return {
    statusCode,
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  };
}

/**
 * Paginated response wrapper
 */
function paginatedResponse(data, page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  return {
    statusCode: 200,
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Send success response
 */
function sendSuccess(res, data, message = 'Success', statusCode = 200) {
  res.status(statusCode).json(successResponse(data, message, statusCode));
}

/**
 * Send paginated response
 */
function sendPaginated(res, data, page, limit, total) {
  res.status(200).json(paginatedResponse(data, page, limit, total));
}

/**
 * Error response wrapper
 */
function errorResponse(error, statusCode = 500, details = null) {
  return {
    statusCode,
    success: false,
    error,
    ...(details && { details }),
    timestamp: new Date().toISOString()
  };
}

/**
 * Send error response
 */
function sendError(res, error, statusCode = 500, details = null) {
  res.status(statusCode).json(errorResponse(error, statusCode, details));
}

/**
 * Response formatter middleware
 */
function responseFormatter(req, res, next) {
  // Store original json method
  const originalJson = res.json;

  // Override json method to format responses
  res.json = function (data) {
    // If already formatted, just use it
    if (data && data.success !== undefined) {
      return originalJson.call(this, data);
    }

    // Error responses (4xx/5xx) must keep their `{ error }` body as-is. Wrapping
    // them as a "success" payload hid every real error message from the client
    // (it showed the generic "API request failed" instead).
    if (this.statusCode >= 400) {
      return originalJson.call(this, data);
    }

    // Format as success response
    const formatted = successResponse(data);
    res.status(res.statusCode || 200);
    return originalJson.call(this, formatted);
  };

  next();
}

/**
 * Parse pagination parameters
 */
function parsePagination(query, defaultLimit = 10, maxLimit = 100) {
  let page = parseInt(query.page) || 1;
  let limit = parseInt(query.limit) || defaultLimit;

  // Validate pagination
  page = Math.max(1, page);
  limit = Math.min(Math.max(1, limit), maxLimit);

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Build filter object from query
 */
function buildFilter(query, allowedFields) {
  const filter = {};

  allowedFields.forEach((field) => {
    if (query[field] !== undefined && query[field] !== '') {
      filter[field] = query[field];
    }
  });

  return filter;
}

/**
 * Build sort object from query
 */
function buildSort(query, allowedFields = [], defaultSort = '-createdAt') {
  if (!query.sort || !allowedFields.includes(query.sort)) {
    const field = defaultSort.startsWith('-') ? defaultSort.substring(1) : defaultSort;
    const order = defaultSort.startsWith('-') ? -1 : 1;
    return { [field]: order };
  }

  const field = query.sort.startsWith('-') ? query.sort.substring(1) : query.sort;
  const order = query.sort.startsWith('-') ? -1 : 1;
  return { [field]: order };
}

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
  sendSuccess,
  sendError,
  sendPaginated,
  responseFormatter,
  parsePagination,
  buildFilter,
  buildSort
};
