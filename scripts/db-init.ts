// Create tables: npm run db:init
import { readFileSync } from "node:fs";
import { sql } from "../src/lib/db";
const ddl = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
sql().unsafe(ddl).then(() => { console.log("Schema ready"); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
