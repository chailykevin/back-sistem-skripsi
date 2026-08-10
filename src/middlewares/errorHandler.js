const { CustomError } = require("../errors/customError");

module.exports = (err, req, res, next) => {
  console.error(err);

  if (err instanceof CustomError) {
    return res.status(err.statusCode).json(err.errorData);
  }

  const status = err.statusCode || 500;

  res.status(status).json({
    ok: false,
    message: err.message || "Internal server error",
  });
};
