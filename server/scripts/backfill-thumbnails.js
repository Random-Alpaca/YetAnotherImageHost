#!/usr/bin/env node
// Run explicitly against the intended environment. Successful previews are
// durable checkpoints; re-running skips them and repairs missing files.
import process from "node:process";

const usage = `Usage: node --env-file=.env scripts/backfill-thumbnails.js [--limit N] [--after ID]

Generate 320px and 640px WebP previews for existing images. Originals are kept.
Already-complete previews are skipped; missing files are repaired automatically.
  --limit N   Attempt at most N images needing previews (default: all)
  --after ID  Resume scanning after this image ID, in ascending ID order
  --help      Print this message

Re-run without --after to retry failures and include new uploads.`;

let limit = Infinity;
let after = "";
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (args[i] === "--limit") {
      const value = args[++i];
      if (!/^[1-9]\d*$/.test(value || "") || !Number.isSafeInteger(Number(value))) {
        throw new Error("--limit requires a positive integer");
      }
      limit = Number(value);
    } else if (args[i] === "--after") {
      after = args[++i];
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(after || "")) throw new Error("--after requires an image ID");
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
} catch (err) {
  console.error(`${err.message}\n\n${usage}`);
  process.exit(1);
}

const { db } = await import("../src/db.js");
const { ensureThumbnails, hasCurrentThumbnails } = await import("../src/images.js");
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });
let attempted = 0;
let generated = 0;
let skipped = 0;
let failed = 0;
let lastId = after;
try {
  while (!stopping && attempted < limit) {
    const batch = db.prepare("SELECT * FROM images WHERE id > ? ORDER BY id LIMIT 100").all(lastId);
    if (!batch.length) break;
    for (const img of batch) {
      if (stopping || attempted >= limit) break;
      lastId = img.id;
      if (hasCurrentThumbnails(img)) {
        skipped++;
        continue;
      }
      attempted++;
      try {
        await ensureThumbnails(img.id);
        generated++;
        console.log(`Generated previews: ${img.id}`);
      } catch (err) {
        failed++;
        console.error(`Preview failed: ${img.id}: ${err.message}`);
      }
    }
  }
  console.log(JSON.stringify({ attempted, generated, skipped, failed, last_id: lastId || null, interrupted: stopping }));
  if (stopping || attempted >= limit) {
    console.log(`Resume after this position with --after ${lastId}; omit --after to retry earlier failures.`);
  }
  if (failed) process.exitCode = 1;
  if (stopping) process.exitCode = 130;
} finally {
  db.close();
}
