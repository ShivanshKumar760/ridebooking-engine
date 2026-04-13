// src/utils/geo.ts

import { GeoPoint } from "../types";

/**
 * Haversine formula to calculate distance between two geo points
 * Returns distance in kilometers
 */
export const calculateDistance = (
  point1: GeoPoint,
  point2: GeoPoint
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(point2.latitude - point1.latitude);
  const dLon = toRadians(point2.longitude - point1.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.latitude)) *
      Math.cos(toRadians(point2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};

/**
 * Calculate estimated fare based on distance and vehicle type
 */
export const calculateFare = (
  distanceKm: number,
  vehicleType: "bike" | "auto" | "cab" | "premium"
): number => {
  const baseFare = parseFloat(process.env.BASE_FARE || "50");
  const perKmRate = parseFloat(process.env.PER_KM_RATE || "12");

  const multipliers: Record<string, number> = {
    bike: 0.7,
    auto: 1.0,
    cab: 1.3,
    premium: 2.0,
  };

  const multiplier = multipliers[vehicleType] || 1.0;
  const fare = (baseFare + distanceKm * perKmRate) * multiplier;
  return Math.round(fare * 100) / 100;
};

/**
 * Estimate ETA in minutes based on distance
 */
export const estimateETA = (distanceKm: number): number => {
  const avgSpeedKmh = 25; // city average
  const minutes = (distanceKm / avgSpeedKmh) * 60;
  return Math.ceil(minutes);
};

/**
 * Validate coordinates
 */
export const isValidCoordinate = (lat: number, lon: number): boolean => {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
};

/**
 * SQL query for nearby drivers using Haversine in PostgreSQL
 */
export const nearbyDriversQuery = (
  lat: number,
  lon: number,
  radiusKm: number,
  vehicleType?: string
): { query: string; params: unknown[] } => {
  const baseQuery = `
    SELECT 
      d.id as driver_id,
      d.user_id,
      u.name,
      u.phone,
      d.vehicle_type,
      d.vehicle_number,
      d.vehicle_model,
      d.rating,
      d.total_rides,
      d.current_latitude as latitude,
      d.current_longitude as longitude,
      (
        6371 * acos(
          cos(radians($1)) * cos(radians(d.current_latitude)) *
          cos(radians(d.current_longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(d.current_latitude))
        )
      ) AS distance_km
    FROM drivers d
    JOIN users u ON d.user_id = u.id
    WHERE 
      d.is_available = true
      AND d.current_latitude IS NOT NULL
      AND d.current_longitude IS NOT NULL
      AND u.is_active = true
      AND (
        6371 * acos(
          cos(radians($1)) * cos(radians(d.current_latitude)) *
          cos(radians(d.current_longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(d.current_latitude))
        )
      ) <= $3
  `;

  if (vehicleType) {
    return {
      query:
        baseQuery +
        " AND d.vehicle_type = $4 ORDER BY distance_km ASC LIMIT 10",
      params: [lat, lon, radiusKm, vehicleType],
    };
  }

  return {
    query: baseQuery + " ORDER BY distance_km ASC LIMIT 10",
    params: [lat, lon, radiusKm],
  };
};
