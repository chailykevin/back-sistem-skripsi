const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Pagination is opt-in while clients migrate. Requests without page/limit keep
 * receiving the full list; requests with either parameter are paginated.
 */
function parsePagination(query = {}) {
  const enabled = query.page !== undefined || query.limit !== undefined;
  const page = toPositiveInteger(query.page, 1);
  const requestedLimit = toPositiveInteger(query.limit, DEFAULT_LIMIT);
  const limit = Math.min(requestedLimit, MAX_LIMIT);

  return {
    enabled,
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

function buildPagination({ page, limit, totalItems }) {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

function listResponse(res, { rows, pagination }) {
  if (!pagination.enabled) return res.json({ ok: true, data: rows });
  return res.json({
    ok: true,
    data: rows,
    pagination: buildPagination({
      page: pagination.page,
      limit: pagination.limit,
      totalItems: pagination.totalItems,
    }),
  });
}

module.exports = { parsePagination, buildPagination, listResponse };
