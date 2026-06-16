// Central config, sourced from environment. Loaded once at boot.
import process from "node:process";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),

  storagePublic: process.env.STORAGE_PUBLIC || "/srv/images/public",
  storagePrivate: process.env.STORAGE_PRIVATE || "/srv/images/private",
  dbPath: process.env.DB_PATH || "/srv/app/data.db",

  cookieSecret: required("COOKIE_SECRET"),
  cookieSecure: (process.env.COOKIE_SECURE || "true") === "true",

  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 26214400),
  // Max files accepted in a single bulk upload request.
  maxUploadFiles: Number(process.env.MAX_UPLOAD_FILES || 50),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),

  internalPrefix: process.env.INTERNAL_PREFIX || "/internal",

  // DEV ONLY. When true, the app serves image bytes itself (public statically,
  // private after auth) instead of relying on Nginx. Lets you run the full app
  // without Nginx locally. Leave false/unset in production — there X-Accel and
  // Nginx's public location handle delivery.
  devDirectServe: process.env.DEV_DIRECT_SERVE === "true",
};
