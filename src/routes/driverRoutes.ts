// src/routes/driverRoutes.ts

import { Router } from "express";
import { body, param, query } from "express-validator";
import {
  updateLocation,
  toggleAvailability,
  getNearbyDrivers,
  getDriverRides,
  acceptRide,
  startRide,
  completeRide,
} from "../controllers/driverController";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

// PUT /api/drivers/location  — driver updates their GPS position
router.put(
  "/location",
  authenticate,
  requireRole("driver"),
  validate([
    body("latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Valid latitude required"),
    body("longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Valid longitude required"),
    body("heading").optional().isFloat({ min: 0, max: 360 }),
    body("speed").optional().isFloat({ min: 0 }),
  ]),
  updateLocation
);

// PUT /api/drivers/availability
router.put(
  "/availability",
  authenticate,
  requireRole("driver"),
  validate([
    body("isAvailable").isBoolean().withMessage("isAvailable must be boolean"),
  ]),
  toggleAvailability
);

// GET /api/drivers/nearby  — passengers see nearby drivers
router.get(
  "/nearby",
  authenticate,
  requireRole("passenger"),
  validate([
    query("latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Valid latitude required"),
    query("longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Valid longitude required"),
    query("vehicleType").optional().isIn(["bike", "auto", "cab", "premium"]),
    query("radius").optional().isFloat({ min: 0.5, max: 50 }),
  ]),
  getNearbyDrivers
);

// GET /api/drivers/rides  — driver's ride history
router.get(
  "/rides",
  authenticate,
  requireRole("driver"),
  validate([
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("status")
      .optional()
      .isIn([
        "searching",
        "driver_assigned",
        "driver_arriving",
        "ride_started",
        "completed",
        "cancelled",
      ]),
  ]),
  getDriverRides
);

// POST /api/drivers/rides/:rideId/accept
router.post(
  "/rides/:rideId/accept",
  authenticate,
  requireRole("driver"),
  validate([param("rideId").isUUID().withMessage("Valid ride ID required")]),
  acceptRide
);

// POST /api/drivers/rides/:rideId/start  — verify OTP and start
router.post(
  "/rides/:rideId/start",
  authenticate,
  requireRole("driver"),
  validate([
    param("rideId").isUUID().withMessage("Valid ride ID required"),
    body("otp")
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage("Valid 6-digit OTP required"),
  ]),
  startRide
);

// POST /api/drivers/rides/:rideId/complete
router.post(
  "/rides/:rideId/complete",
  authenticate,
  requireRole("driver"),
  validate([param("rideId").isUUID().withMessage("Valid ride ID required")]),
  completeRide
);

export default router;
