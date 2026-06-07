import { sqlite } from "./index.js";
async function migrate() {
    console.log("Creating tables...");
    // SQLite doesn't have a built-in migration tool like pg's "DO $$"
    // but Drizzle can generate migrations. 
    // For a simple app, we can just ensure tables exist.
    sqlite.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      rayon TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS fournisseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      contact TEXT,
      adresse TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      categorie_id INTEGER REFERENCES categories(id),
      fournisseur_id INTEGER REFERENCES fournisseurs(id),
      prix_vente REAL NOT NULL,
      prix_achat REAL,
      stock_actuel INTEGER NOT NULL DEFAULT 0,
      stock_minimum INTEGER NOT NULL DEFAULT 5,
      unite TEXT DEFAULT 'unite',
      code_barre TEXT,
      code_qr TEXT,
      actif INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      identifiant TEXT NOT NULL UNIQUE,
      mot_de_passe_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'caissier',
      actif INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES utilisateurs(id),
      token TEXT NOT NULL UNIQUE,
      ouverture INTEGER DEFAULT (strftime('%s', 'now')),
      fermeture INTEGER
    );

    CREATE TABLE IF NOT EXISTS ventes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caissier_id INTEGER REFERENCES utilisateurs(id),
      total_ttc REAL NOT NULL,
      mode_paiement TEXT NOT NULL DEFAULT 'especes',
      montant_recu REAL,
      rendu_monnaie REAL,
      statut TEXT NOT NULL DEFAULT 'validee',
      motif_annulation TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS lignes_vente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vente_id INTEGER NOT NULL REFERENCES ventes(id),
      article_id INTEGER NOT NULL REFERENCES articles(id),
      quantite INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      sous_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mouvements_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL REFERENCES articles(id),
      type TEXT NOT NULL,
      quantite INTEGER NOT NULL,
      user_id INTEGER REFERENCES utilisateurs(id),
      motif TEXT,
      fournisseur_id INTEGER REFERENCES fournisseurs(id),
      prix_achat REAL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES utilisateurs(id),
      action TEXT NOT NULL,
      entite TEXT,
      entite_id INTEGER,
      details TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cle TEXT NOT NULL UNIQUE,
      valeur TEXT
    );
  `);
    console.log("Migration completed successfully.");
}
migrate().catch(console.error);
