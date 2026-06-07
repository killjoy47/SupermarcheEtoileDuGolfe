import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { utilisateurs, sessions } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, auditLog } from "../middleware/auth.js";
const router = Router();
const failedLoginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = Math.max(1, Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5));
const ATTEMPT_WINDOW_MS = Math.max(60_000, Number(process.env.AUTH_ATTEMPT_WINDOW_MS || 15 * 60 * 1000));
const LOCKOUT_MS = Math.max(60_000, Number(process.env.AUTH_LOCKOUT_MS || 15 * 60 * 1000));
function getAttemptKey(req, identifiant) {
    return `${String(identifiant || "").toLowerCase()}|${String(req.ip || "unknown")}`;
}
function resetFailedAttempts(key) {
    failedLoginAttempts.delete(key);
}
function registerFailedAttempt(key, now) {
    const state = failedLoginAttempts.get(key);
    if (!state || now - state.firstFailedAt > ATTEMPT_WINDOW_MS) {
        const next = { count: 1, firstFailedAt: now, lockedUntil: 0 };
        failedLoginAttempts.set(key, next);
        return next;
    }
    const nextCount = state.count + 1;
    const lockedUntil = nextCount >= MAX_LOGIN_ATTEMPTS ? now + LOCKOUT_MS : 0;
    const next = {
        count: nextCount,
        firstFailedAt: state.firstFailedAt,
        lockedUntil
    };
    failedLoginAttempts.set(key, next);
    return next;
}
function getRemainingLockMs(key, now) {
    const state = failedLoginAttempts.get(key);
    if (!state)
        return 0;
    if (now - state.firstFailedAt > ATTEMPT_WINDOW_MS && state.lockedUntil <= now) {
        failedLoginAttempts.delete(key);
        return 0;
    }
    return Math.max(0, state.lockedUntil - now);
}
router.post("/login", async (req, res) => {
    const identifiant = String(req.body?.identifiant || "").trim();
    const motDePasse = String(req.body?.motDePasse || "");
    if (!identifiant || !motDePasse)
        return res.status(400).json({ error: "Identifiant et mot de passe requis" });
    if (identifiant.length > 80 || motDePasse.length > 256) {
        return res.status(400).json({ error: "Format de connexion invalide" });
    }
    const now = Date.now();
    const attemptKey = getAttemptKey(req, identifiant);
    const remainingLockMs = getRemainingLockMs(attemptKey, now);
    if (remainingLockMs > 0) {
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingLockMs / 1000));
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({ error: "Trop de tentatives. Reessayez plus tard." });
    }
    const user = db.select().from(utilisateurs).where(and(eq(utilisateurs.identifiant, identifiant), eq(utilisateurs.actif, true))).get();
    if (!user) {
        const next = registerFailedAttempt(attemptKey, now);
        await auditLog(null, "LOGIN_FAILED", "utilisateurs", null, { identifiant, reason: "invalid_credentials", attempts: next.count });
        if (next.lockedUntil > now) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((next.lockedUntil - now) / 1000))));
            return res.status(429).json({ error: "Trop de tentatives. Reessayez plus tard." });
        }
        return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
    }
    const valid = await bcrypt.compare(motDePasse, user.motDePasseHash);
    if (!valid) {
        const next = registerFailedAttempt(attemptKey, now);
        await auditLog(user.id, "LOGIN_FAILED", "utilisateurs", user.id, { identifiant, reason: "invalid_credentials", attempts: next.count });
        if (next.lockedUntil > now) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((next.lockedUntil - now) / 1000))));
            return res.status(429).json({ error: "Trop de tentatives. Reessayez plus tard." });
        }
        return res.status(401).json({ error: "Identifiant ou mot de passe incorrect" });
    }
    resetFailedAttempts(attemptKey);
    const token = jwt.sign({ id: user.id, role: user.role, nom: user.nom }, process.env.JWT_SECRET, { expiresIn: "12h" });
    db.insert(sessions).values({
        userId: user.id,
        token: token
    }).run();
    await auditLog(user.id, "LOGIN", "utilisateurs", user.id);
    res.json({
        token,
        user: { id: user.id, nom: user.nom, role: user.role, identifiant: user.identifiant }
    });
});
router.post("/logout", requireAuth(), async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
        db.update(sessions).set({
            fermeture: new Date()
        }).where(eq(sessions.token, token)).run();
    }
    await auditLog(req.user?.id, "LOGOUT");
    res.json({ ok: true });
});
router.get("/me", requireAuth(), async (req, res) => {
    const user = db.select({
        id: utilisateurs.id,
        nom: utilisateurs.nom,
        identifiant: utilisateurs.identifiant,
        role: utilisateurs.role
    })
        .from(utilisateurs)
        .where(eq(utilisateurs.id, req.user.id))
        .get();
    res.json(user);
});
// Change password
router.put("/password", requireAuth(), async (req, res) => {
    const ancien = String(req.body?.ancien || "");
    const nouveau = String(req.body?.nouveau || "");
    if (!ancien || !nouveau) {
        return res.status(400).json({ error: "Ancien et nouveau mot de passe requis" });
    }
    if (nouveau.length < 8 || nouveau.length > 128) {
        return res.status(400).json({ error: "Le nouveau mot de passe doit contenir entre 8 et 128 caracteres" });
    }
    if (nouveau === ancien) {
        return res.status(400).json({ error: "Le nouveau mot de passe doit etre different de l'ancien" });
    }
    const user = db.select({
        motDePasseHash: utilisateurs.motDePasseHash
    })
        .from(utilisateurs)
        .where(eq(utilisateurs.id, req.user.id))
        .get();
    if (!user)
        return res.status(404).json({ error: "Utilisateur non trouvé" });
    const valid = await bcrypt.compare(ancien, user.motDePasseHash);
    if (!valid)
        return res.status(400).json({ error: "Ancien mot de passe incorrect" });
    const hash = await bcrypt.hash(nouveau, 12);
    db.update(utilisateurs).set({
        motDePasseHash: hash
    }).where(eq(utilisateurs.id, req.user.id)).run();
    await auditLog(req.user?.id, "CHANGE_PASSWORD");
    res.json({ ok: true });
});
export default router;
