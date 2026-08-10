class CustomError extends Error {
  constructor(statusCode, errorData) {
    super();
    this.name = "CustomError";
    this.statusCode = statusCode || 500; // Default status code
    this.errorData = errorData;
  }
}

module.exports = { CustomError };
