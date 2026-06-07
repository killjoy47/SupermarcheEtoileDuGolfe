import { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../db/index.js";
import { articles, categories, mouvementsStock } from "../db/schema.js";
import { eq, like, and, or, sql, asc } from "drizzle-orm";
import { requireAuth, auditLog } from "../middleware/auth.js";
const router = Router();
const recentPrintRequests = new Map();
const recentPrintByUser = new Map();
const AZERTY_SYMBOL_TO_DIGIT = {
    "&": "1",
    "é": "2",
    '"': "3",
    "'": "4",
    "(": "5",
    "-": "6",
    "è": "7",
    "_": "8",
    "ç": "9",
    "à": "0",
};
function normalizeScanCode(raw) {
    return raw
        .trim()
        .split("")
        .map((ch) => AZERTY_SYMBOL_TO_DIGIT[ch] ?? ch)
        .join("")
        .replace(/\s+/g, "");
}
// Générer un code-barres unique à partir de l'ID
function genCodeBarre(id) {
    // Prefixe 20 + 10 chiffres d'id + checksum = 13 chiffres (EAN-13)
    const base = String(id).padStart(10, "0");
    // Calcul checksum EAN-13
    let sum = 0;
    const digits = ("20" + base).split("").map(Number);
    for (let i = 0; i < 12; i++)
        sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return "20" + base + check;
}
function parseArticleIdFromBarcode(code) {
    if (!/^\d+$/.test(code) || !code.startsWith("20"))
        return null;
    // Nouveau format attendu: 13 chiffres (20 + 10 chiffres id + check)
    if (code.length === 13) {
        const id = parseInt(code.slice(2, 12), 10);
        return Number.isNaN(id) ? null : id;
    }
    // Compatibilité avec anciens codes déjà générés en 14 chiffres
    if (code.length === 14) {
        const id = parseInt(code.slice(2, 13), 10);
        return Number.isNaN(id) ? null : id;
    }
    return null;
}
function escapePowerShellSingleQuotedString(value) {
    return String(value ?? "").replace(/'/g, "''");
}
function decodePowerShellCliXml(value) {
    if (!value)
        return "";
    let text = String(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/_x000D__x000A_/g, "\n")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    if (!text)
        return "";
    const directError = text.match(/ne contient pas de methode nommee[^.]*|does not contain a method named[^.]*/i);
    if (directError)
        return directError[0];
    return text;
}
async function printBarcodeLabelsViaWindowsDriver(payload, printerName) {
    if (process.platform !== "win32") {
        throw new Error("L'impression directe par pilote est disponible uniquement sur Windows");
    }
    const qty = Math.max(1, Math.min(500, parseInt(payload.qty, 10) || 1));
    for (let i = 0; i < qty; i++) {
        await printSingleBarcodeLabel(payload, printerName);
    }
}
async function printSingleBarcodeLabel(payload, printerName) {
    const barcodeBase64 = String(payload.barcodeImage || "").replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    if (!barcodeBase64) {
        throw new Error("Image code-barres invalide");
    }
    const qty = 1;
    const labelWidthMm = Number(process.env.BARCODE_LABEL_WIDTH_MM || 50);
    const labelHeightMm = Number(process.env.BARCODE_LABEL_HEIGHT_MM || 25);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shopdesk-label-"));
    const barcodePath = path.join(tmpRoot, "barcode.b64.txt");
    const articlePath = path.join(tmpRoot, "article.json");
    try {
        await fs.writeFile(barcodePath, barcodeBase64, "utf8");
        await fs.writeFile(articlePath, JSON.stringify(payload.article || {}), "utf8");
    }
    catch {
        try {
            await fs.rm(tmpRoot, { recursive: true, force: true });
        }
        catch {
            // best effort cleanup
        }
        throw new Error("Impossible de preparer les fichiers d'impression");
    }
    const safePrinter = escapePowerShellSingleQuotedString(printerName);
    const paperWidth = Math.max(40, Math.round((labelWidthMm / 25.4) * 100));
    const paperHeight = Math.max(30, Math.round((labelHeightMm / 25.4) * 100));
    const innerWidth = Math.max(10, paperWidth - 6);
    const innerHeight = Math.max(10, paperHeight - 6);
    const barcodeWidth = Math.max(10, innerWidth - 12);
    const centerX = Number((3 + innerWidth / 2).toFixed(2));
    const titleY = 6;
    const barcodeX = 8;
    const barcodeY = 20;
    const barcodeH = 34;
    const codeY = 60;
    const priceY = 76;
    const command = "$ErrorActionPreference='Stop';" +
        "$ProgressPreference='SilentlyContinue';" +
        "Add-Type -AssemblyName System.Drawing;" +
        "$articleJson = Get-Content -Raw -Encoding UTF8 $env:SHOPDESK_ARTICLE_PATH;" +
        "$article = $articleJson | ConvertFrom-Json;" +
        "$barcodeRaw = (Get-Content -Raw -Encoding UTF8 $env:SHOPDESK_BARCODE_B64_PATH).Trim();" +
        "$barcodeBytes = [System.Convert]::FromBase64String($barcodeRaw);" +
        "$stream = New-Object System.IO.MemoryStream(,$barcodeBytes);" +
        "$barcodeImage = [System.Drawing.Image]::FromStream($stream);" +
        `$qty = ${qty};` +
        `$paperWidth = ${paperWidth};` +
        `$paperHeight = ${paperHeight};` +
        `$innerWidth = ${innerWidth};` +
        `$innerHeight = ${innerHeight};` +
        `$barcodeWidth = ${barcodeWidth};` +
        `$centerX = ${centerX};` +
        `$titleY = ${titleY};` +
        `$barcodeX = ${barcodeX};` +
        `$barcodeY = ${barcodeY};` +
        `$barcodeH = ${barcodeH};` +
        `$codeY = ${codeY};` +
        `$priceY = ${priceY};` +
        "$doc = New-Object System.Drawing.Printing.PrintDocument;" +
        (safePrinter ? `$doc.PrinterSettings.PrinterName = '${safePrinter}';` : "") +
        "$doc.PrinterSettings.Copies = 1;" +
        "$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0);" +
        "$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('BarcodeLabel',$paperWidth,$paperHeight);" +
        "$doc.DefaultPageSettings.Landscape = $false;" +
        "$titleFont = New-Object System.Drawing.Font('Segoe UI',7,[System.Drawing.FontStyle]::Bold);" +
        "$codeFont = New-Object System.Drawing.Font('Consolas',6.5,[System.Drawing.FontStyle]::Regular);" +
        "$priceFont = New-Object System.Drawing.Font('Segoe UI',7,[System.Drawing.FontStyle]::Bold);" +
        "$doc.add_PrintPage({ param($sender,$e) " +
        "$g = $e.Graphics; " +
        "$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality; " +
        "$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; " +
        "$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality; " +
        "$name = [string]$article.nom; if([string]::IsNullOrWhiteSpace($name)){ $name = 'Article' }; if($name.Length -gt 30){ $name = [string]::Concat($name.Substring(0,27),'...') }; " +
        "$code = [string]$article.codeBarre; if([string]::IsNullOrWhiteSpace($code)){ $code = '' }; " +
        "$price = ('{0} FCFA' -f [math]::Round([double]$article.prixVente)); " +
        "$fmtCenter = New-Object System.Drawing.StringFormat; $fmtCenter.Alignment = [System.Drawing.StringAlignment]::Center; $fmtCenter.LineAlignment = [System.Drawing.StringAlignment]::Center; " +
        "$g.DrawRectangle([System.Drawing.Pens]::Gray, 3, 3, $innerWidth, $innerHeight); " +
        "$g.DrawString($name, $titleFont, [System.Drawing.Brushes]::Black, [float]$centerX, [float]$titleY, $fmtCenter); " +
        "$srcHeight = [int]([Math]::Round($barcodeImage.Height * 0.72)); if($srcHeight -lt 1){ $srcHeight = $barcodeImage.Height }; " +
        "$srcRect = New-Object System.Drawing.Rectangle(0, 0, $barcodeImage.Width, $srcHeight); " +
        "$destRect = New-Object System.Drawing.Rectangle($barcodeX, $barcodeY, $barcodeWidth, $barcodeH); " +
        "$g.DrawImage($barcodeImage, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel); " +
        "$g.DrawString($code, $codeFont, [System.Drawing.Brushes]::Black, [float]$centerX, [float]$codeY, $fmtCenter); " +
        "$g.DrawString($price, $priceFont, [System.Drawing.Brushes]::Black, [float]$centerX, [float]$priceY, $fmtCenter); " +
        "$e.HasMorePages = $false; " +
        "});" +
        "try { $doc.Print(); } finally { $doc.Dispose(); $barcodeImage.Dispose(); $stream.Dispose(); $titleFont.Dispose(); $codeFont.Dispose(); $priceFont.Dispose(); }";
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    return new Promise((resolve, reject) => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
            windowsHide: true,
            env: {
                ...process.env,
                SHOPDESK_BARCODE_B64_PATH: barcodePath,
                SHOPDESK_ARTICLE_PATH: articlePath,
            }
        }, async (error, _stdout, stderr) => {
            try {
                await fs.rm(tmpRoot, { recursive: true, force: true });
            }
            catch {
                // best effort cleanup
            }
            if (error) {
                reject(new Error(decodePowerShellCliXml(stderr) || stderr?.trim() || error.message));
                return;
            }
            resolve();
        });
    });
}
// Liste articles
router.get("/", requireAuth(), async (req, res) => {
    const { search, categorie, alerte } = req.query;
    const conditions = [eq(articles.actif, true)];
    if (search) {
        conditions.push(or(like(articles.nom, `%${search}%`), like(articles.codeBarre, `%${search}%`)));
    }
    if (categorie) {
        conditions.push(eq(articles.categorieId, Number(categorie)));
    }
    if (alerte === "1") {
        conditions.push(sql `${articles.stockActuel} <= ${articles.stockMinimum}`);
    }
    const rows = db.select({
        id: articles.id,
        nom: articles.nom,
        categorieId: articles.categorieId,
        categorie_id: articles.categorieId,
        fournisseurId: articles.fournisseurId,
        prixVente: articles.prixVente,
        prix_vente: articles.prixVente,
        prixAchat: articles.prixAchat,
        prix_achat: articles.prixAchat,
        stockActuel: articles.stockActuel,
        stock_actuel: articles.stockActuel,
        stockMinimum: articles.stockMinimum,
        stock_minimum: articles.stockMinimum,
        unite: articles.unite,
        codeBarre: articles.codeBarre,
        code_barre: articles.codeBarre,
        codeQr: articles.codeQr,
        code_qr: articles.codeQr,
        actif: articles.actif,
        createdAt: articles.createdAt,
        created_at: articles.createdAt,
        updatedAt: articles.updatedAt,
        updated_at: articles.updatedAt,
        categorie_nom: categories.nom,
        categorieNom: categories.nom,
        rayon: categories.rayon
    })
        .from(articles)
        .leftJoin(categories, eq(articles.categorieId, categories.id))
        .where(and(...conditions))
        .orderBy(asc(articles.nom))
        .all();
    res.json(rows);
});
// Scan par code-barres ou ID
router.get("/scan/:code", requireAuth(), async (req, res) => {
    const scannedRaw = req.params.code.trim();
    const scannedCode = normalizeScanCode(scannedRaw);
    const scannedDigits = scannedCode.replace(/\D+/g, "");
    const inferredIdRaw = parseArticleIdFromBarcode(scannedRaw);
    const inferredIdNormalized = parseArticleIdFromBarcode(scannedCode);
    const scanConditions = [];
    scanConditions.push(eq(articles.codeBarre, scannedRaw));
    scanConditions.push(eq(articles.codeBarre, scannedCode));
    if (scannedDigits && scannedDigits !== scannedCode) {
        scanConditions.push(eq(articles.codeBarre, scannedDigits));
    }
    scanConditions.push(sql `cast(${articles.id} as text) = ${scannedRaw}`);
    scanConditions.push(sql `cast(${articles.id} as text) = ${scannedCode}`);
    if (scannedDigits && scannedDigits !== scannedCode) {
        scanConditions.push(sql `cast(${articles.id} as text) = ${scannedDigits}`);
    }
    if (inferredIdRaw !== null)
        scanConditions.push(eq(articles.id, inferredIdRaw));
    if (inferredIdNormalized !== null)
        scanConditions.push(eq(articles.id, inferredIdNormalized));
    const article = db.select({
        id: articles.id,
        nom: articles.nom,
        categorieId: articles.categorieId,
        categorie_id: articles.categorieId,
        fournisseurId: articles.fournisseurId,
        prixVente: articles.prixVente,
        prix_vente: articles.prixVente,
        prixAchat: articles.prixAchat,
        prix_achat: articles.prixAchat,
        stockActuel: articles.stockActuel,
        stock_actuel: articles.stockActuel,
        stockMinimum: articles.stockMinimum,
        stock_minimum: articles.stockMinimum,
        unite: articles.unite,
        codeBarre: articles.codeBarre,
        code_barre: articles.codeBarre,
        codeQr: articles.codeQr,
        code_qr: articles.codeQr,
        actif: articles.actif,
        createdAt: articles.createdAt,
        created_at: articles.createdAt,
        updatedAt: articles.updatedAt,
        updated_at: articles.updatedAt,
        categorie_nom: categories.nom
    })
        .from(articles)
        .leftJoin(categories, eq(articles.categorieId, categories.id))
        .where(and(eq(articles.actif, true), or(...scanConditions)))
        .get();
    if (!article)
        return res.status(404).json({ error: "Article non trouvé" });
    res.json(article);
});
// Créer article — formulaire simplifié
router.post("/", requireAuth("admin", "gerant"), async (req, res) => {
    const { nom, categorieId, prixVente, stockActuel, stockMinimum } = req.body;
    if (!nom || !prixVente)
        return res.status(400).json({ error: "Nom et prix de vente requis" });
    try {
        const result = db.transaction((tx) => {
            // Insérer d'abord sans code-barres
            const article = tx.insert(articles).values({
                nom: nom.trim(),
                categorieId: categorieId || null,
                prixVente: prixVente,
                stockActuel: parseInt(stockActuel) || 0,
                stockMinimum: parseInt(stockMinimum) || 5,
                actif: true
            }).returning().get();
            // Générer code-barres basé sur l'ID
            const codeBarre = genCodeBarre(article.id);
            // Mettre à jour avec les codes
            const updatedArticle = tx.update(articles).set({
                codeBarre: codeBarre,
                updatedAt: new Date()
            }).where(eq(articles.id, article.id)).returning().get();
            // Mouvement de stock initial si stock > 0
            if (parseInt(stockActuel) > 0) {
                tx.insert(mouvementsStock).values({
                    articleId: article.id,
                    type: 'entree',
                    quantite: parseInt(stockActuel),
                    userId: req.user?.id,
                    motif: 'Stock initial à la création'
                }).run();
            }
            return updatedArticle;
        });
        await auditLog(req.user?.id, "CREATE_ARTICLE", "articles", result.id, { nom });
        res.status(201).json(result);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Modifier article — nom, prix, quantité (stock)
router.put("/:id", requireAuth("admin", "gerant"), async (req, res) => {
    const { nom, categorieId, prixVente, stockMinimum, stockActuel } = req.body;
    if (!nom || !prixVente)
        return res.status(400).json({ error: "Nom et prix requis" });
    const articleId = parseInt(req.params.id);
    try {
        const result = db.transaction((tx) => {
            // Lire ancien stock pour tracer le mouvement si changement
            const oldArticle = tx.select({ stockActuel: articles.stockActuel })
                .from(articles)
                .where(eq(articles.id, articleId))
                .get();
            if (!oldArticle)
                throw new Error("Article non trouvé");
            const updatedArticle = tx.update(articles).set({
                nom: nom.trim(),
                categorieId: categorieId || null,
                prixVente: prixVente,
                stockMinimum: parseInt(stockMinimum) || 5,
                stockActuel: parseInt(stockActuel),
                updatedAt: new Date()
            }).where(eq(articles.id, articleId)).returning().get();
            // Si la quantité a changé, tracer un ajustement
            const diff = parseInt(stockActuel) - oldArticle.stockActuel;
            if (diff !== 0) {
                tx.insert(mouvementsStock).values({
                    articleId: articleId,
                    type: 'ajustement',
                    quantite: Math.abs(diff),
                    userId: req.user?.id,
                    motif: 'Modification manuelle via catalogue'
                }).run();
            }
            return updatedArticle;
        });
        await auditLog(req.user?.id, "UPDATE_ARTICLE", "articles", articleId, { nom, prixVente, stockActuel });
        res.json(result);
    }
    catch (e) {
        if (e.message === "Article non trouvé")
            return res.status(404).json({ error: e.message });
        res.status(400).json({ error: e.message });
    }
});
// Désactiver (soft delete)
router.delete("/:id", requireAuth("admin", "gerant"), async (req, res) => {
    const id = parseInt(req.params.id);
    db.update(articles).set({ actif: false }).where(eq(articles.id, id)).run();
    await auditLog(req.user?.id, "DELETE_ARTICLE", "articles", id);
    res.json({ ok: true });
});
// Impression directe des étiquettes code-barres
router.post("/print-labels", requireAuth(), async (req, res) => {
    const { article, barcodeImage, qty, printerName } = req.body || {};
    if (!article || !barcodeImage) {
        return res.status(400).json({ error: "Données d'impression incomplètes" });
    }
    const normalizedQty = Math.max(1, Math.min(500, parseInt(qty, 10) || 1));
    const userId = req.user?.id || 0;
    const now = Date.now();
    const previousUserPrint = recentPrintByUser.get(userId) || 0;
    if (now - previousUserPrint < 3_500) {
        return res.json({ ok: true, deduped: true, reason: "user_cooldown" });
    }
    recentPrintByUser.set(userId, now);
    const barcodeKey = String(article.codeBarre || "").trim();
    const articleName = String(article.nom || "").trim();
    const articlePrice = Number(article.prixVente || 0);
    const imageKey = String(barcodeImage || "").slice(0, 160);
    const fingerprint = `${userId}|${articleName}|${barcodeKey}|${articlePrice}|${normalizedQty}|${String(printerName || "").trim()}|${imageKey}`;
    const previous = recentPrintRequests.get(fingerprint) || 0;
    if (now - previous < 30_000) {
        return res.json({ ok: true, deduped: true });
    }
    recentPrintRequests.set(fingerprint, now);
    for (const [key, timestamp] of recentPrintRequests.entries()) {
        if (now - timestamp > 60_000) {
            recentPrintRequests.delete(key);
        }
    }
    for (const [key, timestamp] of recentPrintByUser.entries()) {
        if (now - timestamp > 60_000) {
            recentPrintByUser.delete(key);
        }
    }
    try {
        await printBarcodeLabelsViaWindowsDriver({ article, barcodeImage, qty }, printerName);
        await auditLog(req.user?.id, "PRINT_BARCODE_LABELS", "articles", article.id || null, {
            articleId: article.id || null,
            qty: normalizedQty
        });
        res.json({ ok: true });
    }
    catch (e) {
        recentPrintRequests.delete(fingerprint);
        recentPrintByUser.delete(userId);
        res.status(500).json({ error: e.message });
    }
});
// Stats stock pour dashboard
router.get("/stats/stock", requireAuth("admin", "gerant"), async (_req, res) => {
    const stats = db.select({
        total: sql `count(*)`,
        en_alerte: sql `sum(case when ${articles.stockActuel} <= ${articles.stockMinimum} then 1 else 0 end)`,
        rupture: sql `sum(case when ${articles.stockActuel} = 0 then 1 else 0 end)`,
        valeur_stock: sql `coalesce(sum(${articles.stockActuel} * ${articles.prixVente}), 0)`
    })
        .from(articles)
        .where(eq(articles.actif, true))
        .get();
    res.json(stats);
});
export default router;
