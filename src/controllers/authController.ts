// src/controllers/authController.ts

import { Request, Response, NextFunction } from "express";
import { query } from "../config/database";
import {
  hashPassword,
  comparePassword,
  generateTokens,
  verifyRefreshToken,
  sanitizeUser,
} from "../utils/helpers";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";

export const registerPassenger = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, phone, name, password } = req.body;
    const passwordHash = await hashPassword(password);

    const userResult = await query(
      `INSERT INTO users (email, phone, name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'passenger')
       RETURNING *`,
      [email.toLowerCase(), phone, name, passwordHash]
    );

    const user = userResult.rows[0];

    await query(`INSERT INTO passengers (user_id) VALUES ($1)`, [user.id]);

    const tokens = generateTokens({ userId: user.id, role: "passenger" });
    await query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      tokens.refreshToken,
      user.id,
    ]);

    logger.info(`New passenger registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: "Passenger registered successfully",
      data: { user: sanitizeUser(user), ...tokens },
    });
  } catch (error) {
    next(error);
  }
};

export const registerDriver = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      email,
      phone,
      name,
      password,
      vehicleType,
      vehicleNumber,
      vehicleModel,
      licenseNumber,
    } = req.body;

    const passwordHash = await hashPassword(password);

    const userResult = await query(
      `INSERT INTO users (email, phone, name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'driver')
       RETURNING *`,
      [email.toLowerCase(), phone, name, passwordHash]
    );

    const user = userResult.rows[0];

    await query(
      `INSERT INTO drivers (user_id, vehicle_type, vehicle_number, vehicle_model, license_number)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        vehicleType,
        vehicleNumber.toUpperCase(),
        vehicleModel,
        licenseNumber,
      ]
    );

    const tokens = generateTokens({ userId: user.id, role: "driver" });
    await query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      tokens.refreshToken,
      user.id,
    ]);

    logger.info(`New driver registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: "Driver registered successfully",
      data: { user: sanitizeUser(user), ...tokens },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    const result = await query(
      `SELECT u.*, 
        CASE WHEN u.role = 'driver' THEN d.id ELSE p.id END as profile_id,
        CASE WHEN u.role = 'driver' THEN d.is_available ELSE NULL END as is_available,
        CASE WHEN u.role = 'driver' THEN d.vehicle_type ELSE NULL END as vehicle_type
       FROM users u
       LEFT JOIN drivers d ON u.id = d.user_id AND u.role = 'driver'
       LEFT JOIN passengers p ON u.id = p.user_id AND u.role = 'passenger'
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new AppError("Invalid credentials", 401);
    }

    const user = result.rows[0];
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError("Invalid credentials", 401);
    }

    const tokens = generateTokens({ userId: user.id, role: user.role });
    await query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      tokens.refreshToken,
      user.id,
    ]);

    logger.info(`User logged in: ${user.email}`);

    res.json({
      success: true,
      message: "Login successful",
      data: { user: sanitizeUser(user), ...tokens },
    });
  } catch (error) {
    next(error);
  }
};

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) throw new AppError("Refresh token required", 400);

    const decoded = verifyRefreshToken(token);
    const result = await query(
      `SELECT * FROM users WHERE id = $1 AND refresh_token = $2 AND is_active = true`,
      [decoded.userId, token]
    );

    if (result.rows.length === 0) {
      throw new AppError("Invalid refresh token", 401);
    }

    const tokens = generateTokens({
      userId: decoded.userId,
      role: decoded.role,
    });
    await query(`UPDATE users SET refresh_token = $1 WHERE id = $2`, [
      tokens.refreshToken,
      decoded.userId,
    ]);

    res.json({ success: true, data: tokens });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await query(`UPDATE users SET refresh_token = NULL WHERE id = $1`, [
      req.user!.userId,
    ]);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId, role } = req.user!;

    let result;
    if (role === "driver") {
      result = await query(
        `SELECT u.id, u.email, u.phone, u.name, u.role, u.is_active,
                d.id as driver_id, d.vehicle_type, d.vehicle_number, d.vehicle_model,
                d.license_number, d.rating, d.total_rides, d.is_available,
                d.current_latitude, d.current_longitude
         FROM users u JOIN drivers d ON u.id = d.user_id
         WHERE u.id = $1`,
        [userId]
      );
    } else {
      result = await query(
        `SELECT u.id, u.email, u.phone, u.name, u.role, u.is_active,
                p.id as passenger_id, p.rating, p.total_rides
         FROM users u JOIN passengers p ON u.id = p.user_id
         WHERE u.id = $1`,
        [userId]
      );
    }

    if (result.rows.length === 0) throw new AppError("User not found", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};
