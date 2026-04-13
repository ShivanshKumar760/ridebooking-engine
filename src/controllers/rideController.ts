// src/controllers/rideController.ts

import { Request, Response, NextFunction } from "express";
import { query, transaction } from "../config/database";
import {
  calculateDistance,
  calculateFare,
  nearbyDriversQuery,
} from "../utils/geo";
import { generateOTP } from "../utils/helpers";
import { AppError } from "../middleware/errorHandler";
import { getSocketServer } from "../socket/socketServer";
import logger from "../utils/logger";

export const bookRide = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const {
      pickupLocation,
      pickupAddress,
      dropoffLocation,
      dropoffAddress,
      vehicleType,
    } = req.body;

    // Get passenger record
    const passengerResult = await query(
      `SELECT id FROM passengers WHERE user_id = $1`,
      [userId]
    );
    if (passengerResult.rows.length === 0)
      throw new AppError("Passenger profile not found", 404);
    const passengerId = passengerResult.rows[0].id;

    // Check no active ride
    const activeRide = await query(
      `SELECT id FROM rides WHERE passenger_id = $1 AND status IN ('searching','driver_assigned','driver_arriving','ride_started')`,
      [passengerId]
    );
    if (activeRide.rows.length > 0) {
      throw new AppError("You already have an active ride", 409);
    }

    const distanceKm = calculateDistance(pickupLocation, dropoffLocation);
    const estimatedFare = calculateFare(distanceKm, vehicleType);
    const otp = generateOTP();

    const rideResult = await query(
      `INSERT INTO rides (
        passenger_id, pickup_latitude, pickup_longitude, pickup_address,
        dropoff_latitude, dropoff_longitude, dropoff_address,
        vehicle_type, estimated_fare, distance_km, otp, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'searching')
      RETURNING *`,
      [
        passengerId,
        pickupLocation.latitude,
        pickupLocation.longitude,
        pickupAddress,
        dropoffLocation.latitude,
        dropoffLocation.longitude,
        dropoffAddress,
        vehicleType,
        estimatedFare,
        distanceKm,
        otp,
      ]
    );

    const ride = rideResult.rows[0];

    // Find nearby drivers and notify them
    const { query: nearbyQ, params } = nearbyDriversQuery(
      pickupLocation.latitude,
      pickupLocation.longitude,
      8, // 8km radius
      vehicleType
    );
    const nearbyDrivers = await query(nearbyQ, params);

    // Get passenger info for notification
    const passengerInfo = await query(
      `SELECT u.name, u.phone, p.rating 
       FROM users u JOIN passengers p ON u.id = p.user_id 
       WHERE u.id = $1`,
      [userId]
    );
    const passenger = passengerInfo.rows[0];

    const io = getSocketServer();

    // Notify each nearby driver
    nearbyDrivers.rows.forEach((driver) => {
      io.to(`driver:${driver.user_id}`).emit("RIDE_REQUEST", {
        rideId: ride.id,
        passenger: {
          name: passenger.name,
          rating: passenger.rating,
          phone: passenger.phone,
        },
        pickup: {
          latitude: pickupLocation.latitude,
          longitude: pickupLocation.longitude,
          address: pickupAddress,
        },
        dropoff: {
          latitude: dropoffLocation.latitude,
          longitude: dropoffLocation.longitude,
          address: dropoffAddress,
        },
        estimatedFare,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        vehicleType,
      });
    });

    logger.info(
      `Ride ${ride.id} booked. Notified ${nearbyDrivers.rows.length} nearby drivers.`
    );

    // Auto-timeout: if no driver accepts in 2 minutes
    setTimeout(async () => {
      const checkRide = await query(`SELECT status FROM rides WHERE id = $1`, [
        ride.id,
      ]);
      if (checkRide.rows[0]?.status === "searching") {
        await query(
          `UPDATE rides SET status = 'cancelled', cancellation_reason = 'No driver found', cancelled_at = NOW() WHERE id = $1`,
          [ride.id]
        );
        io.to(`ride:${ride.id}`).emit("NO_DRIVERS_FOUND", { rideId: ride.id });
        logger.info(`Ride ${ride.id} auto-cancelled: no driver found`);
      }
    }, 120000);

    res.status(201).json({
      success: true,
      message: "Ride booked successfully",
      data: {
        rideId: ride.id,
        estimatedFare,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        nearbyDriversCount: nearbyDrivers.rows.length,
        status: "searching",
      },
    });
  } catch (error) {
    next(error);
  }
};

export const cancelRide = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId, role } = req.user!;
    const { rideId } = req.params;
    const { reason } = req.body;

    let profileId: string;
    let rideQuery: string;

    if (role === "passenger") {
      const r = await query(`SELECT id FROM passengers WHERE user_id = $1`, [
        userId,
      ]);
      if (r.rows.length === 0) throw new AppError("Passenger not found", 404);
      profileId = r.rows[0].id;
      rideQuery = `SELECT * FROM rides WHERE id = $1 AND passenger_id = $2 AND status IN ('searching','driver_assigned','driver_arriving')`;
    } else {
      const r = await query(`SELECT id FROM drivers WHERE user_id = $1`, [
        userId,
      ]);
      if (r.rows.length === 0) throw new AppError("Driver not found", 404);
      profileId = r.rows[0].id;
      rideQuery = `SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status IN ('driver_assigned','driver_arriving')`;
    }

    const rideResult = await query(rideQuery, [rideId, profileId]);
    if (rideResult.rows.length === 0)
      throw new AppError("Ride not found or cannot be cancelled", 404);

    await query(
      `UPDATE rides SET status = 'cancelled', cancellation_reason = $1, cancelled_at = NOW() WHERE id = $2`,
      [reason || "Cancelled by user", rideId]
    );

    // Free up driver if assigned
    if (rideResult.rows[0].driver_id) {
      await query(`UPDATE drivers SET is_available = true WHERE id = $1`, [
        rideResult.rows[0].driver_id,
      ]);
    }

    const io = getSocketServer();
    io.to(`ride:${rideId}`).emit("RIDE_CANCELLED", {
      rideId,
      reason: reason || "Cancelled by user",
      cancelled_by: role,
    });

    res.json({ success: true, message: "Ride cancelled successfully" });
  } catch (error) {
    next(error);
  }
};

export const getRideStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { rideId } = req.params;
    const { userId } = req.user!;

    const result = await query(
      `SELECT r.*,
        u_pass.name as passenger_name, u_pass.phone as passenger_phone,
        u_drv.name as driver_name, u_drv.phone as driver_phone,
        d.vehicle_number, d.vehicle_model, d.vehicle_type as driver_vehicle_type,
        d.rating as driver_rating, d.current_latitude as driver_lat, d.current_longitude as driver_lng
       FROM rides r
       JOIN passengers p ON r.passenger_id = p.id
       JOIN users u_pass ON p.user_id = u_pass.id
       LEFT JOIN drivers d ON r.driver_id = d.id
       LEFT JOIN users u_drv ON d.user_id = u_drv.id
       WHERE r.id = $1`,
      [rideId]
    );

    if (result.rows.length === 0) throw new AppError("Ride not found", 404);
    const ride = result.rows[0];

    // Verify access
    const passengerCheck = await query(
      `SELECT id FROM passengers WHERE user_id = $1`,
      [userId]
    );
    const driverCheck = await query(
      `SELECT id FROM drivers WHERE user_id = $1`,
      [userId]
    );

    const passengerMatch = passengerCheck.rows[0]?.id === ride.passenger_id;
    const driverMatch = driverCheck.rows[0]?.id === ride.driver_id;

    if (!passengerMatch && !driverMatch) {
      throw new AppError("Access denied", 403);
    }

    // Only show OTP to passenger (not in listing, only when driver is assigned)
    if (!passengerMatch) {
      delete ride.otp;
    }

    res.json({ success: true, data: ride });
  } catch (error) {
    next(error);
  }
};

export const getRideHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId, role } = req.user!;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let profileId: string;
    let filterColumn: string;

    if (role === "passenger") {
      const r = await query(`SELECT id FROM passengers WHERE user_id = $1`, [
        userId,
      ]);
      if (r.rows.length === 0) throw new AppError("Not found", 404);
      profileId = r.rows[0].id;
      filterColumn = "passenger_id";
    } else {
      const r = await query(`SELECT id FROM drivers WHERE user_id = $1`, [
        userId,
      ]);
      if (r.rows.length === 0) throw new AppError("Not found", 404);
      profileId = r.rows[0].id;
      filterColumn = "driver_id";
    }

    const params: unknown[] = [profileId];
    let whereClause = `WHERE r.${filterColumn} = $1`;

    if (status) {
      params.push(status);
      whereClause += ` AND r.status = $${params.length}`;
    }

    const ridesResult = await query(
      `SELECT r.id, r.status, r.vehicle_type, r.estimated_fare, r.final_fare,
              r.distance_km, r.duration_minutes, r.pickup_address, r.dropoff_address,
              r.payment_status, r.created_at, r.completed_at,
              u.name as other_party_name
       FROM rides r
       JOIN passengers p ON r.passenger_id = p.id
       JOIN users u ON p.user_id = u.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM rides r ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: {
        rides: ridesResult.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          pages: Math.ceil(
            parseInt(countResult.rows[0].count) / parseInt(limit as string)
          ),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const rateRide = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { rideId } = req.params;
    const { rating, comment } = req.body;

    const rideResult = await query(
      `SELECT r.*, p.user_id as passenger_user_id, d.user_id as driver_user_id
       FROM rides r
       JOIN passengers p ON r.passenger_id = p.id
       LEFT JOIN drivers d ON r.driver_id = d.id
       WHERE r.id = $1 AND r.status = 'completed'`,
      [rideId]
    );

    if (rideResult.rows.length === 0)
      throw new AppError("Ride not found or not completed", 404);
    const ride = rideResult.rows[0];

    const isPassenger = ride.passenger_user_id === userId;
    const isDriver = ride.driver_user_id === userId;

    if (!isPassenger && !isDriver) throw new AppError("Access denied", 403);

    const ratedUserId = isPassenger
      ? ride.driver_user_id
      : ride.passenger_user_id;

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO ratings (ride_id, rated_by, rated_user, rating, comment)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [rideId, userId, ratedUserId, rating, comment]
      );

      // Update average rating
      if (isPassenger && ride.driver_id) {
        await client.query(
          `UPDATE drivers SET rating = (
            SELECT AVG(r.rating)::DECIMAL(3,2) FROM ratings r
            JOIN users u ON r.rated_user = u.id
            JOIN drivers d ON u.id = d.user_id
            WHERE d.id = $1
          ) WHERE id = $1`,
          [ride.driver_id]
        );
      } else {
        await client.query(
          `UPDATE passengers SET rating = (
            SELECT AVG(r.rating)::DECIMAL(3,2) FROM ratings r
            WHERE r.rated_user = $1
          ) WHERE user_id = $1`,
          [ratedUserId]
        );
      }
    });

    res.json({ success: true, message: "Rating submitted successfully" });
  } catch (error) {
    next(error);
  }
};
