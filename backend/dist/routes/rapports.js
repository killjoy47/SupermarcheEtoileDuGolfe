import { Router } from "express";
import fs from "node:fs";
import { db } from "../db/index.js";
import { ventes, lignesVente, articles, utilisateurs, categories, mouvementsStock, fournisseurs } from "../db/schema.js";
import { eq, and, sql, asc, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
const router = Router();
const resolvePdfFontPath = () => {
    const candidates = [
        process.env.PDF_FONT_PATH,
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p));
};
const PDF_FONT_PATH = resolvePdfFontPath();
const toAsciiFallback = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ");
const oneLine = (value) => String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
const pdfText = (value) => {
    const clean = oneLine(value);
    return PDF_FONT_PATH ? clean : toAsciiFallback(clean);
};
const formatMoney = (value) => {
    const n = Math.round(Number(value) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};
const toDateOrNull = (value) => {
    if (value === null || value === undefined)
        return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number") {
        const ms = value < 1_000_000_000_000 ? value * 1000 : value;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === "string") {
        const num = Number(value);
        if (!Number.isNaN(num) && value.trim() !== "") {
            const ms = num < 1_000_000_000_000 ? num * 1000 : num;
            const dFromNum = new Date(ms);
            if (!Number.isNaN(dFromNum.getTime()))
                return dFromNum;
        }
        const d = new Date(value);
        if (!Number.isNaN(d.getTime()))
            return d;
        const patched = new Date(value.replace(" ", "T"));
        return Number.isNaN(patched.getTime()) ? null : patched;
    }
    return null;
};
const formatDateTimeFr = (value) => {
    const d = toDateOrNull(value);
    if (!d)
        return "-";
    return d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};
function getVenteStats(dateDebut, dateFin) {
    const summary = db.select({
        nb_ventes: sql `sum(case when ${ventes.statut} = 'validee' then 1 else 0 end)`,
        chiffre_affaires: sql `coalesce(sum(case when ${ventes.statut} = 'validee' then ${ventes.totalTtc} else 0 end), 0)`,
        panier_moyen: sql `coalesce(avg(case when ${ventes.statut} = 'validee' then ${ventes.totalTtc} else null end), 0)`,
        nb_annulations: sql `sum(case when ${ventes.statut} = 'annulee' then 1 else 0 end)`
    })
        .from(ventes)
        .where(sql `date(${ventes.createdAt}) between ${dateDebut} and ${dateFin}`)
        .get() || { nb_ventes: 0, chiffre_affaires: 0, panier_moyen: 0, nb_annulations: 0 };
    const parJour = db.select({
        jour: sql `date(${ventes.createdAt})`,
        nb_ventes: sql `sum(case when ${ventes.statut} = 'validee' then 1 else 0 end)`,
        total: sql `coalesce(sum(case when ${ventes.statut} = 'validee' then ${ventes.totalTtc} else 0 end), 0)`
    })
        .from(ventes)
        .where(sql `date(${ventes.createdAt}) between ${dateDebut} and ${dateFin}`)
        .groupBy(sql `date(${ventes.createdAt})`)
        .orderBy(sql `date(${ventes.createdAt})`)
        .all();
    const topArticles = db.select({
        nom: articles.nom,
        qte_vendue: sql `sum(${lignesVente.quantite})`,
        ca: sql `sum(${lignesVente.sousTotal})`,
        prix_unitaire_moyen: sql `coalesce(sum(${lignesVente.sousTotal}) / nullif(sum(${lignesVente.quantite}), 0), 0)`
    })
        .from(lignesVente)
        .innerJoin(ventes, eq(lignesVente.venteId, ventes.id))
        .innerJoin(articles, eq(lignesVente.articleId, articles.id))
        .where(and(eq(ventes.statut, 'validee'), sql `date(${ventes.createdAt}) between ${dateDebut} and ${dateFin}`))
        .groupBy(articles.id, articles.nom)
        .orderBy(desc(sql `sum(${lignesVente.quantite})`), asc(articles.nom))
        .limit(10)
        .all();
    const parPaiement = db.select({
        mode_paiement: ventes.modePaiement,
        nb: sql `count(*)`,
        total: sql `sum(${ventes.totalTtc})`
    })
        .from(ventes)
        .where(and(eq(ventes.statut, 'validee'), sql `date(${ventes.createdAt}) between ${dateDebut} and ${dateFin}`))
        .groupBy(ventes.modePaiement)
        .all();
    return { summary, parJour, topArticles, parPaiement };
}
function getArticlesSortis(dateDebut, dateFin) {
    return db.select({
        date_vente: sql `coalesce(strftime('%d/%m/%Y %H:%M', ${ventes.createdAt}, 'unixepoch', 'localtime'), strftime('%d/%m/%Y %H:%M', ${ventes.createdAt}), '-')`,
        caissier: utilisateurs.nom,
        article: articles.nom,
        quantite: lignesVente.quantite,
        montant: lignesVente.sousTotal,
    })
        .from(lignesVente)
        .innerJoin(ventes, eq(lignesVente.venteId, ventes.id))
        .innerJoin(articles, eq(lignesVente.articleId, articles.id))
        .leftJoin(utilisateurs, eq(ventes.caissierId, utilisateurs.id))
        .where(and(eq(ventes.statut, 'validee'), sql `date(${ventes.createdAt}) between ${dateDebut} and ${dateFin}`))
        .orderBy(desc(ventes.createdAt), asc(articles.nom))
        .all();
}
function getReapprovisionnements(dateDebut, dateFin) {
    return db.select({
        date_mouvement: sql `coalesce(strftime('%d/%m/%Y %H:%M', ${mouvementsStock.createdAt}, 'unixepoch', 'localtime'), strftime('%d/%m/%Y %H:%M', ${mouvementsStock.createdAt}), '-')`,
        article: articles.nom,
        quantite: mouvementsStock.quantite,
        fournisseur: fournisseurs.nom,
        utilisateur: utilisateurs.nom,
        motif: mouvementsStock.motif,
    })
        .from(mouvementsStock)
        .innerJoin(articles, eq(mouvementsStock.articleId, articles.id))
        .leftJoin(fournisseurs, eq(mouvementsStock.fournisseurId, fournisseurs.id))
        .leftJoin(utilisateurs, eq(mouvementsStock.userId, utilisateurs.id))
        .where(and(eq(mouvementsStock.type, "entree"), sql `date(${mouvementsStock.createdAt}) between ${dateDebut} and ${dateFin}`))
        .orderBy(desc(mouvementsStock.createdAt), asc(articles.nom))
        .all();
}
// Dashboard stats
router.get("/dashboard", requireAuth("admin", "gerant"), async (_req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const monday = new Date();
    monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1));
    const weekStart = monday.toISOString().split("T")[0];
    const stats = getVenteStats(today, today);
    const weekStats = getVenteStats(weekStart, today);
    const alertesCount = db.select({ count: sql `count(*)` })
        .from(articles)
        .where(and(eq(articles.actif, true), sql `${articles.stockActuel} <= ${articles.stockMinimum}`))
        .get();
    const articleStats = db.select({
        total: sql `count(*)`,
        valeur_stock: sql `coalesce(sum(${articles.stockActuel} * ${articles.prixVente}), 0)`
    })
        .from(articles)
        .where(eq(articles.actif, true))
        .get();
    res.json({
        aujourd_hui: stats.summary,
        semaine: weekStats.summary,
        alertes_stock: Number(alertesCount?.count || 0),
        articles: articleStats,
        top_articles: stats.topArticles,
        par_heure: stats.parJour,
    });
});
// PDF Report
router.get("/pdf", requireAuth("admin", "gerant"), async (req, res) => {
    const { dateDebut, dateFin, titre } = req.query;
    const debut = dateDebut || new Date().toISOString().split("T")[0];
    const fin = dateFin || debut;
    const stats = getVenteStats(debut, fin);
    const articlesSortis = getArticlesSortis(debut, fin);
    const reappros = getReapprovisionnements(debut, fin);
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    if (PDF_FONT_PATH) {
        doc.font(PDF_FONT_PATH);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-${debut}.pdf"`);
    doc.pipe(res);
    // Header
    doc.fontSize(22).fillColor("#1a3c5e").text(pdfText("Supermarché étoile du golfe"), 50, 50);
    doc.fontSize(14).fillColor("#666").text(pdfText(titre || `Rapport du ${debut} au ${fin}`), 50, 80);
    doc.moveTo(50, 105).lineTo(545, 105).stroke("#1a3c5e");
    // Summary boxes
    doc.fontSize(12).fillColor("#000");
    const s = stats.summary;
    let y = 130;
    const ensureSpace = (needed = 16) => {
        if (y + needed <= 760)
            return;
        doc.addPage();
        if (PDF_FONT_PATH) {
            doc.font(PDF_FONT_PATH);
        }
        y = 50;
    };
    const boxes = [
        { label: "Ventes validées", val: s.nb_ventes || 0 },
        { label: "Chiffre d'affaires", val: `${formatMoney(s.chiffre_affaires)} FCFA` },
        { label: "Panier moyen", val: `${formatMoney(s.panier_moyen)} FCFA` },
        { label: "Annulations", val: s.nb_annulations || 0 },
    ];
    boxes.forEach((b, i) => {
        const x = 50 + (i % 2) * 250;
        const by = y + Math.floor(i / 2) * 60;
        doc.rect(x, by, 220, 45).fillAndStroke("#f0f4f8", "#ddd");
        doc.fillColor("#666").fontSize(9).text(pdfText(b.label), x + 10, by + 8);
        doc.fillColor("#1a3c5e").fontSize(16).text(pdfText(String(b.val)), x + 10, by + 20);
    });
    y += 150;
    // Top articles
    doc.fontSize(13).fillColor("#1a3c5e").text(pdfText("Top 10 articles vendus"), 50, y);
    y += 20;
    doc.fontSize(9).fillColor("#666");
    ["Article", "Quantité", "PU moyen", "CA (FCFA)"].forEach((h, i) => {
        doc.text(pdfText(h), 50 + [0, 250, 340, 440][i], y);
    });
    y += 15;
    doc.moveTo(50, y).lineTo(545, y).stroke("#ddd");
    y += 5;
    stats.topArticles.forEach((a) => {
        doc.fillColor("#000").fontSize(9);
        doc.text(pdfText(a.nom.substring(0, 35)), 50, y);
        doc.text(pdfText(a.qte_vendue), 250, y);
        doc.text(pdfText(formatMoney(a.prix_unitaire_moyen)), 340, y);
        doc.text(pdfText(formatMoney(a.ca)), 440, y);
        y += 15;
    });
    // Par mode paiement
    y += 20;
    ensureSpace(28);
    doc.fontSize(13).fillColor("#1a3c5e").text(pdfText("Toutes les sorties d'articles (caisse + date)"), 50, y);
    y += 20;
    const drawArticlesSortisHeader = () => {
        doc.fontSize(9).fillColor("#666");
        doc.text(pdfText("Date/Heure"), 50, y);
        doc.text(pdfText("Caissier"), 145, y);
        doc.text(pdfText("Article"), 260, y);
        doc.text(pdfText("Qté"), 455, y, { width: 35, align: "right" });
        doc.text(pdfText("Total"), 495, y, { width: 50, align: "right" });
        y += 15;
        doc.moveTo(50, y).lineTo(545, y).stroke("#ddd");
        y += 6;
    };
    drawArticlesSortisHeader();
    articlesSortis.forEach((l) => {
        if (y + 16 > 760) {
            doc.addPage();
            if (PDF_FONT_PATH) {
                doc.font(PDF_FONT_PATH);
            }
            y = 50;
            drawArticlesSortisHeader();
        }
        const dateVente = l.date_vente || "-";
        doc.fontSize(8.5).fillColor("#000");
        doc.text(pdfText(dateVente), 50, y, { width: 95 });
        doc.text(pdfText(l.caissier || "-"), 145, y, { width: 110 });
        doc.text(pdfText(l.article || "-"), 260, y, { width: 185 });
        doc.text(pdfText(l.quantite), 455, y, { width: 35, align: "right" });
        doc.text(pdfText(formatMoney(l.montant)), 495, y, { width: 50, align: "right" });
        y += 14;
    });
    y += 18;
    ensureSpace(36);
    doc.fontSize(13).fillColor("#1a3c5e").text(pdfText("Réapprovisionnements (entrées stock)"), 50, y);
    y += 20;
    const drawReapproHeader = () => {
        doc.fontSize(9).fillColor("#666");
        doc.text(pdfText("Date/Heure"), 50, y);
        doc.text(pdfText("Article"), 145, y);
        doc.text(pdfText("Qté"), 355, y, { width: 35, align: "right" });
        doc.text(pdfText("Fournisseur"), 395, y, { width: 80 });
        doc.text(pdfText("Saisi par"), 480, y, { width: 65 });
        y += 15;
        doc.moveTo(50, y).lineTo(545, y).stroke("#ddd");
        y += 6;
    };
    drawReapproHeader();
    if (!reappros.length) {
        doc.fontSize(9).fillColor("#666").text(pdfText("Aucun réapprovisionnement sur cette période."), 50, y);
        y += 16;
    }
    reappros.forEach((r) => {
        if (y + 16 > 760) {
            doc.addPage();
            if (PDF_FONT_PATH) {
                doc.font(PDF_FONT_PATH);
            }
            y = 50;
            drawReapproHeader();
        }
        doc.fontSize(8.5).fillColor("#000");
        doc.text(pdfText(r.date_mouvement || "-"), 50, y, { width: 90 });
        doc.text(pdfText(r.article || "-"), 145, y, { width: 205 });
        doc.text(pdfText(r.quantite), 355, y, { width: 35, align: "right" });
        doc.text(pdfText(r.fournisseur || "-"), 395, y, { width: 80 });
        doc.text(pdfText(r.utilisateur || "-"), 480, y, { width: 65 });
        y += 14;
    });
    // Par mode paiement
    y += 16;
    ensureSpace(30);
    doc.fontSize(13).fillColor("#1a3c5e").text(pdfText("Répartition par mode de paiement"), 50, y);
    y += 20;
    stats.parPaiement.forEach((p) => {
        ensureSpace(16);
        doc.fontSize(10).fillColor("#000");
        doc.text(pdfText(`${p.mode_paiement}: ${p.nb} ventes - ${formatMoney(p.total)} FCFA`), 50, y);
        y += 15;
    });
    doc.fontSize(8).fillColor("#999")
        .text(pdfText(`Généré le ${new Date().toLocaleString("fr-FR")} - Supermarché étoile du golfe v1.0`), 50, 780, { align: "center" });
    doc.end();
});
// Excel report
router.get("/excel", requireAuth("admin", "gerant"), async (req, res) => {
    const { dateDebut, dateFin } = req.query;
    const debut = dateDebut || new Date().toISOString().split("T")[0];
    const fin = dateFin || debut;
    const reappros = getReapprovisionnements(debut, fin);
    const ventesList = db.select({
        id: ventes.id,
        createdAt: ventes.createdAt,
        caissier: utilisateurs.nom,
        totalTtc: ventes.totalTtc,
        modePaiement: ventes.modePaiement,
        statut: ventes.statut,
        montantRecu: ventes.montantRecu,
        renduMonnaie: ventes.renduMonnaie
    })
        .from(ventes)
        .leftJoin(utilisateurs, eq(ventes.caissierId, utilisateurs.id))
        .where(sql `date(${ventes.createdAt}) between ${debut} and ${fin}`)
        .orderBy(asc(ventes.createdAt))
        .all();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Supermarché étoile du golfe";
    const sheet = workbook.addWorksheet("Ventes");
    sheet.columns = [
        { header: "ID", key: "id", width: 8 },
        { header: "Date/Heure", key: "date", width: 20 },
        { header: "Caissier", key: "caissier", width: 20 },
        { header: "Total TTC (FCFA)", key: "total", width: 18 },
        { header: "Mode paiement", key: "paiement", width: 15 },
        { header: "Statut", key: "statut", width: 12 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3c5e" } };
    ventesList.forEach(v => {
        sheet.addRow({
            id: v.id,
            date: v.createdAt ? new Date(v.createdAt).toLocaleString("fr-FR") : "",
            caissier: v.caissier,
            total: Math.round(v.totalTtc),
            paiement: v.modePaiement,
            statut: v.statut,
        });
    });
    // Stock sheet
    const stockSheet = workbook.addWorksheet("Stock actuel");
    stockSheet.columns = [
        { header: "Article", key: "nom", width: 30 },
        { header: "Catégorie", key: "cat", width: 20 },
        { header: "Stock actuel", key: "stock", width: 14 },
        { header: "Stock minimum", key: "min", width: 14 },
        { header: "Statut", key: "statut", width: 12 },
    ];
    stockSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    stockSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3c5e" } };
    const stockData = db.select({
        nom: articles.nom,
        categorie: categories.nom,
        stockActuel: articles.stockActuel,
        stockMinimum: articles.stockMinimum
    })
        .from(articles)
        .leftJoin(categories, eq(articles.categorieId, categories.id))
        .where(eq(articles.actif, true))
        .orderBy(asc(articles.nom))
        .all();
    stockData.forEach(a => {
        const row = stockSheet.addRow({
            nom: a.nom, cat: a.categorie,
            stock: a.stockActuel, min: a.stockMinimum,
            statut: a.stockActuel <= a.stockMinimum ? "⚠ Alerte" : "OK"
        });
        if (a.stockActuel <= a.stockMinimum) {
            row.getCell("statut").font = { color: { argb: "FFCC0000" }, bold: true };
        }
    });
    const reapproSheet = workbook.addWorksheet("Reapprovisionnements");
    reapproSheet.columns = [
        { header: "Date/Heure", key: "date", width: 22 },
        { header: "Article", key: "article", width: 32 },
        { header: "Quantite", key: "quantite", width: 12 },
        { header: "Fournisseur", key: "fournisseur", width: 24 },
        { header: "Saisi par", key: "utilisateur", width: 22 },
        { header: "Motif", key: "motif", width: 28 },
    ];
    reapproSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    reapproSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3c5e" } };
    reappros.forEach((r) => {
        reapproSheet.addRow({
            date: r.date_mouvement || "-",
            article: r.article || "-",
            quantite: Number(r.quantite) || 0,
            fournisseur: r.fournisseur || "-",
            utilisateur: r.utilisateur || "-",
            motif: r.motif || "Réapprovisionnement",
        });
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-${debut}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
});
export default router;
