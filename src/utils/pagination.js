/**
 * Parse pagination query params
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Build pagination meta for response
 */
const buildPaginationMeta = (total, page, limit) => {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  };
};

module.exports = { parsePagination, buildPaginationMeta };
