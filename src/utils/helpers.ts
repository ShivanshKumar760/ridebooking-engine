// src/utils/helpers.ts

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JwtPayload, AuthTokens } from "../types";

const SALT_ROUNDS = 12;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const generateTokens = (
  payload: Omit<JwtPayload, "iat" | "exp">
): AuthTokens => {
  const accessToken = jwt.sign(
    payload,
    process.env.JWT_SECRET as string,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    } as jwt.SignOptions
  );

  const refreshToken = jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET as string,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    } as jwt.SignOptions
  );

  return { accessToken, refreshToken };
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(
    token,
    process.env.JWT_REFRESH_SECRET as string
  ) as JwtPayload;
};

export const sanitizeUser = (user: Record<string, unknown>) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, refresh_token, ...safe } = user;
  return safe;
};

export const paginationDefaults = (
  page?: string | number,
  limit?: string | number
): { offset: number; limit: number; page: number } => {
  const p = Math.max(1, parseInt(String(page || 1)));
  const l = Math.min(100, Math.max(1, parseInt(String(limit || 10))));
  return { offset: (p - 1) * l, limit: l, page: p };
};
