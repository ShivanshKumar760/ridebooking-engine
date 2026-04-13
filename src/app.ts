// src/app.ts

import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/authRoutes";
import rideRoutes from "./routes/rideRoutes";
import driverRoutes from "./routes/driverRoutes";
import paymentRoutes from "./routes/paymentRoutes";

import { errorHandler, notFound } from "./middleware/errorHandler";
import logger from "./utils/logger";

const app: Application = express();

// ─── Security ────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === "production",
    crossOriginEmbedderPolicy: process.env.NODE_ENV === "production",
  })
);

// ─── CORS ─────────────────────────────────────────────────────────────
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || "http://localhost:3000"
).split(",");
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Rate Limiting ────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: "Too many auth attempts" },
});

app.use(globalLimiter);

// ─── Body Parsing ─────────────────────────────────────────────────────
// NOTE: Stripe webhook needs raw body — mounted BEFORE json middleware in paymentRoutes
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhooks/stripe") {
    next();
  } else {
    express.json({ limit: "10mb" })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── Compression & Logging ────────────────────────────────────────────
app.use(compression());
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === "/health",
  })
);

// ─── Health Check ─────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ─── API Routes ───────────────────────────────────────────────────────
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/rides", rideRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/payments", paymentRoutes);

// ─── API Info ─────────────────────────────────────────────────────────
app.get("/api", (_req, res) => {
  res.json({
    name: "Uber Backend API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      rides: "/api/rides",
      drivers: "/api/drivers",
      payments: "/api/payments",
    },
    documentation: "See README.md for full API documentation",
  });
});

// ─── Error Handling ───────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
