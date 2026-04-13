// src/routes/authRoutes.ts

import { Router } from "express";
import { body } from "express-validator";
import {
  registerPassenger,
  registerDriver,
  login,
  refreshToken,
  logout,
  getProfile,
} from "../controllers/authController";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

const passwordRules = body("password")
  .isLength({ min: 8 })
  .withMessage("Password must be at least 8 characters")
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .withMessage("Password must contain uppercase, lowercase, and a number");

const commonRegistrationRules = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("phone")
    .matches(/^\+?[1-9]\d{9,14}$/)
    .withMessage("Valid phone number required"),
  body("name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be 2-100 characters"),
  passwordRules,
];

// POST /api/auth/register/passenger
router.post(
  "/register/passenger",
  validate(commonRegistrationRules),
  registerPassenger
);

// POST /api/auth/register/driver
router.post(
  "/register/driver",
  validate([
    ...commonRegistrationRules,
    body("vehicleType")
      .isIn(["bike", "auto", "cab", "premium"])
      .withMessage("Vehicle type must be bike, auto, cab, or premium"),
    body("vehicleNumber")
      .trim()
      .isLength({ min: 4, max: 20 })
      .withMessage("Vehicle number required"),
    body("vehicleModel")
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Vehicle model required"),
    body("licenseNumber")
      .trim()
      .isLength({ min: 5, max: 50 })
      .withMessage("License number required"),
  ]),
  registerDriver
);

// POST /api/auth/login
router.post(
  "/login",
  validate([
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password required"),
  ]),
  login
);

// POST /api/auth/refresh
router.post(
  "/refresh",
  validate([
    body("refreshToken").notEmpty().withMessage("Refresh token required"),
  ]),
  refreshToken
);

// POST /api/auth/logout
router.post("/logout", authenticate, logout);

// GET /api/auth/me
router.get("/me", authenticate, getProfile);

export default router;
