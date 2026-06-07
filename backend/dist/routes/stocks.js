import { Router } from "express";
import { db } from "../db/index.js";
import { mouvementsStock, articles, utilisateurs, fournisseurs, categories } from "../db/schema.js";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { requireAuth, auditLog } from "../middleware/auth.js";
const router = Router();
// Stock movements history
router.get("/mouvements", requireAuth("admin", "gerant"), async (req, res) => {
    const { articleId, type, dateDebut, dateFin } = req.query;
    const conditions = [];
    if (articleId)
        conditions.push(eq(mouvementsStock.articleId, Number(articleId)));
    if (type)
        conditions.push(eq(mouvementsStock.type, String(type)));
    if (dateDebut)
        conditions.push(sql `date(${mouvementsStock.createdAt}) >= ${dateDebut}`);
    if (dateFin)
        conditions.push(sql `date(${mouvementsStock.createdAt}) <= ${dateFin}`);
    const rows = db.select({
        id: mouvementsStock.id,
        articleId: mouvementsStock.articleId,
        type: mouvementsStock.type,
        quantite: mouvementsStock.quantite,
        userId: mouvementsStock.userId,
        motif: mouvementsStock.motif,
        fournisseurId: mouvementsStock.fournisseurId,
        prixAchat: mouvementsStock.prixAchat,
        createdAt: mouvementsStock.createdAt,
        article_nom: articles.nom,
        user_nom: utilisateurs.nom,
        fournisseur_nom: fournisseurs.nom
    })
        .from(mouvementsStock)
        .innerJoin(articles, eq(mouvementsStock.articleId, articles.id))
        .leftJoin(utilisateurs, eq(mouvementsStock.userId, utilisateurs.id))
        .leftJoin(fournisseurs, eq(mouvementsStock.fournisseurId, fournisseurs.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mouvementsStock.createdAt))
        .limit(500)
        .all();
    res.json(rows);
});
// Réapprovisionnement (entrée stock)
router.post("/entree", requireAuth("admin", "gerant"), async (req, res) => {
    const { articleId, quantite, fournisseurId, prixAchat, motif } = req.body;
    if (!articleId || !quantite)
        return res.status(400).json({ error: "Données manquantes" });
    try {
        const result = db.transaction((tx) => {
            tx.update(articles)
                .set({
                stockActuel: sql `${articles.stockActuel} + ${Number(quantite)}`,
                updatedAt: new Date()
            })
                .where(eq(articles.id, articleId))
                .run();
            return tx.insert(mouvementsStock).values({
                articleId: Number(articleId),
                type: 'entree',
                quantite: Number(quantite),
                userId: req.user?.id,
                fournisseurId: fournisseurId ? Number(fournisseurId) : null,
                prixAchat: prixAchat ? Number(prixAchat) : null,
                motif: motif || "Réapprovisionnement"
            }).returning().get();
        });
        await auditLog(req.user?.id, "ENTREE_STOCK", "articles", Number(articleId), { quantite });
        res.status(201).json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// Ajustement manuel (gérant uniquement)
router.post("/ajustement", requireAuth("admin", "gerant"), async (req, res) => {
    const { articleId, newStock, motif } = req.body;
    if (!articleId || newStock === undefined)
        return res.status(400).json({ error: "Données manquantes" });
    try {
        db.transaction((tx) => {
            const art = tx.select({ stockActuel: articles.stockActuel })
                .from(articles)
                .where(eq(articles.id, Number(articleId)))
                .get();
            if (!art)
                throw new Error("Article non trouvé");
            const diff = Number(newStock) - art.stockActuel;
            tx.update(articles)
                .set({
                stockActuel: Number(newStock),
                updatedAt: new Date()
            })
                .where(eq(articles.id, Number(articleId)))
                .run();
            tx.insert(mouvementsStock).values({
                articleId: Number(articleId),
                type: 'ajustement',
                quantite: Math.abs(diff),
                userId: req.user?.id,
                motif: motif || "Ajustement inventaire"
            }).run();
            // Return for audit log usage if needed, or just let transaction finish
            return { ancien: art.stockActuel, nouveau: newStock };
        });
        // Note: Transaction return value can be captured if needed, but here we just need to know it succeeded
        const art = db.select({ stockActuel: articles.stockActuel }).from(articles).where(eq(articles.id, Number(articleId))).get();
        await auditLog(req.user?.id, "AJUSTEMENT_STOCK", "articles", Number(articleId), { nouveau: newStock, motif });
        res.json({ ok: true });
    }
    catch (err) {
        if (err.message === "Article non trouvé")
            return res.status(404).json({ error: err.message });
        res.status(400).json({ error: err.message });
    }
});
// Articles en alerte
router.get("/alertes", requireAuth(), async (_req, res) => {
    const rows = db.select({
        id: articles.id,
        nom: articles.nom,
        stockActuel: articles.stockActuel,
        stockMinimum: articles.stockMinimum,
        unite: articles.unite,
        categorie_nom: categories.nom
    })
        .from(articles)
        .leftJoin(categories, eq(articles.categorieId, categories.id))
        .where(and(eq(articles.actif, true), sql `${articles.stockActuel} <= ${articles.stockMinimum}`))
        .orderBy(asc(articles.stockActuel))
        .all();
    res.json(rows);
});
export default router;
