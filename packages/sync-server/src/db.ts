import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "sync.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    app_id     TEXT    NOT NULL,
    record_id  TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app_id, record_id)
  );

  CREATE INDEX IF NOT EXISTS idx_records_app_updated
    ON records (app_id, updated_at);
`);

// ── Types ────────────────────────────────────────────────────────────────────

export interface SyncRecord {
  id: string;
  type: string;
  body: string;
  created_at: number;
  updated_at: number;
  deleted: boolean;
}

// ── Prepared statements ───────────────────────────────────────────────────────

/**
 * Upsert a record. Server keeps its version unless the incoming updated_at is
 * strictly newer (last-write-wins on updated_at).
 */
const upsertStmt = db.prepare(`
  INSERT INTO records (app_id, record_id, type, body, created_at, updated_at, deleted)
  VALUES (@appId, @recordId, @type, @body, @createdAt, @updatedAt, @deleted)
  ON CONFLICT (app_id, record_id) DO UPDATE SET
    type       = CASE WHEN excluded.updated_at > updated_at THEN excluded.type       ELSE type       END,
    body       = CASE WHEN excluded.updated_at > updated_at THEN excluded.body       ELSE body       END,
    updated_at = CASE WHEN excluded.updated_at > updated_at THEN excluded.updated_at ELSE updated_at END,
    deleted    = CASE WHEN excluded.updated_at > updated_at THEN excluded.deleted    ELSE deleted    END
`);

const pullStmt = db.prepare(`
  SELECT record_id AS id, type, body, created_at, updated_at, deleted
  FROM   records
  WHERE  app_id = ? AND updated_at > ?
  ORDER  BY updated_at ASC
`);

// ── Public API ────────────────────────────────────────────────────────────────

/** Push a batch of records; returns how many were processed. */
export function upsertRecords(appId: string, records: SyncRecord[]): number {
  const run = db.transaction(() => {
    for (const r of records) {
      upsertStmt.run({
        appId,
        recordId: r.id,
        type: r.type,
        body: typeof r.body === "string" ? r.body : JSON.stringify(r.body),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deleted: r.deleted ? 1 : 0,
      });
    }
  });
  run();
  return records.length;
}

/** Pull all records for an app updated after `since` (epoch ms). */
export function pullSince(appId: string, since: number): SyncRecord[] {
  const rows = pullStmt.all(appId, since) as Array<{
    id: string;
    type: string;
    body: string;
    created_at: number;
    updated_at: number;
    deleted: number;
  }>;
  return rows.map((r) => ({ ...r, deleted: r.deleted === 1 }));
}
