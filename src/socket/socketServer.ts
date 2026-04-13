// src/socket/socketServer.ts

import { Server as HTTPServer } from "http";
import { Server, Socket } from "socket.io";
import { verifyAccessToken } from "../utils/helpers";
import { query } from "../config/database";
import logger from "../utils/logger";

let io: Server;

export const initSocketServer = (httpServer: HTTPServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: (process.env.ALLOWED_ORIGINS || "").split(","),
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(" ")[1];
      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = verifyAccessToken(token);
      (socket as Socket & { user: typeof decoded }).user = decoded;
      next();
    } catch {
      next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const user = (socket as Socket & { user: { userId: string; role: string } })
      .user;
    logger.info(
      `Socket connected: ${user.userId} (${user.role}) [${socket.id}]`
    );

    // Auto-join user's personal room
    socket.join(`user:${user.userId}`);

    // Drivers get their own notification room
    if (user.role === "driver") {
      socket.join(`driver:${user.userId}`);

      // Mark driver as connected
      await query(
        `UPDATE drivers SET last_location_update = NOW() WHERE user_id = $1`,
        [user.userId]
      );
    }

    // ─── Real-time location update from driver ──────────────────────
    socket.on(
      "UPDATE_LOCATION",
      async (data: {
        latitude: number;
        longitude: number;
        heading?: number;
        speed?: number;
      }) => {
        if (user.role !== "driver") return;

        try {
          const result = await query(
            `UPDATE drivers SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
           WHERE user_id = $3 RETURNING id`,
            [data.latitude, data.longitude, user.userId]
          );

          if (result.rows.length === 0) return;
          const driverId = result.rows[0].id;

          // Store history
          await query(
            `INSERT INTO driver_locations (driver_id, latitude, longitude, heading, speed)
           VALUES ($1, $2, $3, $4, $5)`,
            [
              driverId,
              data.latitude,
              data.longitude,
              data.heading ?? null,
              data.speed ?? null,
            ]
          );

          // Broadcast to active ride
          const activeRide = await query(
            `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('driver_assigned','driver_arriving','ride_started')`,
            [driverId]
          );

          if (activeRide.rows.length > 0) {
            io.to(`ride:${activeRide.rows[0].id}`).emit("DRIVER_LOCATION", {
              driverId,
              userId: user.userId,
              ...data,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          logger.error("Error updating location via socket", { error });
        }
      }
    );

    // ─── Join a ride room ────────────────────────────────────────────
    socket.on("JOIN_RIDE_ROOM", async ({ rideId }: { rideId: string }) => {
      try {
        // Verify access
        const rideCheck = await query(
          `SELECT r.id FROM rides r
           LEFT JOIN passengers p ON r.passenger_id = p.id AND p.user_id = $2
           LEFT JOIN drivers d ON r.driver_id = d.id AND d.user_id = $2
           WHERE r.id = $1 AND (p.id IS NOT NULL OR d.id IS NOT NULL)`,
          [rideId, user.userId]
        );

        if (rideCheck.rows.length > 0) {
          socket.join(`ride:${rideId}`);
          logger.debug(`User ${user.userId} joined ride room: ${rideId}`);
          socket.emit("JOINED_RIDE_ROOM", { rideId, success: true });
        } else {
          socket.emit("JOINED_RIDE_ROOM", {
            rideId,
            success: false,
            message: "Access denied",
          });
        }
      } catch (error) {
        logger.error("Error joining ride room", { error });
      }
    });

    // ─── Leave ride room ─────────────────────────────────────────────
    socket.on("LEAVE_RIDE_ROOM", ({ rideId }: { rideId: string }) => {
      socket.leave(`ride:${rideId}`);
      logger.debug(`User ${user.userId} left ride room: ${rideId}`);
    });

    // ─── Driver: accept ride via socket ──────────────────────────────
    socket.on("ACCEPT_RIDE", async ({ rideId }: { rideId: string }) => {
      if (user.role !== "driver") return;

      try {
        const driverResult = await query(
          `SELECT d.*, u.name, u.phone FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.user_id = $1`,
          [user.userId]
        );
        if (driverResult.rows.length === 0) return;
        const driver = driverResult.rows[0];

        const rideResult = await query(
          `UPDATE rides SET driver_id = $1, status = 'driver_assigned', updated_at = NOW()
           WHERE id = $2 AND status = 'searching' RETURNING *`,
          [driver.id, rideId]
        );

        if (rideResult.rows.length === 0) {
          socket.emit("RIDE_ACCEPT_ERROR", { message: "Ride already taken" });
          return;
        }

        const ride = rideResult.rows[0];
        await query(`UPDATE drivers SET is_available = false WHERE id = $1`, [
          driver.id,
        ]);

        const { calculateDistance, estimateETA } = await import("../utils/geo");
        const dist = calculateDistance(
          {
            latitude: driver.current_latitude,
            longitude: driver.current_longitude,
          },
          { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude }
        );

        io.to(`ride:${rideId}`).emit("DRIVER_ASSIGNED", {
          driver: {
            driverId: driver.id,
            name: driver.name,
            phone: driver.phone,
            vehicleType: driver.vehicle_type,
            vehicleNumber: driver.vehicle_number,
            vehicleModel: driver.vehicle_model,
            rating: driver.rating,
            latitude: driver.current_latitude,
            longitude: driver.current_longitude,
          },
          otp: ride.otp,
          eta_minutes: estimateETA(dist),
          rideId,
        });

        socket.join(`ride:${rideId}`);
        logger.info(`Driver ${driver.id} accepted ride ${rideId} via socket`);
      } catch (error) {
        logger.error("Socket ACCEPT_RIDE error", { error });
      }
    });

    // ─── Disconnect ──────────────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      logger.info(`Socket disconnected: ${user.userId} — ${reason}`);
    });
  });

  logger.info("✅ Socket.IO server initialized");
  return io;
};

export const getSocketServer = (): Server => {
  if (!io) throw new Error("Socket.IO server not initialized");
  return io;
};
