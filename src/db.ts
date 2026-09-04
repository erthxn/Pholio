import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });

export interface StoredUser {
  id: number;
  platform_id: string;
  name: string | null;
  first_seen_at: string;
}

/** Gets or creates the user row for this platform (iMessage) identifier. */
export async function ensureUser(platformId: string): Promise<StoredUser> {
  const existing = await pool.query<StoredUser>(
    `SELECT * FROM users WHERE platform_id = $1`,
    [platformId]
  );
  if (existing.rows[0]) {
    await pool.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [existing.rows[0].id]);
    return existing.rows[0];
  }
  const inserted = await pool.query<StoredUser>(
    `INSERT INTO users (platform_id) VALUES ($1) RETURNING *`,
    [platformId]
  );
  return inserted.rows[0];
}

/** True the very first time we ever hear from this platform id. */
export async function isFirstEverMessage(platformId: string): Promise<boolean> {
  const res = await pool.query(`SELECT id FROM users WHERE platform_id = $1`, [platformId]);
  return res.rowCount === 0;
}

export async function setUserName(userId: number, name: string): Promise<void> {
  await pool.query(`UPDATE users SET name = $1 WHERE id = $2`, [name, userId]);
}

export async function saveMessage(userId: number, role: "user" | "assistant", content: string): Promise<void> {
  await pool.query(
    `INSERT INTO messages (user_id, role, content) VALUES ($1, $2, $3)`,
    [userId, role, content]
  );
}

/** Recent conversation, oldest first — feed straight into the AI as history. */
export async function getRecentMessages(userId: number, limit = 20) {
  const res = await pool.query<{ role: "user" | "assistant"; content: string; created_at: string }>(
    `SELECT role, content, created_at FROM messages
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return res.rows.reverse();
}

/** Wipes a user's memory — powers the natural-language "forget everything" ask. */
export async function wipeMemory(userId: number): Promise<void> {
  await pool.query(`DELETE FROM messages WHERE user_id = $1`, [userId]);
}

export async function saveScan(params: {
  userId: number;
  address: string;
  chain: string;
  rawData: unknown;
  aiSummary: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO scans (user_id, address, chain, raw_data, ai_summary) VALUES ($1, $2, $3, $4, $5)`,
    [params.userId, params.address, params.chain, JSON.stringify(params.rawData), params.aiSummary]
  );
}

export interface StoredScan {
  address: string;
  chain: string;
  ai_summary: string;
  created_at: string;
}

/** Most recent past scan of this exact address+chain for this user, if any — for recall, never for a live answer. */
export async function getLastScan(userId: number, address: string, chain: string): Promise<StoredScan | null> {
  const res = await pool.query<StoredScan>(
    `SELECT address, chain, ai_summary, created_at FROM scans
     WHERE user_id = $1 AND address = $2 AND chain = $3
     ORDER BY created_at DESC LIMIT 1`,
    [userId, address, chain]
  );
  return res.rows[0] ?? null;
}

export async function getRecentScans(userId: number, limit = 10) {
  const res = await pool.query<StoredScan>(
    `SELECT address, chain, ai_summary, created_at FROM scans
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}
