import { Router } from "express";
import { execFile } from "node:child_process";
import { db } from "../db/index.js";
import { ventes, lignesVente, articles, utilisateurs, mouvementsStock } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, auditLog } from "../middleware/auth.js";
const router = Router();
const money = (value) => String(Math.round(Number(value) || 0));
function toIsoDateOrUndefined(value) {
    if (value === null || value === undefined)
        return undefined;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    if (typeof value === "number") {
        const ms = value < 1_000_000_000_000 ? value * 1000 : value;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof value === "string") {
        const direct = new Date(value);
        if (!Number.isNaN(direct.getTime()))
            return direct.toISOString();
        const patched = new Date(value.replace(" ", "T"));
        if (!Number.isNaN(patched.getTime()))
            return patched.toISOString();
    }
    return undefined;
}
function buildReceiptText(receipt) {
    const vente = receipt.vente || {};
    const lignes = Array.isArray(receipt.lignes) ? receipt.lignes : [];
    const date = vente.created_at
        ? new Date(vente.created_at).toLocaleString("fr-FR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        })
        : new Date().toLocaleString("fr-FR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
        });
    const mode = (vente.mode_paiement || "especes").toUpperCase();
    const id = String(vente.id || 0).padStart(6, "0");
    const lines = [];
    lines.push("SUPERMARCHE ETOILE DU GOLFE");
    lines.push("--------------------------------");
    lines.push(`Recu N° ${id}`);
    lines.push(date);
    lines.push(`Caissier: ${vente.caissier_nom || "-"}`);
    lines.push("--------------------------------");
    for (const line of lignes) {
        const article = String(line.article_nom || "Article").slice(0, 22);
        const qty = Number(line.quantite || 0);
        const total = money(line.sous_total);
        lines.push(`${article} ${qty} ${total} FCFA`);
    }
    lines.push("--------------------------------");
    lines.push(`TOTAL: ${money(vente.total_ttc)} FCFA`);
    if (mode === "ESPECES" && vente.montant_recu !== undefined && vente.montant_recu !== null) {
        lines.push(`Verse: ${money(vente.montant_recu)} FCFA`);
        lines.push(`Monnaie rendue: ${money(vente.rendu_monnaie)} FCFA`);
    }
    lines.push(`Paiement: ${mode}`);
    lines.push("Merci pour votre achat !");
    lines.push("");
    return lines.join("\r\n");
}
function printViaWindowsDriver(receipt, printerName) {
    if (process.platform !== "win32") {
        throw new Error("L'impression directe par pilote est disponible uniquement sur Windows");
    }
    const safePrinter = (printerName || "").replace(/'/g, "''");
    const receiptJsonBase64 = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64");
    const plainTextBase64 = Buffer.from(buildReceiptText(receipt), "utf8").toString("base64");
    const paperWidthMm = Number(process.env.RECEIPT_PAPER_WIDTH_MM || 80);
    const command = "$ErrorActionPreference='Stop';" +
        "Add-Type -AssemblyName System.Drawing;" +
        `$receiptJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${receiptJsonBase64}'));` +
        `$plainText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${plainTextBase64}'));` +
        "$receipt = $receiptJson | ConvertFrom-Json;" +
        `$paperWidthMm=${paperWidthMm};` +
        "$script:items = @($receipt.lignes);" +
        "$script:titleFont = New-Object System.Drawing.Font('Segoe UI',13,[System.Drawing.FontStyle]::Bold);" +
        "$script:normalFont = New-Object System.Drawing.Font('Segoe UI',9,[System.Drawing.FontStyle]::Regular);" +
        "$script:boldFont = New-Object System.Drawing.Font('Segoe UI',9.5,[System.Drawing.FontStyle]::Bold);" +
        "$script:smallFont = New-Object System.Drawing.Font('Segoe UI',8.5,[System.Drawing.FontStyle]::Regular);" +
        "$lineHeight = 20;" +
        "$paperWidth = [int]([Math]::Round(($paperWidthMm / 25.4) * 100));" +
        "$paperHeight = [int]([Math]::Max(760, (300 + ($script:items.Count * 28))));" +
        "$doc = New-Object System.Drawing.Printing.PrintDocument;" +
        (safePrinter ? `$doc.PrinterSettings.PrinterName = '${safePrinter}';` : "") +
        "$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(12,12,10,10);" +
        "$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt',$paperWidth,$paperHeight);" +
        "$doc.add_PrintPage({ param($sender,$e) " +
        "$g = $e.Graphics; " +
        "$left = 14; $right = $paperWidth - 14; $center = [int](($left + $right)/2); $y = 12; " +
        "$fmtCenter = New-Object System.Drawing.StringFormat; $fmtCenter.Alignment = [System.Drawing.StringAlignment]::Center; " +
        "$fmtRight = New-Object System.Drawing.StringFormat; $fmtRight.Alignment = [System.Drawing.StringAlignment]::Far; " +
        "$g.DrawString('Supermarché étoile du golfe', $script:titleFont, [System.Drawing.Brushes]::Black, [float]$center, [float]$y, $fmtCenter); " +
        "$y += 32; $g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $right, $y); $y += 10; " +
        "$id = [string]$receipt.vente.id; if([string]::IsNullOrWhiteSpace($id)){ $id='0' }; $id = $id.PadLeft(6,'0'); " +
        "$date = if($receipt.vente.created_at){ [DateTime]::Parse([string]$receipt.vente.created_at).ToString('dd/MM/yyyy HH:mm') } else { (Get-Date).ToString('dd/MM/yyyy HH:mm') }; " +
        "$cashier = [string]$receipt.vente.caissier_nom; if([string]::IsNullOrWhiteSpace($cashier)){ $cashier='-' }; " +
        "$g.DrawString(('Reçu N° ' + $id), $script:normalFont, [System.Drawing.Brushes]::Black, [float]$center, [float]$y, $fmtCenter); $y += 22; " +
        "$g.DrawString($date, $script:normalFont, [System.Drawing.Brushes]::Black, [float]$center, [float]$y, $fmtCenter); $y += 22; " +
        "$g.DrawString(('Caissier : ' + $cashier), $script:normalFont, [System.Drawing.Brushes]::Black, [float]$center, [float]$y, $fmtCenter); $y += 18; " +
        "$g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $right, $y); $y += 14; " +
        "$qtyX = $left + [int](($right-$left)*0.56); $priceX = $right; " +
        "foreach($it in $script:items){ " +
        "$name = [string]$it.article_nom; if([string]::IsNullOrWhiteSpace($name)){ $name='Article' }; if($name.Length -gt 20){ $name = $name.Substring(0,20) + '…' }; " +
        "$qty = [string]([int]($it.quantite)); " +
        "$amount = ([math]::Round([double]$it.sous_total)).ToString() + ' FCFA'; " +
        "$g.DrawString($name, $script:normalFont, [System.Drawing.Brushes]::Black, [float]$left, [float]$y); " +
        "$g.DrawString($qty, $script:normalFont, [System.Drawing.Brushes]::Black, [float]$qtyX, [float]$y, $fmtRight); " +
        "$g.DrawString($amount, $script:normalFont, [System.Drawing.Brushes]::Black, [float]$priceX, [float]$y, $fmtRight); " +
        "$y += 22; " +
        "} " +
        "$y += 4; " +
        "$g.DrawLine([System.Drawing.Pens]::Black, $left, $y, $right, $y); " +
        "$y += 10; " +
        "$total = ([math]::Round([double]$receipt.vente.total_ttc)).ToString() + ' FCFA'; " +
        "$g.DrawString('TOTAL', $script:boldFont, [System.Drawing.Brushes]::Black, [float]$left, [float]$y); " +
        "$g.DrawString($total, $script:boldFont, [System.Drawing.Brushes]::Black, [float]$priceX, [float]$y, $fmtRight); " +
        "$y += 26; " +
        "$mode = [string]$receipt.vente.mode_paiement; if([string]::IsNullOrWhiteSpace($mode)){ $mode='ESPECES' }; $mode = $mode.ToUpper(); " +
        "if($mode -eq 'ESPECES' -and $null -ne $receipt.vente.montant_recu){ " +
        "$verse = ([math]::Round([double]$receipt.vente.montant_recu)).ToString() + ' FCFA'; " +
        "$monnaie = ([math]::Round([double]$receipt.vente.rendu_monnaie)).ToString() + ' FCFA'; " +
        "$g.DrawString('Versé', $script:normalFont, [System.Drawing.Brushes]::Black, [float]$left, [float]$y); " +
        "$g.DrawString($verse, $script:normalFont, [System.Drawing.Brushes]::Black, [float]$priceX, [float]$y, $fmtRight); " +
        "$y += 20; " +
        "$g.DrawString('Monnaie rendue', $script:boldFont, [System.Drawing.Brushes]::Black, [float]$left, [float]$y); " +
        "$g.DrawString($monnaie, $script:boldFont, [System.Drawing.Brushes]::Black, [float]$priceX, [float]$y, $fmtRight); " +
        "$y += 24; " +
        "} " +
        "$g.DrawString(('Paiement : ' + $mode), $script:normalFont, [System.Drawing.Brushes]::Black, [float]$left, [float]$y); " +
        "$y += 28; " +
        "$g.DrawString('Merci pour votre achat !', $script:boldFont, [System.Drawing.Brushes]::Black, [float]$center, [float]$y, $fmtCenter); " +
        "$e.HasMorePages = $false; " +
        "});" +
        "try { " +
        "$doc.Print();" +
        "} catch { " +
        (safePrinter
            ? "$plainText | Out-Printer -Name $doc.PrinterSettings.PrinterName;"
            : "$plainText | Out-Printer;") +
        "} finally { " +
        "$doc.Dispose();" +
        "$script:titleFont.Dispose();" +
        "$script:normalFont.Dispose();" +
        "$script:boldFont.Dispose();" +
        "$script:smallFont.Dispose();" +
        "}";
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    return new Promise((resolve, reject) => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true }, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(stderr?.trim() || error.message));
                return;
            }
            resolve();
        });
    });
}
// Create a sale
router.post("/", requireAuth(), async (req, res) => {
    const { lignes, modePaiement, montantRecu } = req.body;
    if (!lignes?.length)
        return res.status(400).json({ error: "Panier vide" });
    try {
        const result = db.transaction((tx) => {
            let totalTtc = 0;
            const lignesDetails = [];
            for (const l of lignes) {
                const art = tx.select({
                    id: articles.id,
                    nom: articles.nom,
                    prixVente: articles.prixVente,
                    stockActuel: articles.stockActuel
                })
                    .from(articles)
                    .where(and(eq(articles.id, l.articleId), eq(articles.actif, true)))
                    .get();
                if (!art)
                    throw new Error(`Article ${l.articleId} non trouvé`);
                if (art.stockActuel < l.quantite)
                    throw new Error(`Stock insuffisant pour ${art.nom}`);
                const sousTotal = art.prixVente * l.quantite;
                totalTtc += sousTotal;
                lignesDetails.push({ ...l, prixUnitaire: art.prixVente, sousTotal, nom: art.nom });
            }
            const renduMonnaie = montantRecu ? Number(montantRecu) - totalTtc : null;
            const vente = tx.insert(ventes).values({
                caissierId: req.user?.id,
                totalTtc,
                modePaiement: modePaiement || "especes",
                montantRecu: montantRecu ? Number(montantRecu) : null,
                renduMonnaie,
                statut: 'validee'
            }).returning().get();
            for (const l of lignesDetails) {
                tx.insert(lignesVente).values({
                    venteId: vente.id,
                    articleId: l.articleId,
                    quantite: l.quantite,
                    prixUnitaire: l.prixUnitaire,
                    sousTotal: l.sousTotal
                }).run();
                tx.update(articles)
                    .set({
                    stockActuel: sql `${articles.stockActuel} - ${l.quantite}`,
                    updatedAt: new Date()
                })
                    .where(eq(articles.id, l.articleId))
                    .run();
                tx.insert(mouvementsStock).values({
                    articleId: l.articleId,
                    type: 'sortie',
                    quantite: l.quantite,
                    userId: req.user?.id,
                    motif: `Vente #${vente.id}`
                }).run();
            }
            return vente;
        });
        await auditLog(req.user?.id, "CREATE_VENTE", "ventes", result.id, { total: result.totalTtc });
        // Fetch full data for response
        const receipt = db.select({
            id: ventes.id,
            caissierId: ventes.caissierId,
            totalTtc: ventes.totalTtc,
            modePaiement: ventes.modePaiement,
            montantRecu: ventes.montantRecu,
            renduMonnaie: ventes.renduMonnaie,
            statut: ventes.statut,
            motifAnnulation: ventes.motifAnnulation,
            createdAt: ventes.createdAt,
            caissier_nom: utilisateurs.nom
        })
            .from(ventes)
            .leftJoin(utilisateurs, eq(ventes.caissierId, utilisateurs.id))
            .where(eq(ventes.id, result.id))
            .get();
        const receiptLines = db.select({
            id: lignesVente.id,
            venteId: lignesVente.venteId,
            articleId: lignesVente.articleId,
            quantite: lignesVente.quantite,
            prixUnitaire: lignesVente.prixUnitaire,
            sousTotal: lignesVente.sousTotal,
            article_nom: articles.nom
        })
            .from(lignesVente)
            .innerJoin(articles, eq(lignesVente.articleId, articles.id))
            .where(eq(lignesVente.venteId, result.id))
            .all();
        // Auto-print directly from the driver when a sale is validated.
        // Do not fail the sale if printer is unavailable.
        let printOk = true;
        let printError;
        try {
            const receiptForPrint = {
                vente: {
                    id: Number(receipt?.id || result.id),
                    total_ttc: receipt?.totalTtc,
                    mode_paiement: receipt?.modePaiement,
                    montant_recu: receipt?.montantRecu ?? undefined,
                    rendu_monnaie: receipt?.renduMonnaie ?? undefined,
                    created_at: toIsoDateOrUndefined(receipt?.createdAt),
                    caissier_nom: receipt?.caissier_nom || undefined,
                },
                lignes: receiptLines.map((line) => ({
                    article_nom: line.article_nom,
                    quantite: line.quantite,
                    sous_total: line.sousTotal,
                })),
            };
            await printViaWindowsDriver(receiptForPrint);
            await auditLog(req.user?.id, "PRINT_RECEIPT_DIRECT", "ventes", result.id, { source: "auto-on-sale" });
        }
        catch (printErr) {
            printOk = false;
            printError = printErr instanceof Error ? printErr.message : "Echec impression";
            console.error("Direct receipt printing failed:", printErr);
        }
        res.status(201).json({ vente: receipt, lignes: receiptLines, print_ok: printOk, print_error: printError });
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// Get sales list
router.get("/", requireAuth("admin", "gerant"), async (req, res) => {
    const { date, caissier, dateDebut, dateFin } = req.query;
    const conditions = [];
    if (date)
        conditions.push(sql `date(${ventes.createdAt}) = ${date}`);
    if (dateDebut)
        conditions.push(sql `date(${ventes.createdAt}) >= ${dateDebut}`);
    if (dateFin)
        conditions.push(sql `date(${ventes.createdAt}) <= ${dateFin}`);
    if (caissier)
        conditions.push(eq(ventes.caissierId, Number(caissier)));
    const query = db.select({
        id: ventes.id,
        caissierId: ventes.caissierId,
        totalTtc: ventes.totalTtc,
        modePaiement: ventes.modePaiement,
        montantRecu: ventes.montantRecu,
        renduMonnaie: ventes.renduMonnaie,
        statut: ventes.statut,
        motifAnnulation: ventes.motifAnnulation,
        createdAt: sql `${ventes.createdAt}`,
        caissier_nom: utilisateurs.nom,
        nb_articles: sql `(SELECT count(*) FROM lignes_vente WHERE vente_id = ${ventes.id})`
    })
        .from(ventes)
        .leftJoin(utilisateurs, eq(ventes.caissierId, utilisateurs.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(ventes.createdAt));
    const rows = (dateDebut || dateFin)
        ? query.all()
        : query.limit(200).all();
    res.json(rows);
});
// Direct print using Windows printer driver (no browser popup)
router.post("/print-direct", requireAuth(), async (req, res) => {
    const { receipt, printerName } = req.body || {};
    if (!receipt?.vente || !Array.isArray(receipt?.lignes)) {
        return res.status(400).json({ error: "Données de reçu invalides" });
    }
    try {
        await printViaWindowsDriver(receipt, typeof printerName === "string" ? printerName : undefined);
        await auditLog(req.user?.id, "PRINT_RECEIPT_DIRECT", "ventes", Number(receipt.vente.id) || undefined, {
            printerName: printerName || "default"
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ error: err.message || "Echec impression directe" });
    }
});
// Get single sale details
router.get("/:id", requireAuth(), async (req, res) => {
    const id = parseInt(req.params.id);
    const vente = db.select({
        id: ventes.id,
        caissierId: ventes.caissierId,
        totalTtc: ventes.totalTtc,
        modePaiement: ventes.modePaiement,
        montantRecu: ventes.montantRecu,
        renduMonnaie: ventes.renduMonnaie,
        statut: ventes.statut,
        motifAnnulation: ventes.motifAnnulation,
        createdAt: ventes.createdAt,
        caissier_nom: utilisateurs.nom
    })
        .from(ventes)
        .leftJoin(utilisateurs, eq(ventes.caissierId, utilisateurs.id))
        .where(eq(ventes.id, id))
        .get();
    if (!vente)
        return res.status(404).json({ error: "Vente non trouvée" });
    const lignes = db.select({
        id: lignesVente.id,
        venteId: lignesVente.venteId,
        articleId: lignesVente.articleId,
        quantite: lignesVente.quantite,
        prixUnitaire: lignesVente.prixUnitaire,
        sousTotal: lignesVente.sousTotal,
        article_nom: articles.nom
    })
        .from(lignesVente)
        .innerJoin(articles, eq(lignesVente.articleId, articles.id))
        .where(eq(lignesVente.venteId, id))
        .all();
    res.json({ vente, lignes });
});
// Cancel a sale (gerant only)
router.patch("/:id/annuler", requireAuth("admin", "gerant"), async (req, res) => {
    const { motif } = req.body;
    const id = parseInt(req.params.id);
    try {
        db.transaction((tx) => {
            const vente = tx.select().from(ventes).where(and(eq(ventes.id, id), eq(ventes.statut, 'validee'))).get();
            if (!vente)
                throw new Error("Vente non trouvée ou déjà annulée");
            tx.update(ventes)
                .set({ statut: 'annulee', motifAnnulation: motif })
                .where(eq(ventes.id, id))
                .run();
            // Restore stock
            const lignes = tx.select().from(lignesVente).where(eq(lignesVente.venteId, id)).all();
            for (const l of lignes) {
                tx.update(articles)
                    .set({ stockActuel: sql `${articles.stockActuel} + ${l.quantite}`, updatedAt: new Date() })
                    .where(eq(articles.id, l.articleId))
                    .run();
                tx.insert(mouvementsStock).values({
                    articleId: l.articleId,
                    type: 'entree',
                    quantite: l.quantite,
                    userId: req.user?.id,
                    motif: `Annulation vente #${id}`
                }).run();
            }
        });
        await auditLog(req.user?.id, "ANNULER_VENTE", "ventes", id, { motif });
        res.json({ ok: true });
    }
    catch (err) {
        if (err.message === "Vente non trouvée ou déjà annulée")
            return res.status(404).json({ error: err.message });
        res.status(400).json({ error: err.message });
    }
});
export default router;
