// src/middleware/auth.ts

import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/helpers";
import { JwtPayload } from "../types";
import logger from "../utils/logger";

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ success: false, message: "Access token required" });
      return;
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);
    req.user = decoded as JwtPayload;
    next();
  } catch (error) {
    logger.warn("Authentication failed", { error });
    res
      .status(401)
      .json({ success: false, message: "Invalid or expired token" });
  }
};

export const requireRole = (...roles: ("passenger" | "driver")[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(" or ")}`,
      });
      return;
    }
    next();
  };
};
