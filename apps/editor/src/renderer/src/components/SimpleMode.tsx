import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Template catalogue
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "number";
}

interface TemplateDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  recordType: string;
  fields: FieldDef[];
  defaultItems: Record<string, string | number>[];
}

const TEMPLATES: TemplateDef[] = [
  {
    id: "restaurant",
    name: "Restaurant Menu",
    description:
      "Gulf-style kiosk menu with Arabic support, category filters, and a cart",
    icon: "🍽️",
    recordType: "product",
    fields: [
      {
        key: "name",
        label: "Name",
        placeholder: "e.g. Grilled Chicken",
        type: "text",
      },
      {
        key: "description",
        label: "Description",
        placeholder: "Short description",
        type: "text",
      },
      { key: "price", label: "Price", placeholder: "45", type: "number" },
      {
        key: "category",
        label: "Category",
        placeholder: "e.g. Mains",
        type: "text",
      },
    ],
    defaultItems: [
      {
        name: "Grilled Chicken",
        description: "Tender grilled chicken with herbs",
        price: 45,
        category: "Mains",
      },
      {
        name: "Hummus",
        description: "Fresh hummus with olive oil and pita",
        price: 20,
        category: "Starters",
      },
    ],
  },
];

type Item = Record<string, string | number>;

// ---------------------------------------------------------------------------
// SimpleMode
// ---------------------------------------------------------------------------

interface Props {
  onStatus: (msg: string) => void;
}

export default function SimpleMode({ onStatus }: Props) {
  const [step, setStep] = useState<"pick" | "build">("pick");
  const [template, setTemplate] = useState<TemplateDef | null>(null);
  const [appName, setAppName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [exporting, setExporting] = useState(false);

  function pickTemplate(t: TemplateDef) {
    setTemplate(t);
    setAppName("");
    setItems(t.defaultItems.map((item) => ({ ...item })));
    setStep("build");
  }

  function addItem() {
    const blank: Item = {};
    template!.fields.forEach((f) => {
      blank[f.key] = f.type === "number" ? 0 : "";
    });
    setItems((prev) => [...prev, blank]);
  }

  function updateItem(idx: number, key: string, value: string | number) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    );
  }

  function deleteItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function doExport() {
    if (!template || !appName.trim()) {
      onStatus("Enter an app name before exporting");
      return;
    }
    setExporting(true);
    onStatus("Packing…");
    try {
      const outPath = await window.api.simplePackUix({
        templateId: template.id,
        appName: appName.trim(),
        recordType: template.recordType,
        items,
      });
      if (outPath) {
        onStatus(`Exported → ${outPath.split("/").pop()}`);
        await window.api.showItemInFolder(outPath);
      } else {
        onStatus("");
      }
    } catch (e) {
      onStatus(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  // ── Step: pick ────────────────────────────────────────────────────────────

  if (step === "pick") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-surface-900 p-8">
        <div className="text-center mb-2">
          <h2 className="text-lg font-semibold text-white">
            Choose a template
          </h2>
          <p className="text-sm text-[#858585] mt-1">
            Pick a starting point for your .uix app
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-xl w-full">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTemplate(t)}
              className="flex flex-col items-start gap-2 p-5 rounded-lg border border-[#333] bg-surface-850 hover:border-[#0ea5e9] hover:bg-surface-800 transition-all text-left"
            >
              <span className="text-3xl">{t.icon}</span>
              <span className="font-semibold text-white">{t.name}</span>
              <span className="text-xs text-[#888] leading-relaxed">
                {t.description}
              </span>
            </button>
          ))}

          {/* Placeholder card */}
          <div className="flex flex-col items-start gap-2 p-5 rounded-lg border border-dashed border-[#2a2a2a] bg-surface-900 opacity-50 cursor-not-allowed text-left">
            <span className="text-3xl">📋</span>
            <span className="font-semibold text-[#555]">More templates</span>
            <span className="text-xs text-[#444] leading-relaxed">
              Catalogue, portfolio, briefing — coming soon
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: build ───────────────────────────────────────────────────────────

  const cols = template!.fields.length;
  const gridCols = `repeat(${cols}, 1fr) 28px`;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-900">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#2d2d2d] shrink-0">
        <button
          onClick={() => setStep("pick")}
          className="text-xs text-[#858585] hover:text-white transition-colors"
        >
          ← Templates
        </button>
        <span className="text-[#444]">/</span>
        <span className="text-sm font-medium text-white">{template!.name}</span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-col gap-6">
          {/* App name */}
          <section>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#858585] mb-2">
              App Name
            </label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="My Restaurant"
              className="w-full max-w-sm bg-[#1e1e1e] border border-[#3a3a3a] rounded px-3 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#0ea5e9]"
            />
          </section>

          {/* Items table */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#858585]">
                Items ({items.length})
              </label>
              <button
                onClick={addItem}
                className="text-xs text-[#0ea5e9] hover:text-[#38bdf8] font-medium transition-colors"
              >
                + Add item
              </button>
            </div>

            <div className="border border-[#2d2d2d] rounded-lg overflow-hidden">
              {/* Header row */}
              <div
                className="grid text-xs font-semibold text-[#858585] bg-[#1a1a1a] px-2 py-2"
                style={{ gridTemplateColumns: gridCols }}
              >
                {template!.fields.map((f) => (
                  <span key={f.key} className="px-2">
                    {f.label}
                  </span>
                ))}
                <span />
              </div>

              {/* Data rows */}
              {items.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#555]">
                  No items yet — click "+ Add item"
                </div>
              ) : (
                items.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid border-t border-[#2d2d2d] hover:bg-[#1e1e1e]/60"
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    {template!.fields.map((f) => (
                      <div key={f.key} className="px-2 py-1.5">
                        <input
                          type={f.type}
                          value={String(item[f.key] ?? "")}
                          onChange={(e) =>
                            updateItem(
                              idx,
                              f.key,
                              f.type === "number"
                                ? Number(e.target.value)
                                : e.target.value,
                            )
                          }
                          placeholder={f.placeholder}
                          className="w-full bg-transparent text-sm text-white placeholder-[#444] focus:outline-none focus:bg-[#1e1e1e] rounded px-1 py-0.5"
                        />
                      </div>
                    ))}
                    <div className="flex items-center justify-center px-1">
                      <button
                        onClick={() => deleteItem(idx)}
                        title="Delete row"
                        className="text-[#555] hover:text-red-400 text-xs transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Export */}
          <section className="flex items-center gap-4 pt-2 pb-8">
            <button
              onClick={doExport}
              disabled={exporting || !appName.trim()}
              className="flex items-center gap-2 px-5 py-2 bg-[#0ea5e9] text-white font-semibold text-sm rounded hover:bg-[#38bdf8] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {exporting ? "⏳ Packing…" : "▦ Export .uix"}
            </button>
            {!appName.trim() && (
              <span className="text-xs text-[#555]">
                Enter an app name to export
              </span>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
