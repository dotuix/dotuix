/**
 * @dotuix/core — Database layer (Week 2)
 *
 * Opens data.db (read-only) and state.db (read-write) from .uix archives
 * using sql.js (SQLite compiled to WebAssembly, works in Node.js and browser).
 */
import initSqlJs from "sql.js";
import type { Database as SqlDatabase, SqlJsStatic } from "sql.js";
import { readFileSync } from "node:fs";
import { unpackBuffer } from "./unpack.js";
import { parseManifest } from "./manifest.js";
import type { Manifest, UIXRecord, FindQuery } from "./types.js";

// Universal UUID — Web Crypto API works in Node.js 19+ and all modern browsers
const randomUUID = (): string => globalThis.crypto.randomUUID();

// ---------------------------------------------------------------------------
// sql.js initialisation — lazy, cached, shared across all DB operations
// ---------------------------------------------------------------------------

let _sql: SqlJsStatic | null = null;
let _sqlConfig: Parameters<typeof initSqlJs>[0] | undefined;

/**
 * Configure sql.js initialisation options.
 * Must be called **before** any DB operation.
 *
 * In Node.js this is optional — sql.js locates its WASM automatically.
 * In the browser you must point it at the WASM file:
 *
 * ```ts
 * import { configureSqlJs } from '@dotuix/core';
 * configureSqlJs({ locateFile: () => '/sql-wasm.wasm' });
 * ```
 */
export function configureSqlJs(config: Parameters<typeof initSqlJs>[0]): void {
  if (_sql) {
    throw new Error(
      "@dotuix/core: sql.js is already initialised — call configureSqlJs() before any DB operation",
    );
  }
  _sqlConfig = config;
}

async function getSql(): Promise<SqlJsStatic> {
  if (_sql) return _sql;
  _sql = await initSqlJs(_sqlConfig);
  return _sql;
}

// ---------------------------------------------------------------------------
// DDL — format-defined schema, never changes without a format version bump
// ---------------------------------------------------------------------------

const DDL_RECORDS = `
  CREATE TABLE IF NOT EXISTS records (
    id         TEXT    PRIMARY KEY,
    type       TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_type       ON records (type);
  CREATE INDEX IF NOT EXISTS idx_created_at ON records (created_at);
`;

const DDL_META = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const TOP_LEVEL_COLS = new Set(["id", "type", "created_at", "updated_at"]);
const SAFE_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(
      `Invalid field name "${key}" — use alphanumeric characters and underscores only`,
    );
  }
}

type SqlParam = string | number | null;

function buildFindQuery(query: FindQuery): { sql: string; params: SqlParam[] } {
  const params: SqlParam[] = [query.type];
  let sql =
    "SELECT id, type, body, created_at, updated_at FROM records WHERE type = ?";

  for (const [key, value] of Object.entries(query.where ?? {})) {
    assertSafeKey(key);
    sql += ` AND json_extract(body, '$.${key}') = ?`;
    params.push(value == null ? null : String(value));
  }

  if (query.orderBy) {
    if (TOP_LEVEL_COLS.has(query.orderBy)) {
      sql += ` ORDER BY ${query.orderBy}`;
    } else {
      assertSafeKey(query.orderBy);
      sql += ` ORDER BY json_extract(body, '$.${query.orderBy}')`;
    }
  }

  if (query.limit != null) {
    sql += " LIMIT ?";
    params.push(query.limit);
  }

  return { sql, params };
}

function toRecord(row: Record<string, unknown>): UIXRecord {
  return {
    id: row["id"] as string,
    type: row["type"] as string,
    body: row["body"] as string,
    created_at: row["created_at"] as number,
    updated_at: row["updated_at"] as number,
  };
}

function runSelect(
  db: SqlDatabase,
  sql: string,
  params: SqlParam[] = [],
): UIXRecord[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params as (string | number | null | Uint8Array)[]);
    const rows: UIXRecord[] = [];
    while (stmt.step()) {
      rows.push(toRecord(stmt.getAsObject() as Record<string, unknown>));
    }
    return rows;
  } catch (err) {
    throw new Error(`SQL error: ${(err as Error).message}`);
  } finally {
    stmt.free();
  }
}

function parseDuration(duration: string): number {
  const match = /^(\d+)(h|d|m|y)$/.exec(duration);
  if (!match) {
    throw new Error(
      `Invalid duration "${duration}" — expected format like "30d", "12h", "1y"`,
    );
  }
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    case "m":
      return n * 2592000; // 30 days
    case "y":
      return n * 31536000; // 365 days
    default:
      throw new Error(`Unknown unit: ${match[2]}`);
  }
}

// ---------------------------------------------------------------------------
// UIXDataDB — read-only bridge surface for data.db
// ---------------------------------------------------------------------------

export class UIXDataDB {
  readonly #db: SqlDatabase;
  readonly #permissions: ReadonlySet<string>;

  /** @internal — use openData() / openDataBuffer() */
  constructor(db: SqlDatabase, permissions: string[]) {
    this.#db = db;
    this.#permissions = new Set(permissions);
  }

  /** Find records by type, with optional field filters and ordering. */
  find(query: FindQuery): UIXRecord[] {
    const { sql, params } = buildFindQuery(query);
    return runSelect(this.#db, sql, params);
  }

  /** Get a single record by id, or null if not found. */
  get(id: string): UIXRecord | null {
    const rows = runSelect(
      this.#db,
      "SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?",
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Execute raw SQL against data.db.
   * Restricted to SELECT/WITH statements. Requires "raw-sql" in manifest permissions.
   */
  raw(sql: string, params: SqlParam[] = []): UIXRecord[] {
    if (!this.#permissions.has("raw-sql")) {
      throw new Error(
        'Permission denied — declare "raw-sql" in manifest permissions to use raw()',
      );
    }
    const keyword =
      sql
        .trimStart()
        .match(/^(\w+)/)?.[1]
        ?.toUpperCase() ?? "";
    if (keyword !== "SELECT" && keyword !== "WITH") {
      throw new Error(
        "raw() on data.db is read-only — only SELECT and WITH statements are allowed",
      );
    }
    return runSelect(this.#db, sql, params);
  }

  close(): void {
    this.#db.close();
  }
}

// ---------------------------------------------------------------------------
// UIXStateDB — read-write bridge surface for state.db
// ---------------------------------------------------------------------------

export class UIXStateDB {
  readonly #db: SqlDatabase;
  readonly #permissions: ReadonlySet<string>;

  /** @internal — use createState() */
  constructor(db: SqlDatabase, permissions: string[]) {
    this.#db = db;
    this.#permissions = new Set(permissions);
  }

  /** Find records by type, with optional field filters and ordering. */
  find(query: FindQuery): UIXRecord[] {
    const { sql, params } = buildFindQuery(query);
    return runSelect(this.#db, sql, params);
  }

  /** Get a single record by id, or null if not found. */
  get(id: string): UIXRecord | null {
    const rows = runSelect(
      this.#db,
      "SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?",
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Insert a new record. `created_at` and `updated_at` are set automatically.
   * @returns The generated record id (`{type}:{uuid}`).
   */
  insert(record: { type: string; body: unknown }): string {
    const id = `${record.type}:${randomUUID()}`;
    this.#db.run("INSERT INTO records (id, type, body) VALUES (?, ?, ?)", [
      id,
      record.type,
      JSON.stringify(record.body),
    ]);
    return id;
  }

  /** Update a record's body. `updated_at` is bumped to the current unix timestamp. */
  update(id: string, body: unknown): void {
    this.#db.run(
      "UPDATE records SET body = ?, updated_at = unixepoch() WHERE id = ?",
      [JSON.stringify(body), id],
    );
  }

  /** Delete a record by id. */
  delete(id: string): void {
    this.#db.run("DELETE FROM records WHERE id = ?", [id]);
  }

  /**
   * Execute raw SQL against state.db. Reads and writes are both allowed.
   * Requires "raw-sql" in manifest permissions.
   */
  raw(sql: string, params: SqlParam[] = []): UIXRecord[] {
    if (!this.#permissions.has("raw-sql")) {
      throw new Error(
        'Permission denied — declare "raw-sql" in manifest permissions to use raw()',
      );
    }
    return runSelect(this.#db, sql, params);
  }

  /**
   * Delete records of a given type older than a duration.
   * Duration format: '30d', '12h', '1y'.
   * @returns Number of records deleted.
   */
  purge(query: { type: string; olderThan: string }): number {
    const cutoff =
      Math.floor(Date.now() / 1000) - parseDuration(query.olderThan);
    this.#db.run("DELETE FROM records WHERE type = ? AND created_at < ?", [
      query.type,
      cutoff,
    ]);
    return this.#db.getRowsModified();
  }

  /**
   * Serialize the database to bytes for repacking into the .uix archive.
   * Call this just before closing to get the latest state.
   */
  export(): Uint8Array {
    return this.#db.export();
  }

  close(): void {
    this.#db.close();
  }
}

// ---------------------------------------------------------------------------
// State DB schema bootstrap
// ---------------------------------------------------------------------------

function ensureStateSchema(db: SqlDatabase, uixVersion: string): void {
  db.run(DDL_RECORDS);
  db.run(DDL_META);
  db.run("INSERT OR IGNORE INTO meta VALUES ('schema_version', '1')");
  db.run("INSERT OR IGNORE INTO meta VALUES ('created_at', ?)", [
    new Date().toISOString(),
  ]);
  db.run("INSERT OR IGNORE INTO meta VALUES ('uix_version', ?)", [uixVersion]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open data.db from a .uix archive on disk (Node.js).
 * Returns null if the archive contains no data.db.
 */
export async function openData(
  uixPath: string,
  opts: { permissions?: string[] } = {},
): Promise<UIXDataDB | null> {
  const data = new Uint8Array(readFileSync(uixPath));
  return openDataBuffer(data, opts);
}

/**
 * Open data.db from a .uix buffer (universal — works in browser too).
 * Returns null if the archive contains no data.db.
 */
export async function openDataBuffer(
  uixData: Uint8Array,
  opts: { permissions?: string[] } = {},
): Promise<UIXDataDB | null> {
  const SQL = await getSql();
  const files = unpackBuffer(uixData);
  if (!files["data.db"]) return null;
  const db = new SQL.Database(files["data.db"]);
  return new UIXDataDB(db, opts.permissions ?? []);
}

export interface CreateStateOptions {
  /** Format version from manifest.uix, e.g. "1.0" */
  uixVersion: string;
  /**
   * Seed bytes from the archive — used when manifest.state.seed = true.
   * If provided, this becomes the starting state. Otherwise a fresh DB is created.
   */
  seed?: Uint8Array;
  /** Permissions from manifest.permissions */
  permissions?: string[];
}

/**
 * Create or load a state.db in memory.
 *
 * - If `opts.seed` is provided, it is loaded as the starting state (seed mode).
 * - Otherwise, a fresh empty database is created.
 * - The records/meta schema is ensured on both paths.
 *
 * Call `stateDb.export()` to get the bytes for repacking into the .uix archive.
 */
export async function createState(
  opts: CreateStateOptions,
): Promise<UIXStateDB> {
  const SQL = await getSql();
  const db = opts.seed ? new SQL.Database(opts.seed) : new SQL.Database();
  ensureStateSchema(db, opts.uixVersion);
  return new UIXStateDB(db, opts.permissions ?? []);
}

/**
 * Open an existing state.db file from disk (Node.js).
 * Intended for CLI operations like `dotuix export`.
 */
export async function openStateFromFile(
  statePath: string,
  opts: { permissions?: string[] } = {},
): Promise<UIXStateDB> {
  const SQL = await getSql();
  const data = new Uint8Array(readFileSync(statePath));
  const db = new SQL.Database(data);
  return new UIXStateDB(db, opts.permissions ?? []);
}

// ---------------------------------------------------------------------------
// Manifest helpers (kept here for index.ts export compatibility)
// ---------------------------------------------------------------------------

const _decoder = new TextDecoder();

export async function readManifest(uixPath: string): Promise<Manifest> {
  const data = new Uint8Array(readFileSync(uixPath));
  return readManifestFromBuffer(data);
}

export function readManifestFromBuffer(data: Uint8Array): Manifest {
  const files = unpackBuffer(data);
  if (!files["manifest.json"]) {
    throw new Error("manifest.json not found in archive");
  }
  const raw = JSON.parse(_decoder.decode(files["manifest.json"]));
  return parseManifest(raw);
}
