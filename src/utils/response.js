/**
 * Standardized API response helpers
 */
const success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const created = (res, data = null, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

const paginated = (res, data, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination,
  });
};

const error = (res, message = 'Error', statusCode = 500, details = null) => {
  const response = {
    success: false,
    message,
  };
  if (details) response.details = details;
  return res.status(statusCode).json(response);
};

module.exports = { success, created, paginated, error };
