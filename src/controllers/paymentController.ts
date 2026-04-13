// src/controllers/paymentController.ts

import { Request, Response, NextFunction } from "express";
import { query } from "../config/database";
import {
  initiatePayment,
  confirmPayment,
  mockCompletePayment,
  handleStripeWebhook,
} from "../services/paymentService";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";

export const createPaymentOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { rideId } = req.params;

    // Ensure passenger owns this ride
    const rideCheck = await query(
      `SELECT r.id FROM rides r
       JOIN passengers p ON r.passenger_id = p.id
       WHERE r.id = $1 AND p.user_id = $2`,
      [rideId, userId]
    );
    if (rideCheck.rows.length === 0) throw new AppError("Ride not found", 404);

    const order = await initiatePayment(rideId);

    res.json({
      success: true,
      message: "Payment order created",
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

export const verifyPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { rideId } = req.params;
    const { gatewayOrderId, gatewayPaymentId, gatewaySignature, gateway } =
      req.body;

    const result = await confirmPayment(
      rideId,
      { rideId, gatewayOrderId, gatewayPaymentId, gatewaySignature },
      gateway
    );

    res.json({
      success: true,
      message: "Payment verified successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const processMockPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { rideId } = req.params;
    const result = await mockCompletePayment(rideId);

    logger.info(`Mock payment processed for ride ${rideId}`);

    res.json({
      success: true,
      message: "Mock payment completed successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const stripeWebhookHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sig = req.headers["stripe-signature"];
    if (!sig) throw new AppError("Missing stripe signature", 400);

    await handleStripeWebhook(req.body as Buffer, sig as string);
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};

export const getPaymentStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { rideId } = req.params;
    const { userId } = req.user!;

    const result = await query(
      `SELECT pt.*, r.final_fare, r.payment_status
       FROM payment_transactions pt
       JOIN rides r ON pt.ride_id = r.id
       JOIN passengers p ON r.passenger_id = p.id
       WHERE pt.ride_id = $1 AND p.user_id = $2
       ORDER BY pt.created_at DESC LIMIT 1`,
      [rideId, userId]
    );

    if (result.rows.length === 0) throw new AppError("Payment not found", 404);

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};
