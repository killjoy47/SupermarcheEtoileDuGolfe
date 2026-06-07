import { db, sqlite } from "./index.js";
import { config, categories, utilisateurs, articles } from "./schema.js";
import bcrypt from "bcryptjs";
async function seed() {
    try {
        console.log("Seeding config...");
        const configData = [
            { cle: 'nom_magasin', valeur: 'Supermarché étoile du golfe' },
            { cle: 'tva_taux', valeur: '18' },
            { cle: 'devise', valeur: 'FCFA' },
            { cle: 'stock_alerte_actif', valeur: 'true' }
        ];
        for (const c of configData) {
            db.insert(config).values(c).onConflictDoNothing().run();
        }
        console.log("Seeding categories...");
        const categoriesData = [
            { nom: 'Alimentation générale', rayon: 'Alimentation' },
            { nom: 'Boissons', rayon: 'Boissons' },
            { nom: 'Parfums & Cosmétiques', rayon: 'Parfums' },
            { nom: 'Équipements électriques', rayon: 'Électrique' },
            { nom: 'Divers', rayon: 'Autres' }
        ];
        for (const cat of categoriesData) {
            db.insert(categories).values(cat).onConflictDoNothing().run();
        }
        console.log("Seeding users...");
        const adminHash = await bcrypt.hash("admin123", 12);
        db.insert(utilisateurs).values({
            nom: 'Administrateur',
            identifiant: 'admin',
            motDePasseHash: adminHash,
            role: 'admin'
        }).onConflictDoNothing().run();
        const gerantHash = await bcrypt.hash("gerant123", 12);
        db.insert(utilisateurs).values({
            nom: 'Gérant Principal',
            identifiant: 'gerant',
            motDePasseHash: gerantHash,
            role: 'gerant'
        }).onConflictDoNothing().run();
        const marieHash = await bcrypt.hash("caissier123", 12);
        db.insert(utilisateurs).values({
            nom: 'Caissière Marie',
            identifiant: 'marie',
            motDePasseHash: marieHash,
            role: 'caissier'
        }).onConflictDoNothing().run();
        console.log("Seeding articles...");
        const articlesData = [
            { nom: 'Riz local 1kg', categorieId: 1, prixVente: 500, prixAchat: 350, stockActuel: 100, stockMinimum: 20, unite: 'kg', codeBarre: '6001001001001' },
            { nom: 'Huile de palme 1L', categorieId: 1, prixVente: 1200, prixAchat: 900, stockActuel: 50, stockMinimum: 10, unite: 'litre', codeBarre: '6001001002001' },
            { nom: 'Sucre 1kg', categorieId: 1, prixVente: 750, prixAchat: 550, stockActuel: 80, stockMinimum: 15, unite: 'kg', codeBarre: '6001001003001' },
            { nom: 'Eau minérale 1.5L', categorieId: 2, prixVente: 400, prixAchat: 280, stockActuel: 120, stockMinimum: 30, unite: 'bouteille', codeBarre: '6001002001001' },
            { nom: 'Coca-Cola 33cl', categorieId: 2, prixVente: 500, prixAchat: 350, stockActuel: 60, stockMinimum: 12, unite: 'canette', codeBarre: '6001002002001' },
            { nom: 'Savon de toilette', categorieId: 3, prixVente: 350, prixAchat: 220, stockActuel: 40, stockMinimum: 10, unite: 'unité', codeBarre: '6001003001001' },
            { nom: 'Ampoule LED 9W', categorieId: 4, prixVente: 1500, prixAchat: 1000, stockActuel: 25, stockMinimum: 5, unite: 'unité', codeBarre: '6001004001001' },
            { nom: 'Farine de blé 1kg', categorieId: 1, prixVente: 600, prixAchat: 420, stockActuel: 70, stockMinimum: 15, unite: 'kg', codeBarre: '6001001004001' }
        ];
        for (const art of articlesData) {
            db.insert(articles).values(art).onConflictDoNothing().run();
        }
        console.log("Seeding completed.");
        console.log("Users: admin/admin123, gerant/gerant123, marie/caissier123");
    }
    catch (error) {
        console.error("Seeding failed:", error);
    }
    finally {
        sqlite.close();
    }
}
seed().catch(console.error);
