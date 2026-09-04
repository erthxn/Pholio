// One-off script: creates the tables in schema.sql against DATABASE_URL.
// Run with: npm run db:init
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const sql = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — check your .env");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("Pholio schema ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
