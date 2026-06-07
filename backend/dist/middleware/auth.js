import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { sessions, auditLogs } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
export function requireAuth(...roles) {
    return async (req, res, next) => {
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (!token)
            return res.status(401).json({ error: "Non authentifié" });
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            // Check session is still active
            const session = db.select().from(sessions).where(and(eq(sessions.token, token), isNull(sessions.fermeture))).get();
            if (!session)
                return res.status(401).json({ error: "Session expirée" });
            req.user = { id: payload.id, role: payload.role, nom: payload.nom };
            if (roles.length && !roles.includes(payload.role)) {
                return res.status(403).json({ error: "Accès refusé" });
            }
            next();
        }
        catch {
            return res.status(401).json({ error: "Token invalide" });
        }
    };
}
export async function auditLog(userId, action, entite, entiteId, details) {
    db.insert(auditLogs).values({
        userId: userId ?? null,
        action,
        entite: entite ?? null,
        entiteId: entiteId ?? null,
        details: details ?? null
    }).run();
}
