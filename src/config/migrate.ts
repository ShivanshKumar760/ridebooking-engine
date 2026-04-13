// src/config/migrate.ts

import { query, testConnection } from "./database";
import logger from "../utils/logger";
import dotenv from "dotenv";

dotenv.config();

const migrations = [
  // Enable UUID extension
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,

  // Users table (shared between passengers and drivers)
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('passenger', 'driver')),
    is_active BOOLEAN DEFAULT true,
    refresh_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Passengers table
  `CREATE TABLE IF NOT EXISTS passengers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating DECIMAL(3,2) DEFAULT 5.00,
    total_rides INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Drivers table
  `CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('bike', 'auto', 'cab', 'premium')),
    vehicle_number VARCHAR(20) NOT NULL,
    vehicle_model VARCHAR(100) NOT NULL,
    license_number VARCHAR(50) NOT NULL,
    rating DECIMAL(3,2) DEFAULT 5.00,
    total_rides INTEGER DEFAULT 0,
    is_available BOOLEAN DEFAULT false,
    current_latitude DECIMAL(10, 8),
    current_longitude DECIMAL(11, 8),
    last_location_update TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Rides table
  `CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    passenger_id UUID NOT NULL REFERENCES passengers(id),
    driver_id UUID REFERENCES drivers(id),
    pickup_latitude DECIMAL(10, 8) NOT NULL,
    pickup_longitude DECIMAL(11, 8) NOT NULL,
    pickup_address TEXT NOT NULL,
    dropoff_latitude DECIMAL(10, 8) NOT NULL,
    dropoff_longitude DECIMAL(11, 8) NOT NULL,
    dropoff_address TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'searching'
      CHECK (status IN ('searching','driver_assigned','driver_arriving','ride_started','completed','cancelled')),
    vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('bike', 'auto', 'cab', 'premium')),
    estimated_fare DECIMAL(10, 2) NOT NULL,
    final_fare DECIMAL(10, 2),
    distance_km DECIMAL(8, 3),
    duration_minutes INTEGER,
    otp VARCHAR(6) NOT NULL,
    otp_verified BOOLEAN DEFAULT false,
    payment_status VARCHAR(20) DEFAULT 'pending'
      CHECK (payment_status IN ('pending','processing','completed','failed','refunded')),
    payment_method VARCHAR(50),
    payment_id TEXT,
    payment_gateway VARCHAR(20) CHECK (payment_gateway IN ('razorpay', 'stripe', 'mock')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Driver location history
  `CREATE TABLE IF NOT EXISTS driver_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    heading DECIMAL(5, 2),
    speed DECIMAL(6, 2),
    recorded_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Ride ratings
  `CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id),
    rated_by UUID NOT NULL REFERENCES users(id),
    rated_user UUID NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Payment transactions
  `CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ride_id UUID NOT NULL REFERENCES rides(id),
    gateway VARCHAR(20) NOT NULL CHECK (gateway IN ('razorpay', 'stripe', 'mock')),
    gateway_order_id TEXT,
    gateway_payment_id TEXT,
    gateway_signature TEXT,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(5) DEFAULT 'INR',
    status VARCHAR(20) DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Indexes for performance
  `CREATE INDEX IF NOT EXISTS idx_drivers_available ON drivers(is_available) WHERE is_available = true`,
  `CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers(current_latitude, current_longitude)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status)`,
  `CREATE INDEX IF NOT EXISTS idx_driver_locations_driver ON driver_locations(driver_id)`,
  `CREATE INDEX IF NOT EXISTS idx_driver_locations_recorded ON driver_locations(recorded_at DESC)`,

  // Update timestamp trigger function
  `CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql'`,

  // Apply triggers
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_drivers_updated_at') THEN
      CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_rides_updated_at') THEN
      CREATE TRIGGER update_rides_updated_at BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END $$`,
];

const runMigrations = async (): Promise<void> => {
  const connected = await testConnection();
  if (!connected) {
    logger.error("Cannot run migrations: database connection failed");
    process.exit(1);
  }

  logger.info("Running database migrations...");
  for (let i = 0; i < migrations.length; i++) {
    try {
      await query(migrations[i]);
      logger.info(`✅ Migration ${i + 1}/${migrations.length} successful`);
    } catch (error) {
      logger.error(`❌ Migration ${i + 1} failed:`, error);
      throw error;
    }
  }
  logger.info("✅ All migrations completed successfully");
};

runMigrations()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
