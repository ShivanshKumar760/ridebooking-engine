// src/config/database.ts

import { Pool, PoolClient } from "pg";
import logger from "../utils/logger";

const useSSL = process.env.DB_SSL === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  logger.error("Unexpected error on idle client", err);
  process.exit(-1);
});

pool.on("connect", () => {
  logger.debug("New database connection established");
});

export const query = async (text: string, params?: unknown[]) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 100)}`);
    return result;
  } catch (error) {
    logger.error("Database query error", { query: text, error });
    throw error;
  }
};

export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  return client;
};

export const transaction = async <T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const testConnection = async (): Promise<boolean> => {
  try {
    await pool.query("SELECT 1");
    logger.info("✅ Database connection successful");
    return true;
  } catch (error) {
    logger.error("❌ Database connection failed", error);
    return false;
  }
};

export default pool;
