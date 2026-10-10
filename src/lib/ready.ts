/** Call at the top of every server page / API route: guarantees schema + first-run demo data. */
import { getDb } from "./db";
import { ensureSeeded } from "./seed/seed";

export async function ready() {
  await getDb();
  await ensureSeeded();
}
