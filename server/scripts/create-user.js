// Admin CLI: create a user account.
//
//   node --env-file=.env scripts/create-user.js --username <name> [--role user|admin] [--password <pw>]
//
// If --password is omitted, a strong random password is generated and printed once.
// Use this to bootstrap the first admin account.
import process from "node:process";
import crypto from "node:crypto";
import { createUser } from "../src/auth.js";

const args = process.argv.slice(2);
let username = null;
let role = "user";
let password = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--username") username = args[++i];
  else if (args[i] === "--role") role = args[++i];
  else if (args[i] === "--password") password = args[++i];
}

if (!username) {
  console.error("Usage: create-user.js --username <name> [--role user|admin] [--password <pw>]");
  process.exit(1);
}

if (!["user", "admin"].includes(role)) {
  console.error("role must be 'user' or 'admin'");
  process.exit(1);
}

// Generate a strong password if not supplied.
const generated = !password;
if (generated) {
  password = crypto.randomBytes(18).toString("base64url");
}

try {
  const user = await createUser({ username, password, role });
  console.log("User created.");
  console.log(`  id:       ${user.id}`);
  console.log(`  username: ${user.username}`);
  console.log(`  role:     ${user.role}`);
  if (generated) {
    console.log("");
    console.log("Password (shown once — save it now):");
    console.log(`  ${password}`);
  }
} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
}
