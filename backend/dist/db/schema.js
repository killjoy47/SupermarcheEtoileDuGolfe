import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const categories = sqliteTable("categories", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nom: text("nom").notNull(),
    rayon: text("rayon").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const fournisseurs = sqliteTable("fournisseurs", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nom: text("nom").notNull(),
    contact: text("contact"),
    adresse: text("adresse"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const articles = sqliteTable("articles", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nom: text("nom").notNull(),
    categorieId: integer("categorie_id").references(() => categories.id),
    fournisseurId: integer("fournisseur_id").references(() => fournisseurs.id),
    prixVente: real("prix_vente").notNull(),
    prixAchat: real("prix_achat"),
    stockActuel: integer("stock_actuel").notNull().default(0),
    stockMinimum: integer("stock_minimum").notNull().default(5),
    unite: text("unite").default("unite"),
    codeBarre: text("code_barre"),
    codeQr: text("code_qr"),
    actif: integer("actif", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const utilisateurs = sqliteTable("utilisateurs", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nom: text("nom").notNull(),
    identifiant: text("identifiant").notNull().unique(),
    motDePasseHash: text("mot_de_passe_hash").notNull(),
    role: text("role").notNull().default("caissier"), // 'admin', 'gerant', 'caissier'
    actif: integer("actif", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const sessions = sqliteTable("sessions", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => utilisateurs.id).notNull(),
    token: text("token").notNull().unique(),
    ouverture: integer("ouverture", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
    fermeture: integer("fermeture", { mode: "timestamp" }),
});
export const ventes = sqliteTable("ventes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    caissierId: integer("caissier_id").references(() => utilisateurs.id),
    totalTtc: real("total_ttc").notNull(),
    modePaiement: text("mode_paiement").notNull().default("especes"), // 'especes', 'momo', 'flooz', 'carte'
    montantRecu: real("montant_recu"),
    renduMonnaie: real("rendu_monnaie"),
    statut: text("statut").notNull().default("validee"), // 'validee', 'annulee'
    motifAnnulation: text("motif_annulation"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const lignesVente = sqliteTable("lignes_vente", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    venteId: integer("vente_id").references(() => ventes.id).notNull(),
    articleId: integer("article_id").references(() => articles.id).notNull(),
    quantite: integer("quantite").notNull(),
    prixUnitaire: real("prix_unitaire").notNull(),
    sousTotal: real("sous_total").notNull(),
});
export const mouvementsStock = sqliteTable("mouvements_stock", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id").references(() => articles.id).notNull(),
    type: text("type").notNull(), // 'entree', 'sortie', 'ajustement'
    quantite: integer("quantite").notNull(),
    userId: integer("user_id").references(() => utilisateurs.id),
    motif: text("motif"),
    fournisseurId: integer("fournisseur_id").references(() => fournisseurs.id),
    prixAchat: real("prix_achat"),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const auditLogs = sqliteTable("audit_logs", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => utilisateurs.id),
    action: text("action").notNull(),
    entite: text("entite"),
    entiteId: integer("entite_id"),
    details: text("details", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).default(sql `CURRENT_TIMESTAMP`),
});
export const config = sqliteTable("config", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cle: text("cle").notNull().unique(),
    valeur: text("valeur"),
});
