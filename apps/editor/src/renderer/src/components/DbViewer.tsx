import React, { useState, useCallback, useEffect } from "react";
import type { DbRecord } from "../../../preload/index";

interface Props {
  projectDir: string | null;
}

type DbTarget = "data" | "state";

function bodyPreview(body: string): string {
  try {
    const obj = JSON.parse(body) as Record<string, unknown>;
    return Object.entries(obj)
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("  ·  ");
  } catch {
    return body.slice(0, 80);
  }
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DbViewer({ projectDir }: Props) {
  const [activeDb, setActiveDb] = useState<DbTarget>("data");
  const [records, setRecords] = useState<DbRecord[]>([]);
  const [dbExists, setDbExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingRecord, setAddingRecord] = useState(false);
  const [addType, setAddType] = useState("");
  const [addBody, setAddBody] = useState("{}");
  const [addError, setAddError] = useState("");

  const dbPath = useCallback(
    (target: DbTarget) => (projectDir ? `${projectDir}/${target}.db` : null),
    [projectDir],
  );

  const load = useCallback(
    async (target: DbTarget = activeDb) => {
      const path = dbPath(target);
      if (!path) return;
      setLoading(true);
      setError(null);
      try {
        const result = await window.api.dbLoadAll(path);
        setDbExists(result.exists);
        setRecords(result.records);
        setTypeFilter("all");
        setExpandedId(null);
        setAddingRecord(false);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeDb, dbPath],
  );

  useEffect(() => {
    if (projectDir) load(activeDb);
  }, [projectDir, activeDb]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchDb = (target: DbTarget) => {
    setActiveDb(target);
    setExpandedId(null);
    setEditError("");
    setAddingRecord(false);
  };

  const types = [
    "all",
    ...Array.from(new Set(records.map((r) => r.type))).sort(),
  ];
  const filtered =
    typeFilter === "all"
      ? records
      : records.filter((r) => r.type === typeFilter);

  const toggleExpand = (r: DbRecord) => {
    if (expandedId === r.id) {
      setExpandedId(null);
      setEditError("");
    } else {
      setExpandedId(r.id);
      setEditBody(prettyBody(r.body));
      setEditError("");
    }
  };

  const handleSave = async (id: string) => {
    const path = dbPath(activeDb);
    if (!path) return;
    try {
      JSON.parse(editBody);
    } catch {
      setEditError("Invalid JSON");
      return;
    }
    setSaving(true);
    try {
      await window.api.dbUpdateRecord(path, id, editBody);
      await load();
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const path = dbPath(activeDb);
    if (!path) return;
    setSaving(true);
    try {
      await window.api.dbDeleteRecord(path, id);
      await load();
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const path = dbPath("state");
    if (!path) return;
    if (!addType.trim()) {
      setAddError("Type is required");
      return;
    }
    try {
      JSON.parse(addBody);
    } catch {
      setAddError("Invalid JSON body");
      return;
    }
    setSaving(true);
    try {
      await window.api.dbInsertRecord(path, addType.trim(), addBody);
      setAddingRecord(false);
      setAddType("");
      setAddBody("{}");
      setAddError("");
      await load("state");
    } catch (e) {
      setAddError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── No project open ──────────────────────────────────────────────────────
  if (!projectDir) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-[#444]">Open a project folder first</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col text-xs text-[#d4d4d4]">
      {/* ── DB selector tabs ── */}
      <div className="flex shrink-0 border-b border-[#2d2d2d]">
        {(["data", "state"] as const).map((db) => (
          <button
            key={db}
            onClick={() => switchDb(db)}
            className={`flex items-center gap-1.5 px-3 py-2 font-medium transition-colors ${
              activeDb === db
                ? "text-white border-b border-[#569cd6]"
                : "text-[#858585] hover:text-[#ccc]"
            }`}
          >
            <span className="text-[10px]">{db === "data" ? "🔒" : "✏️"}</span>
            <span>{db}.db</span>
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => load()}
          title="Refresh"
          className="px-3 py-2 text-[#858585] hover:text-white transition-colors text-base leading-none"
        >
          ↻
        </button>
      </div>

      {/* ── Type filter chips ── */}
      {records.length > 0 && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-[#2d2d2d] shrink-0 overflow-x-auto">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                typeFilter === t
                  ? "bg-[#264f78] text-white"
                  : "bg-[#2d2d2d] text-[#858585] hover:bg-[#383838] hover:text-[#ccc]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* ── Records list ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-20 text-[#555]">
            Loading…
          </div>
        )}

        {!loading && error && (
          <div className="p-3 text-[#f48771] break-all">{error}</div>
        )}

        {!loading && !error && !dbExists && (
          <div className="flex flex-col items-center justify-center h-28 gap-1.5 text-[#444]">
            <span className="text-2xl opacity-30">🗄</span>
            <p>{activeDb}.db not found in project</p>
            <p className="text-[10px] text-[#333]">
              It will be created when the app first runs
            </p>
          </div>
        )}

        {!loading && !error && dbExists && filtered.length === 0 && (
          <div className="flex items-center justify-center h-20 text-[#444]">
            {records.length === 0 ? "No records" : "No records of this type"}
          </div>
        )}

        {!loading &&
          !error &&
          filtered.map((record) => (
            <div key={record.id}>
              {/* Row */}
              <button
                onClick={() => toggleExpand(record)}
                className={`w-full text-left flex items-start gap-2 px-3 py-2 border-b border-[#1e1e1e] hover:bg-[#2a2d2e] transition-colors ${
                  expandedId === record.id ? "bg-[#2a2d2e]" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[#9cdcfe] font-mono text-[10px] truncate flex-1">
                      {record.id}
                    </span>
                    <span className="text-[#555] text-[10px] shrink-0">
                      {formatTs(record.created_at)}
                    </span>
                  </div>
                  <div className="text-[#4ec9b0] mt-0.5">{record.type}</div>
                  <div className="text-[#858585] truncate mt-0.5">
                    {bodyPreview(record.body)}
                  </div>
                </div>
                <span className="text-[#555] mt-1 shrink-0 text-[10px]">
                  {expandedId === record.id ? "▲" : "▼"}
                </span>
              </button>

              {/* Expanded body */}
              {expandedId === record.id && (
                <div className="px-3 py-2.5 bg-[#1a1a1a] border-b border-[#2d2d2d]">
                  <textarea
                    className={`w-full h-40 font-mono text-[11px] bg-[#141414] border rounded px-2 py-1.5 resize-y focus:outline-none leading-relaxed ${
                      editError
                        ? "border-[#f48771]"
                        : "border-[#3e3e3e] focus:border-[#569cd6]"
                    } text-[#d4d4d4]`}
                    value={editBody}
                    onChange={(e) => {
                      setEditBody(e.target.value);
                      setEditError("");
                    }}
                    readOnly={activeDb === "data"}
                    spellCheck={false}
                  />
                  {editError && (
                    <p className="text-[#f48771] mt-1">{editError}</p>
                  )}

                  {activeDb === "state" ? (
                    <div className="flex gap-2 mt-2 items-center">
                      <button
                        onClick={() => handleSave(record.id)}
                        disabled={saving}
                        className="px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded disabled:opacity-50 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setExpandedId(null);
                          setEditError("");
                        }}
                        className="px-3 py-1 bg-[#2d2d2d] hover:bg-[#383838] text-[#ccc] rounded transition-colors"
                      >
                        Cancel
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => handleDelete(record.id)}
                        disabled={saving}
                        className="px-3 py-1 bg-[#2d1b1b] hover:bg-[#5a1d1d] text-[#f48771] rounded disabled:opacity-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <p className="text-[#444] mt-1.5 text-[10px]">
                      data.db is read-only at runtime
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-[#2d2d2d] px-3 py-2">
        {addingRecord ? (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input
                placeholder="type  e.g. product"
                value={addType}
                onChange={(e) => {
                  setAddType(e.target.value);
                  setAddError("");
                }}
                className="w-36 px-2 py-1 bg-[#141414] border border-[#3e3e3e] rounded text-[#d4d4d4] placeholder-[#444] focus:outline-none focus:border-[#569cd6]"
              />
              <textarea
                placeholder="{}"
                value={addBody}
                onChange={(e) => {
                  setAddBody(e.target.value);
                  setAddError("");
                }}
                className="flex-1 h-14 px-2 py-1 bg-[#141414] border border-[#3e3e3e] rounded text-[#d4d4d4] font-mono resize-none focus:outline-none focus:border-[#569cd6]"
                spellCheck={false}
              />
            </div>
            {addError && <p className="text-[#f48771]">{addError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-3 py-1 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded disabled:opacity-50 transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingRecord(false);
                  setAddType("");
                  setAddBody("{}");
                  setAddError("");
                }}
                className="px-3 py-1 bg-[#2d2d2d] hover:bg-[#383838] text-[#ccc] rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {activeDb === "state" && (
              <button
                onClick={() => setAddingRecord(true)}
                className="px-2 py-1 bg-[#2d2d2d] hover:bg-[#383838] text-[#ccc] rounded transition-colors text-[10px]"
              >
                + Add record
              </button>
            )}
            <div className="flex-1" />
            <span className="text-[#555]">
              {filtered.length} record{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
