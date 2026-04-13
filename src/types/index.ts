// src/types/index.ts

export interface User {
  id: string;
  email: string;
  phone: string;
  name: string;
  password_hash: string;
  role: "passenger" | "driver";
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Driver {
  id: string;
  user_id: string;
  vehicle_type: "bike" | "auto" | "cab" | "premium";
  vehicle_number: string;
  vehicle_model: string;
  license_number: string;
  rating: number;
  total_rides: number;
  is_available: boolean;
  current_location?: GeoPoint;
  created_at: Date;
  updated_at: Date;
}

export interface Passenger {
  id: string;
  user_id: string;
  rating: number;
  total_rides: number;
  created_at: Date;
  updated_at: Date;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id?: string;
  pickup_location: GeoPoint;
  pickup_address: string;
  dropoff_location: GeoPoint;
  dropoff_address: string;
  status: RideStatus;
  vehicle_type: "bike" | "auto" | "cab" | "premium";
  estimated_fare: number;
  final_fare?: number;
  distance_km?: number;
  duration_minutes?: number;
  otp: string;
  otp_verified: boolean;
  payment_status: PaymentStatus;
  payment_method?: string;
  payment_id?: string;
  payment_gateway?: "razorpay" | "stripe" | "mock";
  started_at?: Date;
  completed_at?: Date;
  cancelled_at?: Date;
  cancellation_reason?: string;
  created_at: Date;
  updated_at: Date;
}

export type RideStatus =
  | "searching"
  | "driver_assigned"
  | "driver_arriving"
  | "ride_started"
  | "completed"
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded";

export interface RideRequest {
  pickup_location: GeoPoint;
  pickup_address: string;
  dropoff_location: GeoPoint;
  dropoff_address: string;
  vehicle_type: "bike" | "auto" | "cab" | "premium";
}

export interface NearbyDriver {
  driver_id: string;
  user_id: string;
  name: string;
  phone: string;
  vehicle_type: string;
  vehicle_number: string;
  vehicle_model: string;
  rating: number;
  total_rides: number;
  latitude: number;
  longitude: number;
  distance_km: number;
}

export interface JwtPayload {
  userId: string;
  role: "passenger" | "driver";
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  gateway: "razorpay" | "stripe" | "mock";
  gatewayOrderId?: string;
  clientSecret?: string; // Stripe
}

export interface PaymentVerification {
  rideId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature?: string; // Razorpay
}

export interface LocationUpdate {
  userId: string;
  driverId?: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
}

// Socket event types
export interface SocketEvents {
  // Client → Server
  UPDATE_LOCATION: LocationUpdate;
  JOIN_RIDE_ROOM: { rideId: string };
  LEAVE_RIDE_ROOM: { rideId: string };

  // Server → Client
  RIDE_REQUEST: {
    rideId: string;
    passenger: { name: string; rating: number; phone: string };
    pickup: GeoPoint & { address: string };
    dropoff: GeoPoint & { address: string };
    estimatedFare: number;
    distanceKm: number;
  };
  DRIVER_ASSIGNED: {
    driver: NearbyDriver;
    otp: string;
    eta_minutes: number;
  };
  DRIVER_LOCATION: LocationUpdate;
  RIDE_STARTED: { rideId: string; otp_verified: boolean };
  RIDE_COMPLETED: {
    rideId: string;
    final_fare: number;
    duration_minutes: number;
  };
  RIDE_CANCELLED: { rideId: string; reason: string; cancelled_by: string };
  NO_DRIVERS_FOUND: { rideId: string };
}

// Express Request augmentation
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
