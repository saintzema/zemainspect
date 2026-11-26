/**
 * GET/POST /api/manual/migrate-data?secret=<MIGRATE_SECRET|CRON_SECRET>&confirm=1
 *
 * One-off, operator-driven DATA migration from the old database (Neon) into the
 * current one (Supabase). Schema is owned by Prisma: `prisma migrate deploy`
 * (run by the Vercel build against the target) creates every table first. This
 * route only COPIES ROWS and reports per-table counts.
 *
 * Connections (both read from env; independent of how the app itself connects):
 *   MIGRATE_SOURCE_URL  — the OLD db (Neon direct/unpooled connection string)
 *   MIGRATE_TARGET_URL  — the NEW db (Supabase pooler). Falls back to DATABASE_URL.
 *
 * FK-safe: the whole target write runs on ONE connection inside a transaction
 * with `session_replication_role = replica`, so foreign-key triggers are off and
 * tables can be truncated + reloaded in any order (this app's models have many
 * FK relations with Cascade/SetNull). `_prisma_migrations` is never touched — the
 * build's migrate deploy already populated it correctly on the target.
 *
 * Idempotent: with ?confirm=1 it truncates every target table and reloads it from
 * source, so re-running converges to an exact copy. Without ?confirm=1 it only
 * reports source/target counts (dry run).
 *
 * Auth: ?secret= (or Authorization: Bearer) must equal MIGRATE_SECRET or CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { Pool, type PoolClient } from "pg";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };

function makePool(url: string): Pool {
  const needsSsl = /supabase\.(co|com)|neon\.tech|sslmode=require/.test(url);
  return new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

interface Col { name: string; dataType: string; }

async function tableColumns(pool: Pool, table: string): Promise<Col[]> {
  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((x: { column_name: string; data_type: string }) => ({ name: x.column_name, dataType: x.data_type }));
}

async function publicTables(pool: Pool): Promise<string[]> {
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
       AND table_name <> '_prisma_migrations'
     ORDER BY table_name`,
  );
  return r.rows.map((x: { table_name: string }) => x.table_name);
}

// pg serializes JS values well for most types; only json/jsonb needs an explicit
// string (an object or array must not be sent as a Postgres composite/array).
function normalizeFor(dataType: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (dataType === "jsonb" || dataType === "json") {
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  return v; // arrays (ARRAY), dates, numbers, bools, enum-as-text, bytea(Buffer)
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }

async function handle(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  const migrateSecret = process.env.MIGRATE_SECRET ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const okAuth =
    (migrateSecret && (secret === migrateSecret || bearer === migrateSecret)) ||
    (cronSecret && (secret === cronSecret || bearer === cronSecret));
  if (!okAuth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const confirm = req.nextUrl.searchParams.get("confirm") === "1";

  const sourceUrl = process.env.MIGRATE_SOURCE_URL || "";
  const targetUrl = process.env.MIGRATE_TARGET_URL || process.env.DATABASE_URL || "";
  if (!sourceUrl) return NextResponse.json({ error: "MIGRATE_SOURCE_URL not set" }, { status: 500 });
  if (!targetUrl) return NextResponse.json({ error: "MIGRATE_TARGET_URL / DATABASE_URL not set" }, { status: 500 });
  if (hostOf(sourceUrl) && hostOf(sourceUrl) === hostOf(targetUrl))
    return NextResponse.json({ error: "source and target resolve to the same host — refusing" }, { status: 400 });

  const source = makePool(sourceUrl);
  const target = makePool(targetUrl);

  const report: Record<string, unknown> = {
    mode: confirm ? "copy" : "dry-run",
    source: hostOf(sourceUrl),
    target: hostOf(targetUrl),
    ts: new Date().toISOString(),
  };
  const tables: Record<string, { source: number; target: number; match: boolean }> = {};
  let allMatch = true;

  try {
    const srcTables = await publicTables(source);

    // ── 1. Copy (FK-safe, single transaction on one target connection) ─────────
    if (confirm) {
      const client: PoolClient = await target.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET session_replication_role = replica");
        // Truncate every target table first (triggers off → order irrelevant).
        if (srcTables.length) {
          await client.query(`TRUNCATE TABLE ${srcTables.map(q).join(",")} CASCADE`);
        }
        for (const t of srcTables) {
          const cols = await tableColumns(target, t);
          const names = cols.map((c) => c.name);
          if (!names.length) continue;
          const src = await source.query(`SELECT ${names.map(q).join(",")} FROM ${q(t)}`);
          if (!src.rows.length) continue;
          const batchSize = Math.max(1, Math.floor(60000 / names.length));
          for (let i = 0; i < src.rows.length; i += batchSize) {
            const slice = src.rows.slice(i, i + batchSize);
            const values: unknown[] = [];
            const tuples = slice.map((row: Record<string, unknown>) => {
              const ph = cols.map((c) => { values.push(normalizeFor(c.dataType, row[c.name])); return `$${values.length}`; });
              return `(${ph.join(",")})`;
            });
            await client.query(`INSERT INTO ${q(t)} (${names.map(q).join(",")}) VALUES ${tuples.join(",")}`, values);
          }
        }
        await client.query("SET session_replication_role = DEFAULT");
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }

    // ── 2. Verify per-table counts ─────────────────────────────────────────────
    for (const t of srcTables) {
      const [s, d] = await Promise.all([
        source.query(`SELECT COUNT(*)::int AS n FROM ${q(t)}`),
        target.query(`SELECT COUNT(*)::int AS n FROM ${q(t)}`),
      ]);
      const sc = s.rows[0]?.n ?? 0;
      const dc = d.rows[0]?.n ?? 0;
      const match = sc === dc;
      if (!match) allMatch = false;
      tables[t] = { source: sc, target: dc, match };
    }
  } catch (e) {
    report.error = String(e instanceof Error ? e.message : e).slice(0, 400);
    allMatch = false;
  } finally {
    await Promise.all([source.end().catch(() => {}), target.end().catch(() => {})]);
  }

  report.tables = tables;
  report.allMatch = allMatch;
  report.ok = allMatch;
  return NextResponse.json(report, { status: allMatch ? 200 : 207 });
}
