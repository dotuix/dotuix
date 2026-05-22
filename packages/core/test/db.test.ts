import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pack } from "../src/pack.js";
import {
  createState,
  openData,
  openStateFromFile,
  UIXStateDB,
} from "../src/db.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "valid-app");

// ---------------------------------------------------------------------------
// createState — fresh database
// ---------------------------------------------------------------------------

describe("createState — fresh", () => {
  it("returns a UIXStateDB instance", async () => {
    const db = await createState({ uixVersion: "1.0" });
    expect(db).toBeInstanceOf(UIXStateDB);
    db.close();
  });

  it("has an empty records table", async () => {
    const db = await createState({ uixVersion: "1.0" });
    expect(db.find({ type: "test" })).toEqual([]);
    db.close();
  });

  it("exports a valid SQLite file (starts with magic bytes)", async () => {
    const db = await createState({ uixVersion: "1.0" });
    const bytes = db.export();
    const header = new TextDecoder().decode(bytes.slice(0, 15));
    expect(header).toBe("SQLite format 3");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// createState — seed mode
// ---------------------------------------------------------------------------

describe("createState — seed", () => {
  it("loads seed records into the state database", async () => {
    // Create a seed database with one record
    const seed = await createState({ uixVersion: "1.0" });
    seed.insert({ type: "counter", body: { value: 99 } });
    const seedBytes = seed.export();
    seed.close();

    // Load seed into a new state DB
    const db = await createState({ uixVersion: "1.0", seed: seedBytes });
    const rows = db.find({ type: "counter" });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].body).value).toBe(99);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// UIXStateDB — CRUD operations
// ---------------------------------------------------------------------------

describe("UIXStateDB — insert / find / get / update / delete", () => {
  let db: UIXStateDB;

  beforeAll(async () => {
    db = await createState({ uixVersion: "1.0" });
  });

  afterAll(() => {
    db.close();
  });

  it("insert returns an id with type prefix", () => {
    const id = db.insert({
      type: "product",
      body: { name: "كبسة", price: 45 },
    });
    expect(id).toMatch(/^product:/);
  });

  it("find returns records by type", () => {
    const id = db.insert({ type: "cart", body: { items: [] } });
    const rows = db.find({ type: "cart" });
    expect(rows.some((r) => r.id === id)).toBe(true);
  });

  it("get returns a specific record by id", () => {
    const id = db.insert({ type: "order", body: { total: 100 } });
    const row = db.get(id);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
    expect(row!.type).toBe("order");
  });

  it("body is stored and retrieved as a JSON string", () => {
    const id = db.insert({ type: "item", body: { qty: 3, name: "لحم" } });
    const row = db.get(id);
    expect(row).not.toBeNull();
    const body = JSON.parse(row!.body);
    expect(body.qty).toBe(3);
    expect(body.name).toBe("لحم");
  });

  it("created_at and updated_at are numeric timestamps", () => {
    const id = db.insert({ type: "ts_test", body: {} });
    const row = db.get(id)!;
    expect(typeof row.created_at).toBe("number");
    expect(typeof row.updated_at).toBe("number");
    expect(row.created_at).toBeGreaterThan(0);
  });

  it("get returns null for unknown id", () => {
    expect(db.get("nonexistent:id")).toBeNull();
  });

  it("update changes the body", () => {
    const id = db.insert({ type: "session", body: { active: true } });
    db.update(id, { active: false });
    const row = db.get(id)!;
    expect(JSON.parse(row.body).active).toBe(false);
  });

  it("delete removes the record", () => {
    const id = db.insert({ type: "temp", body: {} });
    db.delete(id);
    expect(db.get(id)).toBeNull();
  });

  it("find with where filters on body fields", () => {
    db.insert({ type: "food", body: { category: "مشروبات", name: "قهوة" } });
    db.insert({ type: "food", body: { category: "مقبلات", name: "حمص" } });
    const rows = db.find({ type: "food", where: { category: "مشروبات" } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => JSON.parse(r.body).category === "مشروبات")).toBe(
      true,
    );
  });

  it("find with limit caps the result count", () => {
    for (let i = 0; i < 5; i++) db.insert({ type: "limited", body: { i } });
    const rows = db.find({ type: "limited", limit: 2 });
    expect(rows.length).toBe(2);
  });

  it("find with orderBy created_at orders results", () => {
    db.insert({ type: "ordered", body: {} });
    db.insert({ type: "ordered", body: {} });
    const rows = db.find({ type: "ordered", orderBy: "created_at" });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("find with invalid where key throws", () => {
    expect(() => db.find({ type: "x", where: { "bad key!": "v" } })).toThrow(
      /Invalid field name/,
    );
  });
});

// ---------------------------------------------------------------------------
// UIXStateDB — raw()
// ---------------------------------------------------------------------------

describe("UIXStateDB — raw()", () => {
  it("throws without raw-sql permission", async () => {
    const db = await createState({ uixVersion: "1.0" });
    expect(() => db.raw("SELECT 1")).toThrow(/Permission denied/);
    db.close();
  });

  it("executes SELECT with raw-sql permission", async () => {
    const db = await createState({
      uixVersion: "1.0",
      permissions: ["raw-sql"],
    });
    db.insert({ type: "r", body: { v: 1 } });
    const rows = db.raw("SELECT id FROM records WHERE type = 'r'");
    expect(rows.length).toBeGreaterThan(0);
    db.close();
  });

  it("executes write SQL with raw-sql permission on state", async () => {
    const db = await createState({
      uixVersion: "1.0",
      permissions: ["raw-sql"],
    });
    // raw() on state allows writes
    db.raw(
      "INSERT INTO records (id, type, body) VALUES ('raw:1', 'raw_type', '{}')",
    );
    const row = db.get("raw:1");
    expect(row).not.toBeNull();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// UIXStateDB — purge()
// ---------------------------------------------------------------------------

describe("UIXStateDB — purge()", () => {
  it("deletes nothing for fresh records (not yet old enough)", async () => {
    const db = await createState({ uixVersion: "1.0" });
    db.insert({ type: "log", body: {} });
    const count = db.purge({ type: "log", olderThan: "30d" });
    expect(count).toBe(0);
    db.close();
  });

  it("deletes records older than the cutoff", async () => {
    const db = await createState({
      uixVersion: "1.0",
      permissions: ["raw-sql"],
    });
    db.insert({ type: "old", body: {} });
    // Manually backdate created_at to 2 hours ago
    const past = Math.floor(Date.now() / 1000) - 7200;
    db.raw(`UPDATE records SET created_at = ${past} WHERE type = 'old'`);
    const count = db.purge({ type: "old", olderThan: "1h" });
    expect(count).toBe(1);
    db.close();
  });

  it("throws on invalid duration format", async () => {
    const db = await createState({ uixVersion: "1.0" });
    expect(() => db.purge({ type: "x", olderThan: "invalid" })).toThrow(
      /Invalid duration/,
    );
    db.close();
  });
});

// ---------------------------------------------------------------------------
// export() / round-trip
// ---------------------------------------------------------------------------

describe("UIXStateDB — export and reload", () => {
  it("exported bytes can be reloaded as a seed", async () => {
    const db1 = await createState({ uixVersion: "1.0" });
    db1.insert({ type: "widget", body: { color: "gold" } });
    const bytes = db1.export();
    db1.close();

    const db2 = await createState({ uixVersion: "1.0", seed: bytes });
    const rows = db2.find({ type: "widget" });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].body).color).toBe("gold");
    db2.close();
  });
});

// ---------------------------------------------------------------------------
// openData — archive with no data.db
// ---------------------------------------------------------------------------

describe("openData", () => {
  let tmpDir: string;
  let uixPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dotuix-db-"));
    uixPath = join(tmpDir, "test.uix");
    await pack(FIXTURE, uixPath);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when archive has no data.db", async () => {
    const db = await openData(uixPath);
    expect(db).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// openStateFromFile
// ---------------------------------------------------------------------------

describe("openStateFromFile", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dotuix-state-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens an existing state.db file", async () => {
    // Create a state DB and save it to disk
    const db1 = await createState({ uixVersion: "1.0" });
    db1.insert({ type: "ping", body: { ok: true } });
    const dbPath = join(tmpDir, "state.db");
    writeFileSync(dbPath, db1.export());
    db1.close();

    // Re-open from file
    const db2 = await openStateFromFile(dbPath, { permissions: ["raw-sql"] });
    const rows = db2.find({ type: "ping" });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].body).ok).toBe(true);
    db2.close();
  });
});
