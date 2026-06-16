// Admin CLI: issue an access password. Print it once — only the hash is stored.
//
//   node --env-file=.env scripts/issue-password.js [--role user|admin] [--label "..."]
//
// Use this to bootstrap the FIRST admin password (the admin web page needs an
// admin session, which you can't have until one exists). After that you can
// issue more from the /admin page.
import process from "node:process";
import { issuePassword } from "../src/auth.js";

const args = process.argv.slice(2);
let role = "user";
let label = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--role") role = args[++i];
  else if (args[i] === "--label") label = args[++i];
}

if (!["user", "admin"].includes(role)) {
  console.error("role must be 'user' or 'admin'");
  process.exit(1);
}

const created = issuePassword({ role, label });

console.log("Password issued.");
console.log(`  role:  ${role}`);
console.log(`  label: ${label || "(none)"}`);
console.log("");
console.log("Password (shown once — paste into the login page):");
console.log(`  ${created.password}`);
