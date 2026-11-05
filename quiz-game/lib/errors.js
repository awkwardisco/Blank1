'use strict';

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const httpError = (status, message, extra) => new HttpError(status, message, extra);

module.exports = { HttpError, httpError };
