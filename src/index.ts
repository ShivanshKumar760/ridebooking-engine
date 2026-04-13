// src/index.ts

import "dotenv/config";
import http from "http";
import app from "./app";
import { testConnection } from "./config/database";
import { initSocketServer } from "./socket/socketServer";
import logger from "./utils/logger";
import fs from "fs";

// ─── Ensure logs dir exists ───────────────────────────────────────────
if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs", { recursive: true });
}

const PORT = parseInt(process.env.PORT || "3000", 10);

const bootstrap = async (): Promise<void> => {
  // Verify DB connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error("Failed to connect to database. Exiting.");
    process.exit(1);
  }

  // Create HTTP server
  const httpServer = http.createServer(app);

  // Initialize Socket.IO
  initSocketServer(httpServer);

  // Start listening
  httpServer.listen(PORT, () => {
    logger.info(
      `🚀 Server running on port ${PORT} [${
        process.env.NODE_ENV || "development"
      }]`
    );
    logger.info(`📡 REST API: http://localhost:${PORT}/api`);
    logger.info(`🔌 WebSocket: ws://localhost:${PORT}`);
    logger.info(`❤️  Health: http://localhost:${PORT}/health`);
  });

  // ─── Graceful shutdown ────────────────────────────────────────────
  const shutdown = (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    httpServer.close(() => {
      logger.info("HTTP server closed.");
      process.exit(0);
    });

    // Force exit if not done in 10s
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled Promise Rejection:", reason);
  });

  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught Exception:", error);
    process.exit(1);
  });
};

bootstrap();
