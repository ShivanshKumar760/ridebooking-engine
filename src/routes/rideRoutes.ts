// src/routes/rideRoutes.ts

import { Router } from "express";
import { body, param, query } from "express-validator";
import {
  bookRide,
  cancelRide,
  getRideStatus,
  getRideHistory,
  rateRide,
} from "../controllers/rideController";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

const geoPointRules = (prefix: string) => [
  body(`${prefix}.latitude`)
    .isFloat({ min: -90, max: 90 })
    .withMessage(`${prefix} latitude must be between -90 and 90`),
  body(`${prefix}.longitude`)
    .isFloat({ min: -180, max: 180 })
    .withMessage(`${prefix} longitude must be between -180 and 180`),
];

// POST /api/rides/book
router.post(
  "/book",
  authenticate,
  requireRole("passenger"),
  validate([
    ...geoPointRules("pickupLocation"),
    ...geoPointRules("dropoffLocation"),
    body("pickupAddress")
      .trim()
      .isLength({ min: 5 })
      .withMessage("Pickup address required"),
    body("dropoffAddress")
      .trim()
      .isLength({ min: 5 })
      .withMessage("Dropoff address required"),
    body("vehicleType")
      .isIn(["bike", "auto", "cab", "premium"])
      .withMessage("Valid vehicle type required"),
  ]),
  bookRide
);

// GET /api/rides/history
router.get(
  "/history",
  authenticate,
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
  getRideHistory
);

// GET /api/rides/:rideId
router.get(
  "/:rideId",
  authenticate,
  validate([param("rideId").isUUID().withMessage("Valid ride ID required")]),
  getRideStatus
);

// POST /api/rides/:rideId/cancel
router.post(
  "/:rideId/cancel",
  authenticate,
  validate([
    param("rideId").isUUID().withMessage("Valid ride ID required"),
    body("reason").optional().trim().isLength({ max: 500 }),
  ]),
  cancelRide
);

// POST /api/rides/:rideId/rate
router.post(
  "/:rideId/rate",
  authenticate,
  validate([
    param("rideId").isUUID().withMessage("Valid ride ID required"),
    body("rating")
      .isInt({ min: 1, max: 5 })
      .withMessage("Rating must be between 1 and 5"),
    body("comment").optional().trim().isLength({ max: 500 }),
  ]),
  rateRide
);

export default router;
