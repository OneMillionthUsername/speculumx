export class AdminControllerException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'AdminControllerException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Login refused because the account is deactivated or temporarily locked
export class AdminAccountLockedException extends AdminControllerException {
  constructor(message = 'Admin account is inactive or locked') {
    super(message);
    this.name = 'AdminAccountLockedException';
  }
}

export class CardControllerException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CardControllerException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CommentControllerException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CommentControllerException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PostControllerException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'PostControllerException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class MediaControllerException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'MediaControllerException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class UtilsException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'UtilsException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class databaseError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'databaseError';
    if (originalError) {
      this.originalError = originalError;
    }
  }
}

export class CategoryControllerException extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CategoryControllerException';
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}