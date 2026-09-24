#!/usr/bin/env node
// Find images in the menu-images bucket that no row points at any more and,
// with --delete, remove them. Orphans come from a logo or photo replaced
// before the app cleaned up after itself, an upload whose save then failed,
// or dishes dropped by a menu import.
//
//   pnpm images:prune             list orphans (dry run)
//   pnpm images:prune --delete    remove them
//   pnpm images:prune --grace=0   include files uploaded in the last 15 min
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; the pnpm
// script loads them from .env.local. Unreferenced files newer than the grace
// period are left alone by default, since a form may still be open on them.
import { createClient } from "@supabase/supabase-js";

const BUCKET = "menu-images";
const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`;
const PAGE = 1000;
const REFERENCES = [
  ["restaurants", "logo_url"],
  ["dishes", "image_url"],
  ["restaurant_staff", "avatar_url"],
];

function fail(message) {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
const doDelete = args.includes("--delete");
const graceArg = args.find((a) => a.startsWith("--grace="));
const graceMinutes = graceArg ? Number(graceArg.slice("--grace=".length)) : 15;
if (!Number.isFinite(graceMinutes) || graceMinutes < 0) fail("--grace must be a number of minutes.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (pnpm images:prune reads .env.local).");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listObjects(prefix = "") {
  const found = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Listing ${prefix || "the bucket root"}: ${error.message}`);
    for (const item of data) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        found.push(...(await listObjects(name))); // a folder
      } else {
        found.push({
          name,
          size: item.metadata?.size ?? 0,
          createdAt: new Date(item.created_at),
        });
      }
    }
    if (data.length < PAGE) return found;
  }
}

// Every path some row still points at. Paged, so a menu with more than a
// thousand dishes cannot slip references past us.
async function referencedPaths() {
  const paths = new Set();
  for (const [table, column] of REFERENCES) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(column)
        .not(column, "is", null)
        .range(from, from + PAGE - 1);
      if (error) {
        // A table or column from a migration this database has not run yet.
        if (["PGRST205", "42703", "42P01"].includes(error.code)) {
          console.warn(`Skipping ${table}.${column}: ${error.message}`);
          break;
        }
        throw new Error(`Reading ${table}.${column}: ${error.message}`);
      }
      for (const row of data) {
        const value = row[column];
        const at = typeof value === "string" ? value.indexOf(PUBLIC_PREFIX) : -1;
        if (at !== -1) paths.add(decodeURIComponent(value.slice(at + PUBLIC_PREFIX.length)));
      }
      if (data.length < PAGE) break;
    }
  }
  return paths;
}

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`.padStart(9);
const total = (list) => list.reduce((n, o) => n + o.size, 0);

const objects = await listObjects();
const referenced = await referencedPaths();
const cutoff = Date.now() - graceMinutes * 60 * 1000;
const orphans = [];
const recent = [];
for (const o of objects) {
  if (referenced.has(o.name)) continue;
  (o.createdAt.getTime() > cutoff ? recent : orphans).push(o);
}

console.log(`${objects.length} object(s) in ${BUCKET}, ${referenced.size} referenced by a row.`);
if (recent.length > 0) {
  console.log(
    `\nSkipped ${recent.length} unreferenced file(s) uploaded in the last ${graceMinutes} min ` +
      "(a form may still be open on them; pass --grace=0 to include them):",
  );
  for (const o of recent) console.log(`  ${kb(o.size)}  ${o.name}`);
}
if (orphans.length === 0) {
  console.log("\nNothing to prune.");
  process.exit(0);
}
console.log(`\n${orphans.length} orphaned file(s), ${kb(total(orphans)).trim()}:`);
for (const o of orphans) console.log(`  ${kb(o.size)}  ${o.name}`);

if (!doDelete) {
  console.log("\nDry run. Re-run with --delete to remove them.");
  process.exit(0);
}

let removed = 0;
for (let i = 0; i < orphans.length; i += 100) {
  const batch = orphans.slice(i, i + 100).map((o) => o.name);
  const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
  if (error) throw new Error(`Deleting: ${error.message}`);
  removed += data?.length ?? 0;
}
console.log(`\nRemoved ${removed} file(s), ${kb(total(orphans)).trim()}.`);
