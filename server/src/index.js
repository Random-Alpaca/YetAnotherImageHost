// Express bootstrap. Listens on loopback; Nginx is the public entry point.
import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import "./db.js"; // opens DB + runs migrations on import
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import uploadRoutes from "./routes/upload.js";
import imageRoutes, { privateRouter } from "./routes/images.js";

const app = express();

// Behind Nginx; trust the proxy so secure-cookie + IP logic behaves.
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser(config.cookieSecret));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// DEV ONLY: serve public images directly. In production Nginx owns /i/public/.
if (config.devDirectServe) {
  app.use("/i/public", express.static(config.storagePublic));
}

app.use("/api", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", uploadRoutes);
app.use("/api/images", imageRoutes);
app.use("/i", privateRouter);

// Fallthrough 404 for unmatched API/image routes.
app.use((req, res) => res.status(404).json({ error: "not found" }));

// Last-resort error handler.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

app.listen(config.port, config.host, () => {
  console.log(`image-hoster app listening on http://${config.host}:${config.port}`);
});
