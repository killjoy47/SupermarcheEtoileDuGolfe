import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import path from "path";
import { fileURLToPath } from "url";
const moduleUrl = import.meta.url;
const runtimeDir = moduleUrl
    ? path.dirname(fileURLToPath(moduleUrl))
    : path.dirname(process.argv[1] || process.cwd());
// On place la base de données dans le dossier de l'exécutable ou le dossier racine
const isPkg = process.pkg !== undefined;
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(runtimeDir, "../../../");
const dbPath = process.env.DATABASE_PATH || path.join(baseDir, "data.db");
console.log(`🗄️ Database path: ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL'); // Performance optimization for SQLite
export const db = drizzle(sqlite, { schema });
export { sqlite };
