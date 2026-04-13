// src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // PostgreSQL errors
  const pgError = err as { code?: string; detail?: string };
  if (pgError.code === "23505") {
    res.status(409).json({
      success: false,
      message: "Resource already exists",
      detail: pgError.detail,
    });
    return;
  }

  if (pgError.code === "23503") {
    res.status(400).json({
      success: false,
      message: "Referenced resource not found",
    });
    return;
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    res.status(401).json({ success: false, message: "Invalid token" });
    return;
  }

  if (err.name === "TokenExpiredError") {
    res.status(401).json({ success: false, message: "Token expired" });
    return;
  }

  logger.error("Unhandled error", { error: err, stack: err.stack });

  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
};

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ success: false, message: "Route not found" });
};
