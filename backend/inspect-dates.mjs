import { db } from "./dist/db/index.js";
import { ventes, lignesVente, articles, utilisateurs } from "./dist/db/schema.js";
import { eq, and, sql, desc, asc } from "drizzle-orm";

const rows = db.select({
  date_vente: ventes.createdAt,
  caissier: utilisateurs.nom,
  article: articles.nom,
  quantite: lignesVente.quantite,
  montant: lignesVente.sousTotal,
})
.from(lignesVente)
.innerJoin(ventes, eq(lignesVente.venteId, ventes.id))
.innerJoin(articles, eq(lignesVente.articleId, articles.id))
.leftJoin(utilisateurs, eq(ventes.caissierId, utilisateurs.id))
.where(and(eq(ventes.statut, "validee"), sql`date(${ventes.createdAt}) between ${"2026-05-06"} and ${"2026-06-04"}`))
.orderBy(desc(ventes.createdAt), asc(articles.nom))
.limit(15)
.all();

for (const r of rows) {
  const v = r.date_vente;
  console.log(JSON.stringify({ raw: v, typeof: typeof v, ctor: v?.constructor?.name, str: String(v) }));
}
