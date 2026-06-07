import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { utilisateurs, categories, fournisseurs, config } from "../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { requireAuth, auditLog } from "../middleware/auth.js";
const router = Router();
// ─── Utilisateurs ────────────────────────────────────────────────────────────
router.get("/", requireAuth("admin", "gerant"), async (_req, res) => {
    const rows = db.select({
        id: utilisateurs.id,
        nom: utilisateurs.nom,
        identifiant: utilisateurs.identifiant,
        role: utilisateurs.role,
        actif: utilisateurs.actif,
        createdAt: utilisateurs.createdAt
    })
        .from(utilisateurs)
        .orderBy(asc(utilisateurs.nom))
        .all();
    res.json(rows);
});
router.post("/", requireAuth("admin"), async (req, res) => {
    const { nom, identifiant, motDePasse, role } = req.body;
    if (!nom || !identifiant || !motDePasse)
        return res.status(400).json({ error: "Données manquantes" });
    const hash = await bcrypt.hash(motDePasse, 12);
    try {
        const newUser = db.insert(utilisateurs).values({
            nom,
            identifiant,
            motDePasseHash: hash,
            role: role || "caissier"
        }).returning({
            id: utilisateurs.id,
            nom: utilisateurs.nom,
            identifiant: utilisateurs.identifiant,
            role: utilisateurs.role
        }).get();
        await auditLog(req.user?.id, "CREATE_USER", "utilisateurs", newUser.id, { nom, role });
        res.status(201).json(newUser);
    }
    catch (e) {
        if (e.message?.includes("UNIQUE constraint failed")) {
            return res.status(400).json({ error: "Identifiant déjà utilisé" });
        }
        res.status(400).json({ error: e.message });
    }
});
router.put("/:id", requireAuth("admin"), async (req, res) => {
    const { nom, role, actif, motDePasse } = req.body;
    const id = parseInt(req.params.id);
    try {
        const updateData = {
            nom,
            role,
            actif: actif ?? true
        };
        if (motDePasse) {
            updateData.motDePasseHash = await bcrypt.hash(motDePasse, 12);
        }
        db.update(utilisateurs)
            .set(updateData)
            .where(eq(utilisateurs.id, id))
            .run();
        await auditLog(req.user?.id, "UPDATE_USER", "utilisateurs", id);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// ─── Categories ──────────────────────────────────────────────────────────────
router.get("/categories", requireAuth(), async (_req, res) => {
    const rows = db.select().from(categories).orderBy(asc(categories.nom)).all();
    res.json(rows);
});
router.post("/categories", requireAuth("admin", "gerant"), async (req, res) => {
    const { nom, rayon } = req.body;
    const newCat = db.insert(categories).values({ nom, rayon }).returning().get();
    res.status(201).json(newCat);
});
router.put("/categories/:id", requireAuth("admin", "gerant"), async (req, res) => {
    const { nom, rayon } = req.body;
    const id = parseInt(req.params.id);
    db.update(categories).set({ nom, rayon }).where(eq(categories.id, id)).run();
    res.json({ ok: true });
});
// ─── Fournisseurs ─────────────────────────────────────────────────────────────
router.get("/fournisseurs", requireAuth(), async (_req, res) => {
    const rows = db.select().from(fournisseurs).orderBy(asc(fournisseurs.nom)).all();
    res.json(rows);
});
router.post("/fournisseurs", requireAuth("admin", "gerant"), async (req, res) => {
    const { nom, contact, adresse } = req.body;
    const newFourn = db.insert(fournisseurs).values({ nom, contact, adresse }).returning().get();
    res.status(201).json(newFourn);
});
// ─── Config ───────────────────────────────────────────────────────────────────
router.get("/config", requireAuth("admin", "gerant"), async (_req, res) => {
    const rows = db.select().from(config).all();
    res.json(Object.fromEntries(rows.map(r => [r.cle, r.valeur])));
});
router.put("/config", requireAuth("admin", "gerant"), async (req, res) => {
    try {
        db.transaction((tx) => {
            for (const [cle, valeur] of Object.entries(req.body)) {
                tx.insert(config)
                    .values({ cle, valeur: String(valeur) })
                    .onConflictDoUpdate({ target: config.cle, set: { valeur: String(valeur) } })
                    .run();
            }
        });
        await auditLog(req.user?.id, "UPDATE_CONFIG");
        res.json({ ok: true });
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
export default router;
