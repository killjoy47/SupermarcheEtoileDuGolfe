import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import { sqlite } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import articlesRoutes from "./routes/articles.js";
import ventesRoutes from "./routes/ventes.js";
import stocksRoutes from "./routes/stocks.js";
import rapportsRoutes from "./routes/rapports.js";
import utilisateursRoutes from "./routes/utilisateurs.js";
const moduleUrl = import.meta.url;
const runtimeDir = moduleUrl
    ? path.dirname(fileURLToPath(moduleUrl))
    : path.dirname(process.argv[1] || process.cwd());
const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "127.0.0.1";
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const allowedOrigins = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://${HOST}:${PORT}`,
    ...configuredOrigins
]);
if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).trim().length < 32) {
    throw new Error("JWT_SECRET manquant ou trop faible (minimum 32 caracteres)");
}
app.disable("x-powered-by");
app.set("trust proxy", false);
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
}));
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
// API Routes
app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false
}));
app.use("/api/auth/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    standardHeaders: true,
    legacyHeaders: false
}));
app.use("/api/auth", authRoutes);
app.use("/api/articles", articlesRoutes);
app.use("/api/ventes", ventesRoutes);
app.use("/api/stocks", stocksRoutes);
app.use("/api/rapports", rapportsRoutes);
app.use("/api/utilisateurs", utilisateursRoutes);
// Config, Categories, Fournisseurs are handled by utilisateurs router with baseOverride
app.use("/api/categories", (req, _res, next) => { req.baseOverride = true; next(); }, utilisateursRoutes);
app.use("/api/fournisseurs", (req, _res, next) => { req.baseOverride = true; next(); }, utilisateursRoutes);
app.use("/api/config", (req, _res, next) => { req.baseOverride = true; next(); }, utilisateursRoutes);
app.get("/api/health", (_req, res) => {
    try {
        sqlite.prepare("SELECT 1").get();
        res.json({ status: "ok", version: "1.0.0-EXE" });
    }
    catch {
        res.status(503).json({ status: "error" });
    }
});
// Serve Frontend Static Files
const frontendPath = path.join(runtimeDir, "../../frontend/dist");
app.use(express.static(frontendPath, {
    setHeaders: (res, filePath) => {
        if (/[.](html|js|css|webmanifest|png|jpg|jpeg|gif|ico|svg)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
        }
    }
}));
// Fallback for SPA routing
app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "API route not found" });
    }
    res.sendFile(path.join(frontendPath, "index.html"));
});
app.use((err, _req, res, _next) => {
    if (err?.message === "Not allowed by CORS") {
        return res.status(403).json({ error: "Origin non autorisee" });
    }
    return res.status(500).json({ error: "Erreur interne" });
});
app.listen(PORT, HOST, () => {
    console.log(`✅  ShopDesk Server → http://${HOST}:${PORT}`);
    console.log(`📁  Serving frontend from: ${frontendPath}`);
});
