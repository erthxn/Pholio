import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} (check your .env against .env.example)`);
  return v;
}

export const config = {
  spectrum: {
    projectId: required("SPECTRUM_PROJECT_ID"),
    projectSecret: required("SPECTRUM_PROJECT_SECRET"),
  },
  blockscoutApiKey: required("BLOCKSCOUT_API_KEY"),
  heliusApiKey: required("HELIUS_API_KEY"),
  tonApiKey: required("TONAPI_KEY"),
  gemini: {
    apiKey: required("GEMINI_API_KEY"),
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
  databaseUrl: required("DATABASE_URL"),
};
