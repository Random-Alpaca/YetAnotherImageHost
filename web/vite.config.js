import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, proxy API + image requests to the Express app so cookies and the
// X-Accel path behave like production (minus the Nginx hand-off).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/i": "http://127.0.0.1:3000",
    },
  },
  build: {
    // Built assets go here; deploy/DEPLOY.md serves this dir via Nginx.
    outDir: "dist",
  },
});
