import { useState, useEffect } from "react";
import {
  Utensils,
  Store,
  Landmark,
  Lock,
  Stethoscope,
  BookOpen,
  Briefcase,
  Rocket,
  KeyRound,
  ShieldCheck,
  FileSignature,
  Timer,
  Sparkles,
  Download,
  Copy,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Platform-aware download
// ---------------------------------------------------------------------------

type PlatformKey = "mac-arm" | "mac-intel" | "windows" | "linux" | "other";

function detectPlatform(): PlatformKey {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Macintosh/.test(ua)) {
    // WebGL renderer reliably distinguishes Apple Silicon ("Apple GPU") from Intel
    try {
      const canvas = document.createElement("canvas");
      const gl =
        (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
        (canvas.getContext(
          "experimental-webgl",
        ) as WebGLRenderingContext | null);
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          const renderer = gl.getParameter(
            ext.UNMASKED_RENDERER_WEBGL,
          ) as string;
          return /apple/i.test(renderer) ? "mac-arm" : "mac-intel";
        }
      }
    } catch {}
    return "mac-intel"; // safe fallback — Intel .dmg runs on both via Rosetta
  }
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

function usePlatformUrls() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [version, setVersion] = useState("v0.2.3");

  useEffect(() => {
    fetch("https://api.github.com/repos/dotuix/dotuix/releases/latest")
      .then((r) => r.json())
      .then((data) => {
        setVersion(data.tag_name ?? "v0.2.0");
        const assets: ReleaseAsset[] = data.assets ?? [];
        const found: Record<string, string> = {};
        for (const asset of assets) {
          const { name, browser_download_url } = asset;
          if (name.includes("aarch64") && name.endsWith(".dmg"))
            found["mac-arm"] = browser_download_url;
          else if (name.includes("x64") && name.endsWith(".dmg"))
            found["mac-intel"] = browser_download_url;
          else if (name.endsWith(".msi"))
            found["windows"] = browser_download_url;
          else if (name.endsWith(".AppImage"))
            found["linux"] = browser_download_url;
        }
        setUrls(found);
      })
      .catch(() => {
        /* fallback urls used */
      });
  }, []);

  return { urls, version };
}

function PlatformDownloadButton() {
  const platform = detectPlatform();
  const { urls, version } = usePlatformUrls();
  const fallback = "https://github.com/dotuix/dotuix/releases/latest";

  const config: Record<
    PlatformKey,
    {
      text: string;
      hint: string;
      key: string;
      altText?: string;
      altKey?: string;
    }
  > = {
    "mac-arm": {
      text: "Download for macOS",
      hint: "Apple Silicon  ·  .dmg",
      key: "mac-arm",
      altText: "Intel Mac  ·  .dmg",
      altKey: "mac-intel",
    },
    "mac-intel": {
      text: "Download for macOS (Intel)",
      hint: "Intel  ·  .dmg",
      key: "mac-intel",
      altText: "Apple Silicon  ·  .dmg",
      altKey: "mac-arm",
    },
    windows: {
      text: "Download for Windows",
      hint: "Windows 10+  ·  .msi",
      key: "windows",
    },
    linux: {
      text: "Download for Linux",
      hint: ".AppImage  ·  most distros",
      key: "linux",
    },
    other: {
      text: "Download Desktop Viewer",
      hint: "macOS  ·  Windows  ·  Linux",
      key: "",
    },
  };

  const { text, hint, key, altText, altKey } = config[platform];
  const primaryUrl = (key && urls[key]) || fallback;
  const altUrl = altKey ? urls[altKey] || fallback : null;

  return (
    <div className="flex flex-col items-center gap-2 mb-8">
      <a
        href={primaryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-3 px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 transition-opacity text-base font-semibold shadow-lg shadow-purple-900/30"
      >
        <Download className="w-5 h-5" />
        {text}
      </a>
      <p className="text-xs text-gray-500">
        {hint}&nbsp;&nbsp;·&nbsp;&nbsp;Free&nbsp;&nbsp;·&nbsp;&nbsp;{version}
      </p>
      <div className="flex items-center gap-4 text-xs">
        {altText && altUrl && (
          <a
            href={altUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-200 underline underline-offset-2 transition-colors font-medium"
          >
            ↓ {altText}
          </a>
        )}
        <a
          href={fallback}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
        >
          All downloads →
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI prompt builder
// ---------------------------------------------------------------------------

const AI_TEMPLATES = [
  {
    id: "restaurant",
    label: "Restaurant menu",
    fields: [
      { key: "name", placeholder: "Restaurant name", required: true },
      {
        key: "cuisine",
        placeholder: "Cuisine type (e.g. Qatari, Italian)",
        required: false,
      },
      { key: "city", placeholder: "City / location", required: false },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://mcp.dotuix.uts.qa/api/spec

Build a restaurant kiosk .uix file for ${vals.name || "my restaurant"}${
        vals.cuisine ? ` — ${vals.cuisine} cuisine` : ""
      }${vals.city ? `, ${vals.city}` : ""}.

Output exactly these files:
• manifest.json — uix:"1.0", id, name, version, entry, mode:"kiosk", network:"blocked"
• index.html — app shell
• app.js — reads menu via uix.data.find(), cart persisted via uix.state.insert() and restored via uix.state.find() on startup
• style.css — professional kiosk styling, touch-friendly

And a dataRecords array with at least 8 menu items across 3 categories:
[{ "id": "product:001", "type": "product", "body": { "name": "...", "price": 0, "category": "..." } }]

Critical rules:
- ALL content (items, categories) goes in dataRecords — never hardcode in app.js
- Read data with: const items = await uix.data.find({ type: 'product' })
- body is a JSON string — always JSON.parse(item.body) before reading fields
- No external URLs (fully offline)
- State is NEVER auto-injected: if you use uix.state.insert(), you MUST call uix.state.find() on startup to restore it, e.g.: const saved = await uix.state.find({ type: 'cart_item' }); cart = saved.map(r => JSON.parse(r.body));
- uix.state.insert() requires a body field: { type: 'cart_item', body: { id, name, price } } — never pass data as top-level fields
${vals.cuisine || vals.city ? "- Include Arabic + English labels" : ""}
- DO NOT put a dataRecords.json inside files[] — data goes in the dataRecords field
- DO NOT call uix.data.getAll() — use uix.data.find({ type: '...' })
- In the dataRecords array, body must be a plain object — never a pre-stringified JSON string

Finally call:
POST https://mcp.dotuix.uts.qa/api/create
Body: { "name": "...", "manifest": {...}, "files": [{"path":"index.html","content":"..."}, {"path":"app.js","content":"..."}, {"path":"style.css","content":"..."}], "dataRecords": [{"id":"...","type":"...","body":{...}}] }
If the API call succeeds, reply with the download URL.
If you cannot make HTTP requests, output the complete JSON request body as plain text — do NOT create a ZIP or any file attachment. A ZIP cannot contain a real SQLite database so it will never work.`,
  },
  {
    id: "catalog",
    label: "Product catalogue",
    fields: [
      { key: "company", placeholder: "Company or brand name", required: true },
      {
        key: "product",
        placeholder: "What products? (e.g. furniture, electronics)",
        required: true,
      },
      {
        key: "count",
        placeholder: "How many sample products? (e.g. 20)",
        required: false,
      },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://mcp.dotuix.uts.qa/api/spec

Build a product catalogue .uix file for ${
        vals.company || "my company"
      } selling ${vals.product || "products"}.

Output exactly these files:
• manifest.json — uix:"1.0", id, name, version, entry, mode:"kiosk", network:"blocked"
• index.html
• app.js — reads products via uix.data.find(), category filters, search
• style.css — clean exhibition/showroom styling

And a dataRecords array with at least ${vals.count || "12"} products:
[{ "id": "product:001", "type": "product", "body": { "name": "...", "price": 0, "category": "...", "desc": "..." } }]

Critical rules:
- ALL products go in dataRecords — never hardcode in app.js
- Read with: const items = await uix.data.find({ type: 'product' })
- Always JSON.parse(item.body) before reading any field
- No external URLs
- DO NOT put a dataRecords.json inside files[] — data goes in the dataRecords field
- DO NOT call uix.data.getAll() — use uix.data.find({ type: '...' })
- In the dataRecords array, body must be a plain object — never a pre-stringified JSON string

Finally call:
POST https://mcp.dotuix.uts.qa/api/create
Body: { "name": "...", "manifest": {...}, "files": [{"path":"index.html","content":"..."}, {"path":"app.js","content":"..."}, {"path":"style.css","content":"..."}], "dataRecords": [{"id":"...","type":"...","body":{...}}] }
If the API call succeeds, reply with the download URL.
If you cannot make HTTP requests, output the complete JSON request body as plain text — do NOT create a ZIP or any file attachment. A ZIP cannot contain a real SQLite database so it will never work.`,
  },
  {
    id: "portfolio",
    label: "Portfolio / showcase",
    fields: [
      { key: "name", placeholder: "Your name", required: true },
      {
        key: "role",
        placeholder: "Your role (e.g. designer, engineer)",
        required: false,
      },
      {
        key: "projects",
        placeholder: "Key projects or skills (brief)",
        required: false,
      },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://mcp.dotuix.uts.qa/api/spec

Build a portfolio .uix file for ${vals.name || "me"}, a ${
        vals.role || "professional"
      }.${vals.projects ? ` Focus on: ${vals.projects}.` : ""}

Output exactly these files:
• manifest.json — uix:"1.0", id, name, version, entry, mode:"window"
• index.html
• app.js — reads projects via uix.data.find(), interactivity
• style.css — professional, modern design

And dataRecords for at least 4 projects and skills:
[{ "id": "project:001", "type": "project", "body": { "title": "...", "desc": "...", "tags": [] } }]

Critical rules:
- ALL content (projects, skills) goes in dataRecords
- Always JSON.parse(item.body) before reading any field
- No external URLs
- DO NOT put a dataRecords.json inside files[] — data goes in the dataRecords field
- DO NOT call uix.data.getAll() — use uix.data.find({ type: '...' })
- In the dataRecords array, body must be a plain object — never a pre-stringified JSON string

Finally call:
POST https://mcp.dotuix.uts.qa/api/create
Body: { "name": "...", "manifest": {...}, "files": [{"path":"index.html","content":"..."}, {"path":"app.js","content":"..."}, {"path":"style.css","content":"..."}], "dataRecords": [{"id":"...","type":"...","body":{...}}] }
If the API call succeeds, reply with the download URL.
If you cannot make HTTP requests, output the complete JSON request body as plain text — do NOT create a ZIP or any file attachment. A ZIP cannot contain a real SQLite database so it will never work.`,
  },
  {
    id: "report",
    label: "Report / dashboard",
    fields: [
      { key: "title", placeholder: "Report title", required: true },
      {
        key: "subject",
        placeholder:
          "Data type / subject (e.g. quarterly sales, hospital stats)",
        required: false,
      },
      {
        key: "metrics",
        placeholder: "Key metrics or sections to include",
        required: false,
      },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://mcp.dotuix.uts.qa/api/spec

Build an interactive report .uix file titled "${vals.title || "My Report"}".${
        vals.subject ? ` Subject: ${vals.subject}.` : ""
      }${vals.metrics ? ` Include: ${vals.metrics}.` : ""}

Output exactly these files:
• manifest.json — uix:"1.0", id, name, version, entry, mode:"window"
• index.html
• app.js — reads data via uix.data.find(), charts, filters
• style.css — clean report/dashboard design

And dataRecords with sample data rows:
[{ "id": "metric:001", "type": "metric", "body": { "label": "...", "value": 0, "period": "..." } }]

Critical rules:
- ALL data goes in dataRecords — never hardcode numbers in app.js
- Always JSON.parse(item.body) before reading any field
- No external URLs
- DO NOT put a dataRecords.json inside files[] — data goes in the dataRecords field
- DO NOT call uix.data.getAll() — use uix.data.find({ type: '...' })
- In the dataRecords array, body must be a plain object — never a pre-stringified JSON string

Finally call:
POST https://mcp.dotuix.uts.qa/api/create
Body: { "name": "...", "manifest": {...}, "files": [{"path":"index.html","content":"..."}, {"path":"app.js","content":"..."}, {"path":"style.css","content":"..."}], "dataRecords": [{"id":"...","type":"...","body":{...}}] }
If the API call succeeds, reply with the download URL.
If you cannot make HTTP requests, output the complete JSON request body as plain text — do NOT create a ZIP or any file attachment. A ZIP cannot contain a real SQLite database so it will never work.`,
  },
  {
    id: "custom",
    label: "Custom",
    fields: [
      {
        key: "description",
        placeholder: "Describe what you want to build…",
        required: true,
      },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://mcp.dotuix.uts.qa/api/spec

Build a .uix file for: ${vals.description || "[describe your app]"}

Output exactly these files:
• manifest.json — uix:"1.0", id, name, version, entry, mode, network:"blocked"
• index.html — app shell
• app.js — all app logic, reads data via uix.data.find()
• style.css — clean, professional design

And a dataRecords array for all content (items, categories, pages, etc.)

Critical rules:
- ALL content goes in dataRecords — never hardcode data in app.js
- Read data with: const items = await uix.data.find({ type: 'yourtype' })
- Always JSON.parse(item.body) before reading any field
- No external URLs (fully offline)
- Use uix.state.insert/find for user data (cart, preferences); always restore state on startup with uix.state.find()
- uix.state.insert() requires a body field: { type: '...', body: { ...data } } — never pass data as top-level fields
- DO NOT put a dataRecords.json inside files[] — data goes in the dataRecords field
- DO NOT call uix.data.getAll() — use uix.data.find({ type: '...' })
- In the dataRecords array, body must be a plain object — never a pre-stringified JSON string

Finally call:
POST https://mcp.dotuix.uts.qa/api/create
Body: { "name": "...", "manifest": {...}, "files": [{"path":"index.html","content":"..."}, {"path":"app.js","content":"..."}, {"path":"style.css","content":"..."}], "dataRecords": [{"id":"...","type":"...","body":{...}}] }
If the API call succeeds, reply with the download URL.
If you cannot make HTTP requests, output the complete JSON request body as plain text — do NOT create a ZIP or any file attachment. A ZIP cannot contain a real SQLite database so it will never work.`,
  },
];

function AIPromptBuilder() {
  const [templateId, setTemplateId] = useState("restaurant");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const template = AI_TEMPLATES.find((t) => t.id === templateId)!;
  const prompt = template.buildPrompt(fields);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    setFields({});
    setCopied(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-400/30 bg-purple-500/10 text-xs text-purple-300 mb-5">
            <Sparkles className="w-3 h-3" /> Works with ChatGPT · Gemini ·
            Claude
          </div>
          <h2 className="text-3xl font-bold mb-3">Generate with any AI</h2>
          <p className="text-gray-400 max-w-xl mx-auto leading-relaxed">
            No API key. No install. Pick a template, fill in your details, copy
            the prompt — the AI reads the spec, calls the API, and gives you a
            download link.
          </p>
        </div>

        {/* Template tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {AI_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTemplateChange(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                templateId === t.id
                  ? "bg-white/15 border border-white/20 text-white"
                  : "bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div className="space-y-3 mb-6">
          {template.fields.map((f) => (
            <input
              key={f.key}
              type="text"
              placeholder={f.placeholder}
              value={fields[f.key] || ""}
              onChange={(e) =>
                setFields((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400/50 focus:bg-white/8 transition-all"
            />
          ))}
        </div>

        {/* Generated prompt */}
        <div className="rounded-xl border border-white/10 bg-white/3 overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8 bg-white/3">
            <span className="text-xs text-gray-500 font-medium">
              Generated prompt — paste into any AI
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              {copied ? (
                <>
                  <CheckCheck className="w-3.5 h-3.5 text-green-400" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="px-5 py-4 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-72">
            {prompt}
          </pre>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 transition-opacity text-sm font-medium"
          >
            {copied ? (
              <>
                <CheckCheck className="w-4 h-4" /> Prompt copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Copy prompt
              </>
            )}
          </button>
          <p className="text-xs text-gray-500 leading-relaxed">
            Paste into ChatGPT, Gemini, or Claude. The AI calls the API and
            returns a download link — no files to save, no CLI needed.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small reusable components
// ---------------------------------------------------------------------------

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="w-full flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3 cursor-pointer hover:bg-white/10 transition-colors group text-left"
    >
      <code className="text-sm text-gray-300 flex-1 font-mono">{value}</code>
      <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors select-none shrink-0">
        {copied ? "copied!" : "copy"}
      </span>
    </button>
  );
}

function Check({ ok }: { ok: boolean | "partial" }) {
  if (ok === "partial")
    return <span className="text-yellow-400 text-base">~</span>;
  return ok ? (
    <span className="text-green-400 text-base">✓</span>
  ) : (
    <span className="text-gray-700 text-base">✗</span>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const COMPARISONS = [
  {
    format: "PDF",
    interactive: false,
    offline: true,
    oneFile: true,
    noInstall: true,
  },
  {
    format: "PWA",
    interactive: true,
    offline: "partial" as const,
    oneFile: false,
    noInstall: false,
  },
  {
    format: "Electron app",
    interactive: true,
    offline: true,
    oneFile: false,
    noInstall: false,
  },
  {
    format: "Raw HTML",
    interactive: true,
    offline: true,
    oneFile: false,
    noInstall: true,
  },
  {
    format: ".uix",
    interactive: true,
    offline: true,
    oneFile: true,
    noInstall: true,
    highlight: true,
  },
];

const USE_CASES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Lock,
    title: "Classified briefings",
    desc: "Encrypted, signed, PIN-protected. Air-gapped delivery. The viewer refuses altered files before any content runs.",
  },
  {
    icon: Stethoscope,
    title: "Healthcare reference",
    desc: "Drug protocols and triage guides for remote clinics. No account. No cloud. Works on a tablet with zero connectivity.",
  },
  {
    icon: Landmark,
    title: "Government & compliance",
    desc: "Offline intake forms with built-in validation and local state. Signed audit trail. Submit on reconnect.",
  },
  {
    icon: BookOpen,
    title: "Interactive education",
    desc: "AI-generated lessons, simulations, and quizzes. Progress tracked in SQLite. USB-distributable to schools with no internet.",
  },
  {
    icon: Briefcase,
    title: "Proposals & audits",
    desc: "Live calculators, Gantt charts, editable scenarios. Signed and frozen on submission — proof of what was promised.",
  },
  {
    icon: Rocket,
    title: "Extreme remote",
    desc: "Procedure manuals for spacecraft, polar expeditions, oil rigs. AI-generated on demand. One file. Zero connectivity required.",
  },
  {
    icon: Utensils,
    title: "Restaurant kiosk",
    desc: "Gulf menu on a tablet — Arabic, QAR prices, working cart. No WiFi needed.",
  },
  {
    icon: Store,
    title: "Retail catalogue",
    desc: "Product showcase at exhibitions — category filters, SKU, pricing. No internet.",
  },
];

// ---------------------------------------------------------------------------
// Guide section
// ---------------------------------------------------------------------------

const GUIDE_PATHS = [
  {
    id: "ai",
    label: "With any AI",
    tag: "ChatGPT  ·  Gemini  ·  Claude",
    steps: [
      {
        title: "Use the prompt builder — or write your own",
        desc: 'Use the template below, or just tell your AI: "Read https://mcp.dotuix.uts.qa/api/spec then build me a [describe your app]. Give me the download link when done."',
        code: null,
      },
      {
        title: "Paste into any AI",
        desc: "Copy the prompt and paste it into ChatGPT, Gemini, or Claude. The AI reads the spec — which tells it exactly how to call the API — then builds everything.",
        code: null,
      },
      {
        title: "The AI calls the API for you",
        desc: "The AI sends your app's manifest, files, and data records to the API. The server generates data.db, packs the .uix, and returns a download link — no files to save, no CLI needed.",
        code: 'POST /api/create → { url: "https://.../download/abc123" }',
      },
      {
        title: "Download and open",
        desc: "Click the download link the AI gives you. Open the .uix file in the desktop viewer — fully offline, zero install beyond the viewer.",
        code: null,
      },
    ],
  },
  {
    id: "mcp",
    label: "Via MCP",
    tag: "Claude Desktop  ·  Cursor  ·  VS Code Copilot",
    steps: [
      {
        title: "Connect — no install needed",
        desc: "Add the remote MCP server URL to your AI client config. Works in Claude Desktop, Cursor, Windsurf — no npx, nothing to install.",
        code: `// Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json\n// Cursor: .cursor/mcp.json\n{\n  "mcpServers": {\n    "dotuix": { "url": "https://mcp.dotuix.uts.qa/mcp" }\n  }\n}`,
      },
      {
        title: "Or run locally with npx",
        desc: "Prefer offline / local execution? Install the stdio MCP server instead.",
        code: `// Alternative — local stdio:\n{\n  "mcpServers": {\n    "dotuix": { "command": "npx", "args": ["-y", "@dotuix/mcp"] }\n  }\n}`,
      },
      {
        title: "Describe what you want",
        desc: "Open Claude Desktop, Cursor, or VS Code Copilot. Describe the app — the agent reads the spec and generates everything.",
        code: '"Build an offline restaurant kiosk for\n Al Madina, Doha — Arabic + English."',
      },
      {
        title: "The AI packs it automatically",
        desc: "The agent calls get_spec → create (with dataRecords for all content). All menu items, products, and data go into data.db — nothing hardcoded in app.js.",
        code: "# Agent calls internally:\ncreate({ manifest, files, dataRecords })\n✓  al-madina.uix — signed",
      },
      {
        title: "Open in the desktop viewer",
        desc: "The agent returns the file path (local) or a download URL (remote). Open in the viewer — fully offline.",
        code: null,
      },
    ],
  },
  {
    id: "vite",
    label: "With Vite / React",
    tag: "React  ·  Vue  ·  Svelte  ·  TypeScript",
    steps: [
      {
        title: "Install the plugin",
        desc: "Add to your existing Vite project — works with React, Vue, Svelte, or plain TypeScript.",
        code: "npm install -D @dotuix/vite-plugin",
      },
      {
        title: "Configure vite.config",
        desc: "Import the plugin and add a manifest. Your app's existing entry point becomes the .uix entry.",
        code: `// vite.config.ts\nimport { dotuix } from "@dotuix/vite-plugin";\n\nexport default {\n  plugins: [\n    dotuix({\n      manifest: {\n        id: "com.myapp.name",\n        name: "My App",\n        version: "1.0.0",\n        entry: "index.html",\n        mode: "kiosk",\n        network: "blocked",\n      },\n    }),\n  ],\n};`,
      },
      {
        title: "Use the bridge API in your app",
        desc: "Replace fetch/localStorage calls with window.__uix. Data and state go through the bridge — fully offline, no server.",
        code: `// In your React/Vue/Svelte component:\nconst items = await window.uix.data.find({ type: "product" });\nawait window.uix.state.insert({ type: "cart", body: { id, qty } });`,
      },
      {
        title: "Build",
        desc: "Run your normal Vite build. A .uix file is written alongside the dist/ output — no extra step.",
        code: "npm run build\n✓  dist/my-app.uix — ready",
      },
      {
        title: "Open in the desktop viewer",
        desc: "Open dist/my-app.uix in the viewer. Your full React/Vue/Svelte app runs fully offline in one file.",
        code: null,
      },
    ],
  },
  {
    id: "cli",
    label: "CLI from scratch",
    tag: "Full control  ·  edit files yourself",
    steps: [
      {
        title: "Install the CLI",
        desc: "Install globally once.",
        code: "npm install -g @dotuix/cli",
      },
      {
        title: "Create from a template",
        desc: "Choose a starter or start blank. Templates include sample data and working bridge API usage.",
        code: "dotuix init my-app -t restaurant\n# also: -t catalog  |  -t portfolio\n✓  Created my-app/",
      },
      {
        title: "Edit the files",
        desc: "Open my-app/ in any editor. Edit manifest.json, index.html, app.js, style.css. Use window.__uix for data — see Format reference below.",
        code: null,
      },
      {
        title: "Pack",
        desc: "Pack the folder into a .uix file.",
        code: "dotuix pack ./my-app\n✓  my-app.uix — 847 KB",
      },
      {
        title: "Validate and open",
        desc: "Validate the output, then open in the viewer.",
        code: "dotuix validate my-app.uix\n✓  manifest valid\n✓  entry index.html found\n✓  no external URLs",
      },
    ],
  },
];

function GuideSection() {
  const [tab, setTab] = useState("ai");
  const path = GUIDE_PATHS.find((p) => p.id === tab)!;

  return (
    <section
      id="guide"
      className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8"
    >
      <h2 className="text-3xl font-bold text-center mb-3">Start building</h2>
      <p className="text-gray-400 text-center mb-10 max-w-xl mx-auto">
        Three paths to a .uix file. Pick the one that fits.
      </p>

      {/* Tab bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-10 max-w-2xl mx-auto">
        {GUIDE_PATHS.map((p) => (
          <button
            key={p.id}
            onClick={() => setTab(p.id)}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-medium transition-all text-center ${
              tab === p.id
                ? "bg-white/12 border border-white/20 text-white"
                : "bg-white/4 border border-white/8 text-gray-400 hover:text-white hover:bg-white/8"
            }`}
          >
            <div className="font-semibold">{p.label}</div>
            <div
              className={`text-xs mt-0.5 ${
                tab === p.id ? "text-gray-300" : "text-gray-600"
              }`}
            >
              {p.tag}
            </div>
          </button>
        ))}
      </div>

      {/* Steps */}
      <div className="max-w-2xl mx-auto">
        {path.steps.map((step, i) => (
          <div key={i} className="flex gap-5">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {i + 1}
              </div>
              {i < path.steps.length - 1 && (
                <div
                  className="w-px flex-1 bg-white/8 mt-2 mb-0"
                  style={{ minHeight: "2rem" }}
                />
              )}
            </div>
            <div
              className={`flex-1 ${
                i < path.steps.length - 1 ? "pb-8" : "pb-0"
              }`}
            >
              <h3 className="font-semibold text-sm mb-1 mt-1">{step.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-3">
                {step.desc}
              </p>
              {step.code && (
                <pre className="text-xs font-mono text-gray-300 bg-black/30 rounded-lg p-3.5 leading-6 overflow-x-auto border border-white/6">
                  {step.code}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Format reference section
// ---------------------------------------------------------------------------

const MANIFEST_FIELDS: {
  field: string;
  type: string;
  req: boolean;
  desc: string;
}[] = [
  {
    field: "uix",
    type: "string",
    req: true,
    desc: 'Format version. Always "1.0".',
  },
  {
    field: "id",
    type: "string",
    req: true,
    desc: "Reverse-domain stable id. e.g. com.almadina.menu. Used for state isolation and signatures.",
  },
  {
    field: "name",
    type: "string",
    req: true,
    desc: "Human-readable app name shown in the viewer chrome.",
  },
  {
    field: "version",
    type: "string",
    req: true,
    desc: 'SemVer app version. e.g. "1.0.0".',
  },
  {
    field: "entry",
    type: "string",
    req: true,
    desc: "Path to entry HTML inside the archive. e.g. index.html.",
  },
  {
    field: "mode",
    type: "string",
    req: true,
    desc: '"kiosk" — locked UI, no address bar. "window" — toolbar visible. Use window for AI agent apps.',
  },
  {
    field: "minViewer",
    type: "string",
    req: false,
    desc: "Minimum viewer version required. Viewer refuses with a clear message if below.",
  },
  {
    field: "permissions",
    type: "string[]",
    req: false,
    desc: '"local-storage", "print", "clipboard-write", "fullscreen", "raw-sql".',
  },
  {
    field: "network",
    type: "string",
    req: false,
    desc: '"blocked" (default) — CSP blocks all external requests. "allowed" — outbound enabled.',
  },
  {
    field: "theme",
    type: "object",
    req: false,
    desc: "Viewer chrome colors: { color: hex, background: hex }.",
  },
  {
    field: "author",
    type: "string",
    req: false,
    desc: "Creator email or identifier.",
  },
  {
    field: "expires",
    type: "string|null",
    req: false,
    desc: "ISO 8601 expiry date. Viewer checks before extraction — expired files never unpack.",
  },
  {
    field: "state.seed",
    type: "boolean",
    req: false,
    desc: "true = copy state.db from archive as starting user state on first open.",
  },
  {
    field: "security",
    type: "object",
    req: false,
    desc: "Optional PIN auth + AES-256-GCM encryption. Omit entirely for regular apps.",
  },
  {
    field: "signature",
    type: "object",
    req: false,
    desc: "Ed25519 signature added by dotuix sign. Viewer verifies before running any content.",
  },
  {
    field: "ai",
    type: "object",
    req: false,
    desc: "AI provenance block. { generatedBy, generatedAt, capabilities, promptHash }. Informational only.",
  },
];

const MANIFEST_EXAMPLE = `{
  "uix": "1.0",
  "id": "com.almadina.menu",
  "name": "Al Madina Restaurant",
  "version": "1.0.0",
  "entry": "index.html",
  "mode": "kiosk",
  "permissions": ["local-storage"],
  "network": "blocked",
  "theme": { "color": "#1a1a2e", "background": "#ffffff" },
  "author": "chef@almadina.qa",
  "expires": null
}`;

const BRIDGE_API_CODE = `// App metadata
const manifest = await uix.manifest();
const viewerVer = await uix.version();

// Data database — read-only (creator data shipped in the .uix)
const products = await uix.data.find({ type: "product" });
const burgers  = await uix.data.find({
  type:    "product",
  where:   { category: "burgers" },
  orderBy: { field: "name", direction: "asc" },
  limit:   20,
});
const item = await uix.data.get("product:001");

// Raw SQL (requires "raw-sql" in manifest.permissions)
const rows = await uix.data.raw(
  "SELECT body FROM records WHERE type = ?",
  ["product"]
);

// State database — read-write (user data, persisted across opens)
const rec = await uix.state.insert({
  type: "cart_item",
  body: { productId: "product:001", qty: 2, price: 35.0 },
});
// Returns: { id, type, body, created_at, updated_at }
// id auto-generated as "cart_item:<uuid>"

const items = await uix.state.find({ type: "cart_item" });
await uix.state.update(rec.id, { body: { qty: 3 } });
await uix.state.delete(rec.id);
await uix.state.purge({ type: "session_log", olderThan: 86400 });`;

const STRUCTURE_CODE = `my-app.uix  (standard ZIP archive — open with any ZIP tool)
├── manifest.json       ← REQUIRED — app descriptor
├── index.html          ← entry point (set in manifest.entry)
├── app.js
├── style.css
├── assets/             ← images, fonts, audio  (convention)
├── files/              ← PDFs, CSVs, data files (convention)
├── data.db             ← read-only SQLite  (creator data)
└── state.db            ← read-write SQLite (user state, persisted)

SQLite schema (identical in both databases):
  CREATE TABLE records (
    id         TEXT    PRIMARY KEY,   -- e.g. "product:001"
    type       TEXT    NOT NULL,      -- e.g. "product"
    body       TEXT    NOT NULL,      -- arbitrary JSON object
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX idx_type       ON records (type);
  CREATE INDEX idx_created_at ON records (created_at);

Compression:
  HTML / CSS / JS / JSON → DEFLATE
  PNG / JPG / WEBP / SQLite files → STORE`;

const CLI_CODE = `# Install once
npm install -g @dotuix/cli

# Create from template
dotuix init my-app                    # blank starter
dotuix init my-app -t restaurant      # Gulf restaurant kiosk
dotuix init my-app -t catalog         # product catalogue
dotuix init my-app -t portfolio       # portfolio / showcase

# Build
dotuix pack ./my-app                  # → my-app.uix
dotuix pack ./my-app -o dist/         # → dist/my-app.uix

# Validate & inspect
dotuix validate my-app.uix
dotuix info my-app.uix

# Sign (Ed25519)
dotuix keygen my-key                  # → my-key.private + my-key.public
dotuix sign my-app.uix --key my-key.private

# Encrypt selected paths (AES-256-GCM)
dotuix encrypt my-app.uix --paths data.db --pin-prompt

# Export state data from a .uix
dotuix export my-app.uix --type order --format csv -o orders.csv
dotuix export my-app.uix --type order --format json -o orders.json`;

const FORMAT_TABS_DATA = [
  { id: "manifest", label: "manifest.json" },
  { id: "bridge", label: "Bridge API" },
  { id: "structure", label: "File structure" },
  { id: "cli", label: "CLI" },
];

function FormatRefSection() {
  const [tab, setTab] = useState("manifest");

  return (
    <section
      id="format"
      className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8"
    >
      <h2 className="text-3xl font-bold text-center mb-3">Format reference</h2>
      <p className="text-gray-400 text-center mb-10 max-w-xl mx-auto">
        Everything you need to build, read, or integrate with a .uix file.{" "}
        <a
          href="https://github.com/dotuix/dotuix/blob/main/spec/spec.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
        >
          Full normative spec →
        </a>
      </p>

      {/* Tab bar */}
      <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
        {FORMAT_TABS_DATA.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              tab === t.id
                ? "bg-white/12 border border-white/20 text-white"
                : "bg-white/4 border border-white/8 text-gray-400 hover:text-white hover:bg-white/8"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Manifest tab */}
      {tab === "manifest" && (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <div>
            <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-widest">
              Example
            </p>
            <pre className="text-xs font-mono text-gray-300 bg-black/30 rounded-xl p-5 leading-6 overflow-x-auto border border-white/6">
              {MANIFEST_EXAMPLE}
            </pre>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-widest">
              Fields
            </p>
            <div className="rounded-xl border border-white/8 overflow-hidden text-xs">
              {MANIFEST_FIELDS.map((f, i) => (
                <div
                  key={f.field}
                  className={`grid grid-cols-[6.5rem_4.5rem_2.5rem_1fr] gap-2 px-3 py-2 ${
                    i % 2 === 0 ? "bg-white/2" : ""
                  }`}
                >
                  <code className="text-blue-300 font-mono truncate">
                    {f.field}
                  </code>
                  <code className="text-pink-300/70 font-mono truncate">
                    {f.type}
                  </code>
                  <span className={f.req ? "text-green-400" : "text-gray-600"}>
                    {f.req ? "req" : "opt"}
                  </span>
                  <span className="text-gray-400 leading-relaxed">
                    {f.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bridge API tab */}
      {tab === "bridge" && (
        <div className="max-w-3xl mx-auto">
          <p className="text-gray-400 text-sm mb-5 leading-relaxed">
            The viewer injects{" "}
            <code className="text-gray-300 bg-white/5 px-1.5 py-0.5 rounded">
              window.__uix
            </code>{" "}
            (aliased as{" "}
            <code className="text-gray-300 bg-white/5 px-1.5 py-0.5 rounded">
              window.uix
            </code>
            ) into every running app. All methods return Promises. The app has
            no access to the host filesystem — only through this bridge.
          </p>
          <pre className="text-xs font-mono text-gray-300 bg-black/30 rounded-xl p-5 leading-6 overflow-x-auto border border-white/6">
            {BRIDGE_API_CODE}
          </pre>
          <div className="mt-5 grid sm:grid-cols-2 gap-4 text-xs text-gray-400">
            <div className="rounded-xl border border-white/8 p-4">
              <p className="font-medium text-gray-300 mb-2">find() options</p>
              <p>
                <code className="text-blue-300">where</code>:{" "}
                {"{ field: value }"} — JSON body match
              </p>
              <p>
                <code className="text-blue-300">orderBy</code>:{" "}
                {"{ field, direction }"} — asc | desc
              </p>
              <p>
                <code className="text-blue-300">limit</code>: max records to
                return
              </p>
            </div>
            <div className="rounded-xl border border-white/8 p-4">
              <p className="font-medium text-gray-300 mb-2">Record shape</p>
              <p>
                <code className="text-blue-300">id</code>: auto as{" "}
                <code className="text-gray-300">"type:uuid"</code>
              </p>
              <p>
                <code className="text-blue-300">body</code>: arbitrary JSON —
                your schema
              </p>
              <p>
                <code className="text-blue-300">created_at</code> /{" "}
                <code className="text-blue-300">updated_at</code>: unix ms
              </p>
            </div>
          </div>
        </div>
      )}

      {/* File structure tab */}
      {tab === "structure" && (
        <div className="max-w-3xl mx-auto">
          <p className="text-gray-400 text-sm mb-5 leading-relaxed">
            A{" "}
            <code className="text-gray-300 bg-white/5 px-1.5 py-0.5 rounded">
              .uix
            </code>{" "}
            file is a standard ZIP archive. Any ZIP tool can inspect it. The
            viewer extracts it in memory — files are never written to disk
            unencrypted.
          </p>
          <pre className="text-xs font-mono text-gray-300 bg-black/30 rounded-xl p-5 leading-6 overflow-x-auto border border-white/6">
            {STRUCTURE_CODE}
          </pre>
        </div>
      )}

      {/* CLI tab */}
      {tab === "cli" && (
        <div className="max-w-3xl mx-auto">
          <pre className="text-xs font-mono text-gray-300 bg-black/30 rounded-xl p-5 leading-6 overflow-x-auto border border-white/6 mb-5">
            {CLI_CODE}
          </pre>
          <div className="grid sm:grid-cols-2 gap-4 text-xs text-gray-400">
            <div className="rounded-xl border border-white/8 p-4">
              <p className="font-medium text-gray-300 mb-2">
                Node.js API (@dotuix/core)
              </p>
              <code className="block text-gray-400">{`import { UIX } from "@dotuix/core";`}</code>
              <code className="block text-gray-400 mt-1">{`await UIX.pack("./my-app", "out.uix");`}</code>
              <code className="block text-gray-400">{`await UIX.validate("my-app.uix");`}</code>
              <code className="block text-gray-400">{`await UIX.manifest("my-app.uix");`}</code>
            </div>
            <div className="rounded-xl border border-white/8 p-4">
              <p className="font-medium text-gray-300 mb-2">
                AI SDK (@dotuix/ai)
              </p>
              <code className="block text-gray-400">{`import { createUIX } from "@dotuix/ai";`}</code>
              <code className="block text-gray-400 mt-1">{`const path = await createUIX({`}</code>
              <code className="block text-gray-400">{`  manifest: { uix:"1.0", ... },`}</code>
              <code className="block text-gray-400">{`  files: { "index.html": "..." },`}</code>
              <code className="block text-gray-400">{`});`}</code>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const TOOLS = [
  {
    name: "Remote MCP Server",
    desc: "Hosted MCP server — connect Claude Desktop, Cursor, or any MCP client with just a URL. No install. Also exposes a REST API for GPT and Gemini Actions.",
    href: "https://mcp.dotuix.uts.qa/health",
    tag: "live",
  },
  {
    name: "@dotuix/mcp",
    desc: "Local stdio MCP server for Claude Desktop, Cursor, and VS Code Copilot. The create tool accepts dataRecords — content goes into data.db, not app.js.",
    href: "https://www.npmjs.com/package/@dotuix/mcp",
    tag: "npm",
  },
  {
    name: "@dotuix/ai",
    desc: "One-function SDK for AI-generated code. createUIX({ manifest, files }) auto-stamps provenance and handles packaging. For agents building .uix programmatically.",
    href: "https://www.npmjs.com/package/@dotuix/ai",
    tag: "npm",
  },
  {
    name: "@dotuix/core",
    desc: "Core library — pack, unpack, validate, sign, read/write SQLite, createDataDb() for seeding data.db.",
    href: "https://www.npmjs.com/package/@dotuix/core",
    tag: "npm",
  },
  {
    name: "@dotuix/cli",
    desc: "CLI — pack, validate, init, sign, encrypt, export, seed (create data.db from JSON). Install globally.",
    href: "https://www.npmjs.com/package/@dotuix/cli",
    tag: "npm",
  },
  {
    name: "VS Code Extension",
    desc: "Manifest IntelliSense, .uix file icon, pack & validate commands, and @dotuix chat participant for AI-assisted generation inside Copilot Chat.",
    href: "https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix",
    tag: "ext",
  },
  {
    name: "@dotuix/vite-plugin",
    desc: "Build React / Vue / Svelte / TypeScript apps — outputs a .uix file.",
    href: "https://github.com/dotuix/dotuix/tree/main/packages/vite-plugin",
    tag: "github",
  },
  {
    name: "Desktop Viewer",
    desc: "Tauri app — viewer + developer mode, kiosk, PIN auth, Ed25519 signature verification.",
    href: "https://github.com/dotuix/dotuix/tree/main/apps/viewer",
    tag: "github",
  },
];

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  return (
    <div className="min-h-screen bg-[#09090f] text-white">
      {/* ------------------------------------------------------------------ */}
      {/* Navbar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <nav className="sticky top-0 z-50 border-b border-white/8 bg-[#09090f]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-bold text-lg tracking-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
              dot
            </span>
            uix
          </span>
          <div className="flex items-center gap-5 text-sm text-gray-400">
            <a
              href="#guide"
              className="hover:text-white transition-colors hidden sm:block"
            >
              Guide
            </a>
            <a
              href="#format"
              className="hover:text-white transition-colors hidden sm:block"
            >
              Format
            </a>
            <a
              href="https://github.com/dotuix/dotuix"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors hidden sm:block"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/cli"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors hidden sm:block"
            >
              npm
            </a>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors hidden sm:block"
            >
              VS Code
            </a>
            <a
              href="https://github.com/dotuix/dotuix"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-white transition-colors text-xs font-medium"
            >
              GitHub →
            </a>
          </div>
        </div>
      </nav>

      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        {/* badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/15 bg-white/5 text-xs text-gray-400 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
          Open format · MIT · v0.2.1
        </div>

        {/* headline */}
        <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold tracking-tight mb-6 leading-[1.05]">
          The{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
            executable
          </span>
          <br />
          document format.
        </h1>

        {/* category */}
        <p className="text-lg sm:text-xl text-gray-400 mb-6 tracking-wide font-medium">
          PDF for printable. EPUB for readable.{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
            .uix for executable.
          </span>
        </p>

        {/* subtext */}
        <p className="text-xl sm:text-2xl text-gray-400 max-w-4xl mx-auto mb-10 leading-relaxed">
          A single portable file for AI-generated software, interactive reports,
          simulations, and tools —{" "}
          <span className="text-gray-300">
            fully offline, signed, and self-contained.
          </span>
        </p>

        {/* Platform download — primary CTA */}
        <PlatformDownloadButton />

        {/* Developer CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
          <div className="w-full sm:w-auto sm:min-w-72">
            <CopyBox value="npm install -g @dotuix/cli" />
          </div>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix"
            className="w-full sm:w-auto px-5 py-3 rounded-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 transition-opacity text-sm font-medium whitespace-nowrap text-center"
          >
            Install VS Code Extension →
          </a>
        </div>

        {/* terminal mockup */}
        <div className="max-w-2xl mx-auto rounded-xl border border-white/10 bg-white/3 overflow-hidden text-left shadow-2xl">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8 bg-white/3">
            <span className="w-3 h-3 rounded-full bg-red-500/50" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/50" />
            <span className="w-3 h-3 rounded-full bg-green-500/50" />
          </div>
          <pre className="px-5 py-5 text-sm font-mono leading-7 text-gray-300 overflow-x-auto">
            {[
              "$ dotuix init my-menu -t restaurant",
              "✓  Created my-menu/",
              "",
              "$ dotuix pack ./my-menu",
              "✓  my-menu.uix — 847 KB",
              "",
              "$ dotuix validate my-menu.uix",
              "✓  manifest valid",
              "✓  entry index.html found",
              "✓  data.db schema correct",
              "✓  no external URLs",
            ].join("\n")}
          </pre>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* MCP callout                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-white/8">
        <div className="max-w-2xl mx-auto rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-900/20 to-blue-900/10 p-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-400/30 bg-purple-500/10 text-xs text-purple-300 mb-5">
            <Sparkles className="w-3 h-3" /> Claude Desktop · Cursor · VS Code
            Copilot
          </div>
          <h2 className="text-2xl font-bold mb-3">
            AI generates it. You receive a file.
          </h2>
          <p className="text-gray-400 mb-6 leading-relaxed text-sm">
            AI can build any interactive experience — dashboard, compliance
            tool, simulation, report. The delivery problem has always been
            deployment. Install{" "}
            <span className="text-white font-mono">@dotuix/mcp</span> and that
            problem disappears: describe what you want, receive one signed .uix
            file. No hosting. No deployment. No URL.
          </p>
          <div className="space-y-3 text-left mb-5">
            <CopyBox value="npx @dotuix/mcp" />
          </div>
          <p className="text-gray-500 text-xs">
            Or share{" "}
            <a
              href="/llms.txt"
              className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
            >
              dotuix.com/llms.txt
            </a>{" "}
            with any AI (GPT, Gemini, Claude) to generate the files yourself and
            pack with the CLI.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* AI prompt builder                                                   */}
      {/* ------------------------------------------------------------------ */}
      <AIPromptBuilder />

      {/* ------------------------------------------------------------------ */}
      {/* Comparison                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">Why .uix?</h2>
        <p className="text-gray-400 text-center mb-10 max-w-xl mx-auto">
          PDF solved printable documents. EPUB solved readable documents. No
          format solved <em>executable</em> documents — until now.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm mx-auto max-w-2xl">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-widest">
                <th className="text-left py-3 pr-8 font-medium">Format</th>
                <th className="text-center py-3 px-4 font-medium">
                  Interactive
                </th>
                <th className="text-center py-3 px-4 font-medium">Offline</th>
                <th className="text-center py-3 px-4 font-medium">One file</th>
                <th className="text-center py-3 px-4 font-medium">
                  No install
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISONS.map((r) => (
                <tr
                  key={r.format}
                  className={
                    r.highlight
                      ? "bg-gradient-to-r from-blue-950/50 via-purple-950/50 to-pink-950/50 border border-white/10 rounded-lg"
                      : "border-t border-white/6"
                  }
                >
                  <td
                    className={`py-3.5 pr-8 font-medium pl-2 ${
                      r.highlight
                        ? "text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400"
                        : "text-gray-300"
                    }`}
                  >
                    {r.format}
                  </td>
                  <td className="text-center py-3.5 px-4">
                    <Check ok={r.interactive} />
                  </td>
                  <td className="text-center py-3.5 px-4">
                    <Check ok={r.offline} />
                  </td>
                  <td className="text-center py-3.5 px-4">
                    <Check ok={r.oneFile} />
                  </td>
                  <td className="text-center py-3.5 px-4">
                    <Check ok={r.noInstall} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Guide                                                               */}
      {/* ------------------------------------------------------------------ */}
      <GuideSection />

      {/* ------------------------------------------------------------------ */}
      {/* Demo downloads                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">Try it now</h2>
        <p className="text-gray-400 text-center mb-12 max-w-xl mx-auto">
          Download a pre-built demo and open it with the desktop viewer. Each
          file was generated from a template in seconds — fully offline, no
          server.
        </p>

        <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {(
            [
              {
                title: "Restaurant Menu",
                desc: "Interactive menu with categories, items, and a working cart. Arabic-ready. No WiFi.",
                file: "/demos/restaurant.uix",
                size: "6 KB",
                tag: "restaurant",
              },
              {
                title: "Product Catalogue",
                desc: "Filterable product showcase for exhibitions and showrooms. Works fully offline.",
                file: "/demos/catalog.uix",
                size: "4 KB",
                tag: "catalog",
              },
              {
                title: "Portfolio",
                desc: "Personal or agency portfolio with project showcase. Shareable as a single file.",
                file: "/demos/portfolio.uix",
                size: "5 KB",
                tag: "portfolio",
              },
            ] as {
              title: string;
              desc: string;
              file: string;
              size: string;
              tag: string;
            }[]
          ).map((d) => (
            <div
              key={d.title}
              className="rounded-xl border border-white/10 bg-white/3 p-6 flex flex-col gap-4"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">{d.title}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full border border-white/15 text-gray-500 bg-white/5">
                    {d.size}
                  </span>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {d.desc}
                </p>
              </div>
              <a
                href={d.file}
                download
                className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/8 border border-white/15 hover:bg-white/14 transition-colors text-sm font-medium text-gray-200"
              >
                <Download className="w-4 h-4" />
                Download .uix
              </a>
            </div>
          ))}
        </div>

        <p className="text-center text-gray-600 text-xs mt-8">
          Requires the{" "}
          <a
            href="https://github.com/dotuix/dotuix/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-300 underline underline-offset-2"
          >
            dotuix desktop viewer
          </a>{" "}
          to open.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Use cases                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">
          Built for every offline scenario
        </h2>
        <p className="text-gray-400 text-center mb-12 max-w-2xl mx-auto">
          Any interactive experience that benefits from portability and offline
          operation.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {USE_CASES.map((u) => (
            <div
              key={u.title}
              className="rounded-xl border border-white/8 bg-white/3 p-5 hover:bg-white/6 hover:border-white/15 transition-all"
            >
              <u.icon className="w-5 h-5 text-gray-400 mb-3" />
              <h3 className="font-semibold mb-1.5 text-sm">{u.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{u.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Ecosystem                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">The ecosystem</h2>
        <p className="text-gray-400 text-center mb-12 max-w-xl mx-auto">
          Everything you need to create, validate, and distribute .uix files.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOLS.map((tool) => (
            <a
              key={tool.name}
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-white/10 bg-white/3 p-5 hover:bg-white/6 hover:border-white/20 transition-all group block"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-mono font-semibold text-sm group-hover:text-white transition-colors">
                  {tool.name}
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ml-2 ${
                    tool.tag === "npm"
                      ? "border-red-500/30 text-red-400 bg-red-500/10"
                      : tool.tag === "ext"
                      ? "border-blue-500/30 text-blue-400 bg-blue-500/10"
                      : "border-white/15 text-gray-500 bg-white/5"
                  }`}
                >
                  {tool.tag}
                </span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                {tool.desc}
              </p>
            </a>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Security callout                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">
          Immutable. Signed. Verifiable.
        </h2>
        <p className="text-gray-400 text-center mb-10 max-w-xl mx-auto">
          Most software trusts a server. .uix files carry their own trust —
          signatures, encryption, PIN auth, and open limits are part of the
          format. No cloud required. Regular apps omit the security block
          entirely and are unaffected.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {(
            [
              {
                icon: KeyRound,
                title: "PIN auth",
                desc: "Viewer prompts before opening. Key derived with PBKDF2-SHA256. No server.",
              },
              {
                icon: ShieldCheck,
                title: "AES-256-GCM encryption",
                desc: "Selected files encrypted at rest. Decrypted in memory after auth. Never written to disk.",
              },
              {
                icon: FileSignature,
                title: "Ed25519 signatures",
                desc: "Bundle signed over all file hashes. Viewer refuses tampered files before any content runs.",
              },
              {
                icon: Timer,
                title: "Expiry & open limits",
                desc: "Files expire by date or after N opens. Tracked by the viewer locally — the file cannot bypass it.",
              },
            ] as { icon: LucideIcon; title: string; desc: string }[]
          ).map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/10 bg-white/3 p-5"
            >
              <f.icon className="w-5 h-5 text-purple-400 mb-3" />
              <h3 className="font-semibold text-sm mb-1.5">{f.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Desktop viewer download                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <div className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-white/3 p-10">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-3">Desktop viewer</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                The dotuix desktop app opens any{" "}
                <code className="text-gray-300">.uix</code> file fully offline —
                kiosk mode, PIN auth, Ed25519 signature verification, and a
                built-in developer mode with live preview and DB browser.
                Available for macOS, Windows, and Linux.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://github.com/dotuix/dotuix/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:opacity-90 transition-opacity text-sm font-medium"
                >
                  Download v0.2.0 →
                </a>
                <a
                  href="https://github.com/dotuix/dotuix/tree/main/apps/viewer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 transition-colors text-sm font-medium text-gray-300"
                >
                  View source →
                </a>
              </div>
            </div>
            <div className="text-gray-500 text-sm space-y-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-green-400">✓</span> macOS (Apple Silicon +
                Intel)
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Windows
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Linux
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Developer mode built
                in
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Format reference                                                    */}
      {/* ------------------------------------------------------------------ */}
      <FormatRefSection />

      {/* ------------------------------------------------------------------ */}
      {/* Quick install                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3">Get started</h2>
          <p className="text-gray-400 mb-8">
            Install the CLI, create your first .uix file in minutes.
          </p>

          <div className="space-y-3 text-left">
            <CopyBox value="npm install -g @dotuix/cli" />
            <CopyBox value="dotuix init my-app -t restaurant" />
            <CopyBox value="dotuix pack ./my-app" />
          </div>

          <p className="text-gray-500 text-sm mt-6">
            Or install the{" "}
            <a
              href="https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix"
              className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
            >
              VS Code extension
            </a>{" "}
            for IntelliSense, file icons, and one-click pack/validate.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-white/8 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 font-bold">
              dot
            </span>
            uix · MIT License
          </span>
          <div className="flex items-center gap-5">
            <a
              href="https://github.com/dotuix/dotuix"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              llms.txt
            </a>
            <a
              href="https://github.com/dotuix/dotuix/blob/main/spec/spec.md"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              Spec
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/core"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              @dotuix/core
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/cli"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              @dotuix/cli
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              @dotuix/mcp
            </a>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              VS Code
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
