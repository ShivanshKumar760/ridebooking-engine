// src/services/paymentService.ts

import { query, transaction } from "../config/database";
import { PaymentOrder, PaymentVerification } from "../types";
import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import crypto from "crypto";

// ─── Gateway factory ────────────────────────────────────────────────

const getGateway = (): "razorpay" | "stripe" | "mock" => {
  const gw = process.env.PAYMENT_GATEWAY || "mock";
  if (["razorpay", "stripe", "mock"].includes(gw)) {
    return gw as "razorpay" | "stripe" | "mock";
  }
  return "mock";
};

// ─── Razorpay ────────────────────────────────────────────────────────

const createRazorpayOrder = async (
  rideId: string,
  amount: number
): Promise<PaymentOrder> => {
  try {
    // Dynamic import so missing credentials don't crash the server
    const Razorpay = (await import("razorpay")).default;
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID as string,
      key_secret: process.env.RAZORPAY_KEY_SECRET as string,
    });

    const order = await instance.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: `ride_${rideId}`,
      notes: { rideId },
    });

    return {
      orderId: rideId,
      amount,
      currency: "INR",
      gateway: "razorpay",
      gatewayOrderId: order.id,
    };
  } catch (error) {
    logger.error("Razorpay order creation failed, falling back to mock", {
      error,
    });
    return createMockOrder(rideId, amount);
  }
};

const verifyRazorpayPayment = (verification: PaymentVerification): boolean => {
  const { gatewayOrderId, gatewayPaymentId, gatewaySignature } = verification;
  if (!gatewaySignature) return false;

  const body = `${gatewayOrderId}|${gatewayPaymentId}`;
  const expectedSig = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET as string)
    .update(body)
    .digest("hex");

  return expectedSig === gatewaySignature;
};

// ─── Stripe ──────────────────────────────────────────────────────────

const createStripePaymentIntent = async (
  rideId: string,
  amount: number
): Promise<PaymentOrder> => {
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: "2024-04-10",
    });

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // paise / cents
      currency: "inr",
      metadata: { rideId },
      automatic_payment_methods: { enabled: true },
    });

    return {
      orderId: rideId,
      amount,
      currency: "INR",
      gateway: "stripe",
      gatewayOrderId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
    };
  } catch (error) {
    logger.error(
      "Stripe payment intent creation failed, falling back to mock",
      { error }
    );
    return createMockOrder(rideId, amount);
  }
};

// ─── Mock Gateway (fallback) ──────────────────────────────────────────

const createMockOrder = (rideId: string, amount: number): PaymentOrder => {
  return {
    orderId: rideId,
    amount,
    currency: "INR",
    gateway: "mock",
    gatewayOrderId: `mock_order_${rideId}_${Date.now()}`,
  };
};

// ─── Public API ───────────────────────────────────────────────────────

export const initiatePayment = async (
  rideId: string
): Promise<PaymentOrder> => {
  const rideResult = await query(
    `SELECT r.*, p.user_id as passenger_user_id
     FROM rides r JOIN passengers p ON r.passenger_id = p.id
     WHERE r.id = $1 AND r.status = 'completed'`,
    [rideId]
  );

  if (rideResult.rows.length === 0) {
    throw new AppError("Ride not found or not yet completed", 404);
  }

  const ride = rideResult.rows[0];
  if (ride.payment_status === "completed") {
    throw new AppError("Payment already completed", 409);
  }

  const amount = ride.final_fare || ride.estimated_fare;
  const gateway = getGateway();

  let order: PaymentOrder;
  if (gateway === "razorpay") {
    order = await createRazorpayOrder(rideId, amount);
  } else if (gateway === "stripe") {
    order = await createStripePaymentIntent(rideId, amount);
  } else {
    order = createMockOrder(rideId, amount);
  }

  // Store the pending transaction
  await query(
    `INSERT INTO payment_transactions (ride_id, gateway, gateway_order_id, amount, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT DO NOTHING`,
    [rideId, order.gateway, order.gatewayOrderId, amount, order.currency]
  );

  await query(`UPDATE rides SET payment_status = 'processing' WHERE id = $1`, [
    rideId,
  ]);

  return order;
};

export const confirmPayment = async (
  rideId: string,
  verification: PaymentVerification,
  gateway: "razorpay" | "stripe" | "mock"
): Promise<{ success: boolean; transactionId: string }> => {
  return transaction(async (client) => {
    // Verify signature for real gateways
    if (gateway === "razorpay") {
      const valid = verifyRazorpayPayment(verification);
      if (!valid)
        throw new AppError("Payment signature verification failed", 400);
    }
    // Stripe: webhook handles real verification; here we trust the client for now
    // Mock: always succeeds

    const transactionResult = await client.query(
      `UPDATE payment_transactions
       SET gateway_payment_id = $1, gateway_signature = $2, status = 'completed', updated_at = NOW()
       WHERE ride_id = $3 AND gateway = $4
       RETURNING id`,
      [
        verification.gatewayPaymentId,
        verification.gatewaySignature || null,
        rideId,
        gateway,
      ]
    );

    if (transactionResult.rows.length === 0) {
      throw new AppError("Transaction record not found", 404);
    }

    await client.query(
      `UPDATE rides 
       SET payment_status = 'completed', payment_id = $1, payment_gateway = $2, 
           payment_method = $3, updated_at = NOW()
       WHERE id = $4`,
      [verification.gatewayPaymentId, gateway, gateway, rideId]
    );

    logger.info(`Payment confirmed for ride ${rideId} via ${gateway}`);

    return {
      success: true,
      transactionId: transactionResult.rows[0].id,
    };
  });
};

export const mockCompletePayment = async (
  rideId: string
): Promise<{ success: boolean; transactionId: string }> => {
  const mockPaymentId = `mock_pay_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}`;

  return confirmPayment(
    rideId,
    {
      rideId,
      gatewayOrderId: `mock_order_${rideId}`,
      gatewayPaymentId: mockPaymentId,
    },
    "mock"
  );
};

export const handleStripeWebhook = async (
  payload: Buffer,
  signature: string
): Promise<void> => {
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: "2024-04-10",
    });

    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as unknown as {
        id: string;
        metadata: { rideId: string };
      };
      const rideId = intent.metadata?.rideId;

      if (rideId) {
        await confirmPayment(
          rideId,
          {
            rideId,
            gatewayOrderId: intent.id,
            gatewayPaymentId: intent.id,
          },
          "stripe"
        );
      }
    }
  } catch (error) {
    logger.error("Stripe webhook processing failed", { error });
    throw error;
  }
};
