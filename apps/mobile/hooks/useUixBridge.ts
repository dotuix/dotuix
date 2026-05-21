/**
 * hooks/useUixBridge.ts
 *
 * React hook that opens data.db / state.db and dispatches bridge commands.
 * Pass enabled=true after the .uix has been unpacked to start DB initialization.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system";
import * as SQLite from "expo-sqlite";
import type { SQLiteBindParams } from "expo-sqlite";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { bytesToBase64 } from "@/utils/uixPacker";

interface DbRecord {
  id: string;
  type: string;
  body: string;
  created_at: number;
  updated_at: number;
}

interface FindQuery {
  type?: string;
  where?: Record<string, unknown>;
  orderBy?: string | { field: string; direction?: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

interface BridgeMessage {
  __dotuix: true;
  id: number;
  cmd: string;
  payload: Record<string, unknown>;
}

/** Cast an array of unknown values to SQLiteBindParams. */
const bp = (arr: unknown[]): SQLiteBindParams => arr as SQLiteBindParams;

interface TransactionOp {
  op: "insert" | "update" | "delete" | "upsert";
  id?: string;
  type?: string;
  body?: string | Record<string, unknown>;
}

export interface UixBridgeResult {
  ready: boolean;
  error: string | null;
  handleMessage: (raw: string) => Promise<string>;
  serializeStateDb: () => Promise<Uint8Array | null>;
  cleanup: () => Promise<void>;
}

const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite/`;

function nowMs(): number {
  return Date.now();
}

/** Type-safe wrappers to avoid TS2769 when payload values are unknown. */
function dbAll<T>(
  db: SQLite.SQLiteDatabase,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  return db.getAllAsync<T>(sql, params as SQLiteBindParams);
}
function dbFirst<T>(
  db: SQLite.SQLiteDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return db.getFirstAsync<T>(sql, params as SQLiteBindParams);
}
function dbRun(
  db: SQLite.SQLiteDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<SQLite.SQLiteRunResult> {
  return db.runAsync(sql, params as SQLiteBindParams);
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parseDurationMs(s: string): number {
  const num = parseInt(s.slice(0, -1), 10);
  const unit = s.slice(-1);
  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60_000;
    case "h":
      return num * 3_600_000;
    case "d":
      return num * 86_400_000;
    case "y":
      return num * 86_400_000 * 365;
    default:
      return 30 * 86_400_000;
  }
}

function buildWhere(query: FindQuery): [string, unknown[]] {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (query.type) {
    conds.push("type = ?");
    params.push(query.type);
  }
  if (query.where) {
    for (const [key, val] of Object.entries(query.where)) {
      const col = `json_extract(body, '$.${key}')`;
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        for (const [op, opVal] of Object.entries(
          val as Record<string, unknown>,
        )) {
          switch (op) {
            case "eq":
              conds.push(`${col} = ?`);
              params.push(opVal);
              break;
            case "neq":
              conds.push(`${col} != ?`);
              params.push(opVal);
              break;
            case "gt":
              conds.push(`${col} > ?`);
              params.push(opVal);
              break;
            case "gte":
              conds.push(`${col} >= ?`);
              params.push(opVal);
              break;
            case "lt":
              conds.push(`${col} < ?`);
              params.push(opVal);
              break;
            case "lte":
              conds.push(`${col} <= ?`);
              params.push(opVal);
              break;
            case "like":
              conds.push(`${col} LIKE ?`);
              params.push(opVal);
              break;
            case "in": {
              const arr = Array.isArray(opVal) ? opVal : [];
              if (arr.length === 0) {
                conds.push("1 = 0");
              } else {
                conds.push(`${col} IN (${arr.map(() => "?").join(",")})`);
                params.push(...arr);
              }
              break;
            }
            case "is_null":
              conds.push(opVal ? `${col} IS NULL` : `${col} IS NOT NULL`);
              break;
          }
        }
      } else {
        conds.push(`${col} = ?`);
        params.push(val);
      }
    }
  }
  return [conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "", params];
}

function buildSelect(query: FindQuery): [string, unknown[]] {
  const [where, params] = buildWhere(query);
  let sql = `SELECT id, type, body, created_at, updated_at FROM records ${where}`;
  if (query.orderBy) {
    const ob = query.orderBy;
    let col: string,
      dir = "ASC";
    if (typeof ob === "string") {
      col = ob;
    } else {
      col = ob.field;
      dir = ob.direction === "desc" ? "DESC" : "ASC";
    }
    const bodyField = ["id", "type", "created_at", "updated_at"].includes(col)
      ? col
      : `json_extract(body, '$.${col}')`;
    sql += ` ORDER BY ${bodyField} ${dir}`;
  } else {
    sql += " ORDER BY created_at ASC";
  }
  if (query.limit != null) {
    sql += " LIMIT ?";
    params.push(query.limit);
    if (query.offset != null) {
      sql += " OFFSET ?";
      params.push(query.offset);
    }
  } else if (query.offset != null) {
    sql += " LIMIT -1 OFFSET ?";
    params.push(query.offset);
  }
  return [sql, params];
}

export function useUixBridge(
  dataDbBytes: Uint8Array | null,
  stateDbBytes: Uint8Array | null,
  manifest: Record<string, unknown>,
  onTitleChange?: (title: string) => void,
  enabled = false,
): UixBridgeResult {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateDb = useRef<SQLite.SQLiteDatabase | null>(null);
  const dataDb = useRef<SQLite.SQLiteDatabase | null>(null);
  const manifestRef = useRef(manifest);
  const stateDbName = useRef("");
  const dataDbName = useRef("");

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function open() {
      try {
        const appId = (manifest.id as string) || "unknown";
        const sName = `dotuix_state_${appId}.db`;
        const dName = `dotuix_data_${appId}.db`;
        stateDbName.current = sName;
        dataDbName.current = dName;

        await FileSystem.makeDirectoryAsync(SQLITE_DIR, {
          intermediates: true,
        }).catch(() => {});

        const sPath = `${SQLITE_DIR}${sName}`;
        if (
          !(await FileSystem.getInfoAsync(sPath)).exists &&
          stateDbBytes != null &&
          stateDbBytes.length > 0
        ) {
          await FileSystem.writeAsStringAsync(
            sPath,
            bytesToBase64(stateDbBytes),
            {
              encoding: FileSystem.EncodingType.Base64,
            },
          );
        }

        if (dataDbBytes != null && dataDbBytes.length > 0) {
          const dPath = `${SQLITE_DIR}${dName}`;
          if (!(await FileSystem.getInfoAsync(dPath)).exists) {
            await FileSystem.writeAsStringAsync(
              dPath,
              bytesToBase64(dataDbBytes),
              {
                encoding: FileSystem.EncodingType.Base64,
              },
            );
          }
        }

        if (cancelled) return;

        const sConn = await SQLite.openDatabaseAsync(sName);
        // appId is safe: used as manifest id which should be alphanumeric
        const safeAppId = appId.replace(/'/g, "''");
        await sConn.execAsync(
          `CREATE TABLE IF NOT EXISTS records (` +
            `  id TEXT PRIMARY KEY,` +
            `  type TEXT NOT NULL,` +
            `  body TEXT NOT NULL DEFAULT '{}',` +
            `  created_at INTEGER NOT NULL,` +
            `  updated_at INTEGER NOT NULL` +
            `);` +
            `CREATE INDEX IF NOT EXISTS records_type_idx ON records(type);` +
            `CREATE INDEX IF NOT EXISTS records_created_at_idx ON records(created_at);` +
            `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);` +
            `INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');` +
            `INSERT OR IGNORE INTO meta VALUES ('app_id', '${safeAppId}');`,
        );
        const hasDev = await sConn.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) as n FROM meta WHERE key = 'device_id'`,
        );
        if (!hasDev || hasDev.n === 0) {
          await sConn.runAsync(
            `INSERT INTO meta (key, value) VALUES ('device_id', ?)`,
            [newUuid()],
          );
        }
        if (cancelled) {
          await sConn.closeAsync();
          return;
        }
        stateDb.current = sConn;

        if (dataDbBytes != null && dataDbBytes.length > 0) {
          dataDb.current = await SQLite.openDatabaseAsync(dName);
        }
        setReady(true);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    open();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const dispatch = useCallback(
    async (cmd: string, payload: Record<string, unknown>): Promise<unknown> => {
      const s = stateDb.current;
      const d = dataDb.current;
      const m = manifestRef.current;
      const perms: string[] = (m.permissions as string[]) || [];

      switch (cmd) {
        // ── state ─────────────────────────────────────────────────────────────
        case "state_find": {
          if (!s) throw new Error("state.db not open");
          const [sql, params] = buildSelect((payload.query ?? {}) as FindQuery);
          return dbAll<DbRecord>(s, sql, params);
        }
        case "state_get": {
          if (!s) throw new Error("state.db not open");
          const row = await dbFirst<DbRecord>(
            s,
            `SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?`,
            [payload.id],
          );
          if (!row) throw new Error(`Record not found: ${String(payload.id)}`);
          return row;
        }
        case "state_insert": {
          if (!s) throw new Error("state.db not open");
          const id = newUuid(),
            now = nowMs();
          const body =
            typeof payload.body === "string"
              ? payload.body
              : JSON.stringify(payload.body ?? {});
          await dbRun(
            s,
            `INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
            [id, payload.type, body, now, now],
          );
          return {
            id,
            type: payload.type,
            body,
            created_at: now,
            updated_at: now,
          };
        }
        case "state_update": {
          if (!s) throw new Error("state.db not open");
          const now = nowMs();
          const body =
            typeof payload.body === "string"
              ? payload.body
              : JSON.stringify(payload.body ?? {});
          const res = await dbRun(
            s,
            `UPDATE records SET body = ?, updated_at = ? WHERE id = ?`,
            [body, now, payload.id],
          );
          if (res.changes === 0)
            throw new Error(`Record not found: ${String(payload.id)}`);
          return dbFirst<DbRecord>(
            s,
            `SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?`,
            [payload.id],
          );
        }
        case "state_delete": {
          if (!s) throw new Error("state.db not open");
          await dbRun(s, `DELETE FROM records WHERE id = ?`, [payload.id]);
          return null;
        }
        case "state_upsert": {
          if (!s) throw new Error("state.db not open");
          const now = nowMs();
          const body =
            typeof payload.body === "string"
              ? payload.body
              : JSON.stringify(payload.body ?? {});
          const existing = await dbFirst<{ id: string }>(
            s,
            `SELECT id FROM records WHERE id = ?`,
            [payload.id],
          );
          if (existing) {
            await dbRun(
              s,
              `UPDATE records SET body = ?, updated_at = ? WHERE id = ?`,
              [body, now, payload.id],
            );
          } else {
            await dbRun(
              s,
              `INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
              [payload.id, payload.type, body, now, now],
            );
          }
          return dbFirst<DbRecord>(
            s,
            `SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?`,
            [payload.id],
          );
        }
        case "state_clear": {
          if (!s) throw new Error("state.db not open");
          if (payload.record_type) {
            await dbRun(s, `DELETE FROM records WHERE type = ?`, [
              payload.record_type,
            ]);
          } else {
            await dbRun(s, `DELETE FROM records`);
          }
          return null;
        }
        case "state_reset": {
          if (!s) throw new Error("state.db not open");
          await s.execAsync("DELETE FROM records;");
          return null;
        }
        case "state_purge": {
          if (!s) throw new Error("state.db not open");
          const cutoffMs =
            nowMs() - parseDurationMs((payload.older_than as string) || "30d");
          const res = await dbRun(
            s,
            `DELETE FROM records WHERE type = ? AND created_at < ?`,
            [payload.type, cutoffMs],
          );
          return res.changes;
        }
        case "state_count": {
          if (!s) throw new Error("state.db not open");
          const [where, params] = buildWhere(
            (payload.query ?? {}) as FindQuery,
          );
          const row = await dbFirst<{ n: number }>(
            s,
            `SELECT COUNT(*) as n FROM records ${where}`,
            params,
          );
          return row?.n ?? 0;
        }
        case "state_insert_many": {
          if (!s) throw new Error("state.db not open");
          const records = (payload.records as TransactionOp[]) || [];
          const now = nowMs();
          const inserted: DbRecord[] = [];
          await s.withTransactionAsync(async () => {
            for (const r of records) {
              const id = newUuid();
              const body =
                typeof r.body === "string"
                  ? r.body
                  : JSON.stringify(r.body ?? {});
              await dbRun(
                s,
                `INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
                [id, r.type, body, now, now],
              );
              inserted.push({
                id,
                type: r.type!,
                body,
                created_at: now,
                updated_at: now,
              });
            }
          });
          return inserted;
        }
        case "state_transaction": {
          if (!s) throw new Error("state.db not open");
          const ops = (payload.ops as TransactionOp[]) || [];
          const now = nowMs();
          const results: unknown[] = [];
          await s.withTransactionAsync(async () => {
            for (const op of ops) {
              const body =
                typeof op.body === "string"
                  ? op.body
                  : JSON.stringify(op.body ?? {});
              if (op.op === "insert") {
                const id = newUuid();
                await dbRun(
                  s,
                  `INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
                  [id, op.type, body, now, now],
                );
                results.push({
                  id,
                  type: op.type,
                  body,
                  created_at: now,
                  updated_at: now,
                });
              } else if (op.op === "update") {
                await dbRun(
                  s,
                  `UPDATE records SET body = ?, updated_at = ? WHERE id = ?`,
                  [body, now, op.id],
                );
                results.push(
                  await dbFirst<DbRecord>(
                    s,
                    `SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?`,
                    [op.id],
                  ),
                );
              } else if (op.op === "delete") {
                await dbRun(s, `DELETE FROM records WHERE id = ?`, [op.id]);
                results.push(null);
              } else if (op.op === "upsert") {
                const ex = await dbFirst<{ id: string }>(
                  s,
                  `SELECT id FROM records WHERE id = ?`,
                  [op.id],
                );
                if (ex) {
                  await dbRun(
                    s,
                    `UPDATE records SET body = ?, updated_at = ? WHERE id = ?`,
                    [body, now, op.id],
                  );
                } else {
                  await dbRun(
                    s,
                    `INSERT INTO records (id, type, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
                    [op.id, op.type, body, now, now],
                  );
                }
                results.push(
                  await dbFirst<DbRecord>(
                    s,
                    `SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?`,
                    [op.id],
                  ),
                );
              }
            }
          });
          return results;
        }
        case "state_size": {
          if (!s) throw new Error("state.db not open");
          const row = await dbFirst<{ n: number }>(
            s,
            `SELECT COUNT(*) as n FROM records`,
          );
          return row?.n ?? 0;
        }
        case "state_vacuum": {
          if (!s) throw new Error("state.db not open");
          await s.execAsync("VACUUM;");
          return null;
        }
        case "state_raw": {
          if (!s) throw new Error("state.db not open");
          if (!perms.includes("raw-sql"))
            throw new Error("Permission denied: 'raw-sql'");
          return dbAll(
            s,
            payload.sql as string,
            (payload.params as unknown[]) || [],
          );
        }
        // ── data ──────────────────────────────────────────────────────────────
        case "data_find": {
          if (!d) return [];
          const [sql, params] = buildSelect((payload.query ?? {}) as FindQuery);
          return dbAll<DbRecord>(d, sql, params);
        }
        case "data_get": {
          if (!d) throw new Error("data.db not open");
          const row = await dbFirst<DbRecord>(
            d,
            `SELECT id, type, body, created_at, updated_at FROM records WHERE id = ?`,
            [payload.id],
          );
          if (!row) throw new Error(`Record not found: ${String(payload.id)}`);
          return row;
        }
        case "data_count": {
          if (!d) return 0;
          const [where, params] = buildWhere(
            (payload.query ?? {}) as FindQuery,
          );
          const row = await dbFirst<{ n: number }>(
            d,
            `SELECT COUNT(*) as n FROM records ${where}`,
            params,
          );
          return row?.n ?? 0;
        }
        case "data_raw": {
          if (!d) return [];
          if (!perms.includes("raw-sql"))
            throw new Error("Permission denied: 'raw-sql'");
          return dbAll(
            d,
            payload.sql as string,
            (payload.params as unknown[]) || [],
          );
        }
        // ── manifest / system ────────────────────────────────────────────────
        case "get_manifest":
          return m;
        case "clipboard_write": {
          if (!perms.includes("clipboard-write"))
            throw new Error("Permission denied: 'clipboard-write'");
          await Clipboard.setStringAsync(payload.text as string);
          return null;
        }
        case "uix_open_url": {
          const url = payload.url as string;
          if (await Linking.canOpenURL(url)) await Linking.openURL(url);
          return null;
        }
        case "uix_set_title":
        case "uix_set_window_title": {
          if (onTitleChange) onTitleChange(payload.title as string);
          return null;
        }
        case "uix_notify":
          return null;
        case "uix_save_file": {
          const fname = (payload.filename as string) || "download";
          const tmpPath = `${FileSystem.cacheDirectory}${fname}`;
          await FileSystem.writeAsStringAsync(
            tmpPath,
            payload.content_b64 as string,
            {
              encoding: FileSystem.EncodingType.Base64,
            },
          );
          const Sharing = await import("expo-sharing");
          if (await Sharing.isAvailableAsync())
            await Sharing.shareAsync(tmpPath);
          return null;
        }
        case "uix_open_file": {
          const DocumentPicker = await import("expo-document-picker");
          const result = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
          });
          if (result.canceled || !result.assets?.[0]) return null;
          const asset = result.assets[0];
          const b64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { name: asset.name, content_b64: b64 };
        }
        case "uix_exit":
          return null;
        default:
          throw new Error(`Unknown bridge command: ${cmd}`);
      }
    },
    [onTitleChange],
  );

  const handleMessage = useCallback(
    async (raw: string): Promise<string> => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(raw) as BridgeMessage;
      } catch {
        return "true;";
      }
      if (!msg.__dotuix || msg.id == null) return "true;";
      const { id, cmd, payload } = msg;
      try {
        const result = await dispatch(cmd, payload || {});
        const rj = JSON.stringify(result ?? null);
        return `(function(){var p=window._uixPending;if(p&&p[${id}]){p[${id}](true,${rj});delete p[${id}];}})();true;`;
      } catch (e: unknown) {
        const em = (e instanceof Error ? e.message : String(e))
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'");
        return `(function(){var p=window._uixPending;if(p&&p[${id}]){p[${id}](false,'${em}');delete p[${id}];}})();true;`;
      }
    },
    [dispatch],
  );

  const serializeStateDb = useCallback(async (): Promise<Uint8Array | null> => {
    if (!stateDb.current) return null;
    await stateDb.current.closeAsync();
    stateDb.current = null;
    const sPath = `${SQLITE_DIR}${stateDbName.current}`;
    try {
      const b64 = await FileSystem.readAsStringAsync(sPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }, []);

  const cleanup = useCallback(async () => {
    if (stateDb.current) {
      await stateDb.current.closeAsync();
      stateDb.current = null;
    }
    if (dataDb.current) {
      await dataDb.current.closeAsync();
      dataDb.current = null;
    }
  }, []);

  return { ready, error, handleMessage, serializeStateDb, cleanup };
}
