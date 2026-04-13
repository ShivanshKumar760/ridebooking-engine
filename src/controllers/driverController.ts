// src/controllers/driverController.ts

import { Request, Response, NextFunction } from "express";
import { query } from "../config/database";
import { nearbyDriversQuery } from "../utils/geo";
import { AppError } from "../middleware/errorHandler";
import { getSocketServer } from "../socket/socketServer";
import logger from "../utils/logger";

export const updateLocation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { latitude, longitude, heading, speed } = req.body;

    // Update driver's current location
    const result = await query(
      `UPDATE drivers 
       SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
       WHERE user_id = $3
       RETURNING id`,
      [latitude, longitude, userId]
    );

    if (result.rows.length === 0) throw new AppError("Driver not found", 404);

    const driverId = result.rows[0].id;

    // Store in location history
    await query(
      `INSERT INTO driver_locations (driver_id, latitude, longitude, heading, speed)
       VALUES ($1, $2, $3, $4, $5)`,
      [driverId, latitude, longitude, heading || null, speed || null]
    );

    // Broadcast to any active ride rooms
    const activeRide = await query(
      `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('driver_assigned','driver_arriving','ride_started')`,
      [driverId]
    );

    if (activeRide.rows.length > 0) {
      const io = getSocketServer();
      io.to(`ride:${activeRide.rows[0].id}`).emit("DRIVER_LOCATION", {
        driverId,
        latitude,
        longitude,
        heading,
        speed,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: "Location updated" });
  } catch (error) {
    next(error);
  }
};

export const toggleAvailability = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { isAvailable } = req.body;

    const result = await query(
      `UPDATE drivers SET is_available = $1 WHERE user_id = $2 RETURNING is_available`,
      [isAvailable, userId]
    );

    if (result.rows.length === 0) throw new AppError("Driver not found", 404);

    res.json({
      success: true,
      message: `Driver is now ${isAvailable ? "available" : "unavailable"}`,
      data: { isAvailable: result.rows[0].is_available },
    });
  } catch (error) {
    next(error);
  }
};

export const getNearbyDrivers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { latitude, longitude, vehicleType, radius = 5 } = req.query;

    if (!latitude || !longitude) {
      throw new AppError("latitude and longitude are required", 400);
    }

    const lat = parseFloat(latitude as string);
    const lon = parseFloat(longitude as string);
    const radiusKm = parseFloat(radius as string);

    const { query: nearbyQuery, params } = nearbyDriversQuery(
      lat,
      lon,
      radiusKm,
      vehicleType as string | undefined
    );

    const result = await query(nearbyQuery, params);

    res.json({
      success: true,
      data: {
        drivers: result.rows,
        count: result.rows.length,
        searchRadius: radiusKm,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getDriverRides = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    const driverResult = await query(
      `SELECT id FROM drivers WHERE user_id = $1`,
      [userId]
    );
    if (driverResult.rows.length === 0)
      throw new AppError("Driver not found", 404);
    const driverId = driverResult.rows[0].id;

    let baseQuery = `
      SELECT r.*, 
        u.name as passenger_name, u.phone as passenger_phone,
        p.rating as passenger_rating
      FROM rides r
      JOIN passengers pa ON r.passenger_id = pa.id
      JOIN users u ON pa.user_id = u.id
      JOIN passengers p ON r.passenger_id = p.id
      WHERE r.driver_id = $1
    `;
    const params: unknown[] = [driverId];

    if (status) {
      params.push(status);
      baseQuery += ` AND r.status = $${params.length}`;
    }

    baseQuery += ` ORDER BY r.created_at DESC LIMIT $${
      params.length + 1
    } OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const rides = await query(baseQuery, params);
    const countResult = await query(
      `SELECT COUNT(*) FROM rides WHERE driver_id = $1${
        status ? " AND status = $2" : ""
      }`,
      status ? [driverId, status] : [driverId]
    );

    res.json({
      success: true,
      data: {
        rides: rides.rows,
        pagination: {
          total: parseInt(countResult.rows[0].count),
          page: parseInt(page as string),
          limit: parseInt(limit as string),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const acceptRide = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { rideId } = req.params;

    // Get driver info
    const driverResult = await query(
      `SELECT d.*, u.name, u.phone FROM drivers d JOIN users u ON d.user_id = u.id WHERE d.user_id = $1`,
      [userId]
    );
    if (driverResult.rows.length === 0)
      throw new AppError("Driver not found", 404);
    const driver = driverResult.rows[0];

    if (!driver.is_available)
      throw new AppError("Driver is not available", 400);

    // Update ride
    const rideResult = await query(
      `UPDATE rides 
       SET driver_id = $1, status = 'driver_assigned', updated_at = NOW()
       WHERE id = $2 AND status = 'searching'
       RETURNING *`,
      [driver.id, rideId]
    );

    if (rideResult.rows.length === 0) {
      throw new AppError("Ride not found or already assigned", 404);
    }

    const ride = rideResult.rows[0];

    // Mark driver unavailable
    await query(`UPDATE drivers SET is_available = false WHERE id = $1`, [
      driver.id,
    ]);

    // Notify passenger via socket
    const io = getSocketServer();

    // Calculate ETA
    const distanceToPickup = require("../utils/geo").calculateDistance(
      {
        latitude: driver.current_latitude,
        longitude: driver.current_longitude,
      },
      { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude }
    );
    const eta = require("../utils/geo").estimateETA(distanceToPickup);

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
      eta_minutes: eta,
      rideId,
    });

    logger.info(`Driver ${driver.id} accepted ride ${rideId}`);

    res.json({
      success: true,
      message: "Ride accepted successfully",
      data: { ride, eta_minutes: eta },
    });
  } catch (error) {
    next(error);
  }
};

export const startRide = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { rideId } = req.params;
    const { otp } = req.body;

    const driverResult = await query(
      `SELECT id FROM drivers WHERE user_id = $1`,
      [userId]
    );
    if (driverResult.rows.length === 0)
      throw new AppError("Driver not found", 404);

    const rideResult = await query(
      `SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'driver_assigned'`,
      [rideId, driverResult.rows[0].id]
    );

    if (rideResult.rows.length === 0) throw new AppError("Ride not found", 404);
    const ride = rideResult.rows[0];

    if (ride.otp !== otp) throw new AppError("Invalid OTP", 400);

    await query(
      `UPDATE rides SET status = 'ride_started', otp_verified = true, started_at = NOW() WHERE id = $1`,
      [rideId]
    );

    const io = getSocketServer();
    io.to(`ride:${rideId}`).emit("RIDE_STARTED", {
      rideId,
      started_at: new Date().toISOString(),
    });

    res.json({ success: true, message: "Ride started successfully" });
  } catch (error) {
    next(error);
  }
};

export const completeRide = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.user!;
    const { rideId } = req.params;

    const driverResult = await query(
      `SELECT id FROM drivers WHERE user_id = $1`,
      [userId]
    );
    if (driverResult.rows.length === 0)
      throw new AppError("Driver not found", 404);

    const rideResult = await query(
      `SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'ride_started'`,
      [rideId, driverResult.rows[0].id]
    );

    if (rideResult.rows.length === 0) throw new AppError("Ride not found", 404);
    const ride = rideResult.rows[0];

    // Calculate actual distance and fare
    const { calculateDistance, calculateFare } = require("../utils/geo");
    const distanceKm = calculateDistance(
      { latitude: ride.pickup_latitude, longitude: ride.pickup_longitude },
      { latitude: ride.dropoff_latitude, longitude: ride.dropoff_longitude }
    );

    const startedAt = new Date(ride.started_at);
    const now = new Date();
    const durationMinutes = Math.ceil(
      (now.getTime() - startedAt.getTime()) / 60000
    );
    const finalFare = calculateFare(distanceKm, ride.vehicle_type);

    await query(
      `UPDATE rides 
       SET status = 'completed', final_fare = $1, distance_km = $2, 
           duration_minutes = $3, completed_at = NOW()
       WHERE id = $4`,
      [finalFare, distanceKm, durationMinutes, rideId]
    );

    // Make driver available again
    await query(
      `UPDATE drivers SET is_available = true, total_rides = total_rides + 1 WHERE id = $1`,
      [driverResult.rows[0].id]
    );

    // Update passenger total rides
    await query(
      `UPDATE passengers SET total_rides = total_rides + 1 WHERE id = $1`,
      [ride.passenger_id]
    );

    const io = getSocketServer();
    io.to(`ride:${rideId}`).emit("RIDE_COMPLETED", {
      rideId,
      final_fare: finalFare,
      distance_km: distanceKm,
      duration_minutes: durationMinutes,
    });

    logger.info(`Ride ${rideId} completed. Fare: ${finalFare}`);

    res.json({
      success: true,
      message: "Ride completed",
      data: { finalFare, distanceKm, durationMinutes },
    });
  } catch (error) {
    next(error);
  }
};
