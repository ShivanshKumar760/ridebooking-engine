// src/routes/paymentRoutes.ts

import { Router } from "express";
import { body, param } from "express-validator";
import {
  createPaymentOrder,
  verifyPayment,
  processMockPayment,
  stripeWebhookHandler,
  getPaymentStatus,
} from "../controllers/paymentController";
import { authenticate, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import express from "express";

const router = Router();

// POST /api/payments/rides/:rideId/order  — initiate payment
router.post(
  "/rides/:rideId/order",
  authenticate,
  requireRole("passenger"),
  validate([param("rideId").isUUID().withMessage("Valid ride ID required")]),
  createPaymentOrder
);

// POST /api/payments/rides/:rideId/verify  — verify real gateway payment
router.post(
  "/rides/:rideId/verify",
  authenticate,
  requireRole("passenger"),
  validate([
    param("rideId").isUUID().withMessage("Valid ride ID required"),
    body("gatewayOrderId").notEmpty().withMessage("Gateway order ID required"),
    body("gatewayPaymentId")
      .notEmpty()
      .withMessage("Gateway payment ID required"),
    body("gateway")
      .isIn(["razorpay", "stripe", "mock"])
      .withMessage("Valid gateway required"),
  ]),
  verifyPayment
);

// POST /api/payments/rides/:rideId/mock  — mock payment (fallback / testing)
router.post(
  "/rides/:rideId/mock",
  authenticate,
  requireRole("passenger"),
  validate([param("rideId").isUUID().withMessage("Valid ride ID required")]),
  processMockPayment
);

// GET /api/payments/rides/:rideId/status
router.get(
  "/rides/:rideId/status",
  authenticate,
  validate([param("rideId").isUUID().withMessage("Valid ride ID required")]),
  getPaymentStatus
);

// POST /api/payments/webhooks/stripe  — raw body needed for signature verification
router.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

export default router;
