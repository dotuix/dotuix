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
  const ua = navigator.userAgent;
  if (/Macintosh/.test(ua)) return "mac-arm"; // default Apple Silicon; Intel shown as secondary
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
  const [version, setVersion] = useState("v0.2.0");

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
      .catch(() => {/* fallback urls used */});
  }, []);

  return { urls, version };
}

function PlatformDownloadButton() {
  const platform = detectPlatform();
  const { urls, version } = usePlatformUrls();
  const fallback = "https://github.com/dotuix/dotuix/releases/latest";

  const config: Record<PlatformKey, { text: string; hint: string; key: string; altText?: string; altKey?: string }> = {
    "mac-arm": {
      text: "Download for macOS",
      hint: "Apple Silicon  ·  .dmg",
      key: "mac-arm",
      altText: "Intel Mac",
      altKey: "mac-intel",
    },
    "mac-intel": {
      text: "Download for macOS (Intel)",
      hint: "Intel  ·  .dmg",
      key: "mac-intel",
      altText: "Apple Silicon",
      altKey: "mac-arm",
    },
    windows: { text: "Download for Windows", hint: "Windows 10+  ·  .msi", key: "windows" },
    linux: { text: "Download for Linux", hint: ".AppImage  ·  most distros", key: "linux" },
    other: { text: "Download Desktop Viewer", hint: "macOS  ·  Windows  ·  Linux", key: "" },
  };

  const { text, hint, key, altText, altKey } = config[platform];
  const primaryUrl = (key && urls[key]) || fallback;
  const altUrl = altKey ? (urls[altKey] || fallback) : null;

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
            className="text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
          >
            {altText} →
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
      { key: "cuisine", placeholder: "Cuisine type (e.g. Qatari, Italian)", required: false },
      { key: "city", placeholder: "City / location", required: false },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://dotuix.com/llms.txt

Build a restaurant kiosk .uix file for ${vals.name || "my restaurant"}${vals.cuisine ? ` — ${vals.cuisine} cuisine` : ""}${vals.city ? `, ${vals.city}` : ""}.

Output exactly these files (no other files):
• manifest.json — id, name, version, entry, author
• index.html — app shell
• app.js — menu data and cart logic using the window.__uix bridge
• style.css — professional kiosk styling, touch-friendly

Requirements:
- No external URLs (fully offline)
- If Gulf restaurant: include Arabic + English labels
- At least 8 sample menu items across 3 categories
- Working add-to-cart with order total

After generating all files, tell me to run:
  dotuix pack ./[folder-name]
to create the final .uix file.`,
  },
  {
    id: "catalog",
    label: "Product catalogue",
    fields: [
      { key: "company", placeholder: "Company or brand name", required: true },
      { key: "product", placeholder: "What products? (e.g. furniture, electronics)", required: true },
      { key: "count", placeholder: "How many sample products? (e.g. 20)", required: false },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://dotuix.com/llms.txt

Build a product catalogue .uix file for ${vals.company || "my company"} selling ${vals.product || "products"}.

Output exactly these files:
• manifest.json
• index.html
• app.js — product data, category filters, search
• style.css — clean exhibition/showroom styling

Requirements:
- No external URLs
- At least ${vals.count || "12"} sample products with name, price, description, category
- Filterable by category, searchable by name
- Works offline, no server

After generating: dotuix pack ./[folder-name]`,
  },
  {
    id: "portfolio",
    label: "Portfolio / showcase",
    fields: [
      { key: "name", placeholder: "Your name", required: true },
      { key: "role", placeholder: "Your role (e.g. designer, engineer)", required: false },
      { key: "projects", placeholder: "Key projects or skills (brief)", required: false },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://dotuix.com/llms.txt

Build a portfolio .uix file for ${vals.name || "me"}, a ${vals.role || "professional"}.${vals.projects ? ` Focus on: ${vals.projects}.` : ""}

Output exactly these files:
• manifest.json
• index.html
• app.js — portfolio data and interactivity
• style.css — professional, modern design

Sections: About, Projects (at least 4), Skills, Contact
- No external URLs
- Shareable as a single file

After generating: dotuix pack ./[folder-name]`,
  },
  {
    id: "report",
    label: "Report / dashboard",
    fields: [
      { key: "title", placeholder: "Report title", required: true },
      { key: "subject", placeholder: "Data type / subject (e.g. quarterly sales, hospital stats)", required: false },
      { key: "metrics", placeholder: "Key metrics or sections to include", required: false },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://dotuix.com/llms.txt

Build an interactive report .uix file titled "${vals.title || "My Report"}".${vals.subject ? ` Subject: ${vals.subject}.` : ""}${vals.metrics ? ` Include: ${vals.metrics}.` : ""}

Output exactly these files:
• manifest.json
• index.html
• app.js — report data, charts, interactive filters
• style.css — clean report/dashboard design

Requirements:
- No external URLs
- Use sample/realistic data
- Print-friendly layout option

After generating: dotuix pack ./[folder-name]`,
  },
  {
    id: "custom",
    label: "Custom",
    fields: [
      { key: "description", placeholder: "Describe what you want to build…", required: true },
    ],
    buildPrompt: (vals: Record<string, string>) =>
      `Read the full dotuix format spec at https://dotuix.com/llms.txt

Build a .uix file for: ${vals.description || "[describe your app]"}

Output exactly these files:
• manifest.json — id, name, version, entry, author fields
• index.html — app shell
• app.js — all app logic
• style.css — clean, professional design

Rules:
- No external URLs anywhere (fully offline)
- Use window.__uix.db for any local data or storage
- Responsive design

After generating all files, tell me to run:
  dotuix pack ./[folder-name]`,
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
            <Sparkles className="w-3 h-3" /> Works with ChatGPT · Gemini · Claude
          </div>
          <h2 className="text-3xl font-bold mb-3">Generate with any AI</h2>
          <p className="text-gray-400 max-w-xl mx-auto leading-relaxed">
            No API key. No backend. Pick a template, fill in details, copy the prompt into
            any AI — then pack the files it gives you with the CLI.
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
            <span className="text-xs text-gray-500 font-medium">Generated prompt — paste into any AI</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              {copied ? (
                <><CheckCheck className="w-3.5 h-3.5 text-green-400" /> Copied!</>
              ) : (
                <><Copy className="w-3.5 h-3.5" /> Copy</>
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
              <><CheckCheck className="w-4 h-4" /> Prompt copied!</>
            ) : (
              <><Copy className="w-4 h-4" /> Copy prompt</>
            )}
          </button>
          <p className="text-xs text-gray-500 leading-relaxed">
            Paste into any AI. Save the files it outputs.{" "}
            Then: <code className="text-gray-400 bg-white/5 px-1.5 py-0.5 rounded">dotuix pack ./folder</code>
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

const HOW_IT_WORKS = [
  {
    n: "1",
    title: "Give your AI the spec",
    desc: "Share dotuix.com/llms.txt with any AI — GPT, Gemini, Claude. It contains the full format: manifest fields, bridge API, SQLite schema, and runnable examples. The AI knows exactly what to build.",
    code: `# Tell your AI:
"Read dotuix.com/llms.txt and
build a feasibility study .uix
for a restaurant in Doha."`,
  },
  {
    n: "2",
    title: "AI builds and packs it",
    desc: "The AI produces manifest.json, index.html, app.js, style.css — all valid .uix structure. Via MCP (Claude Desktop, Cursor) the agent packs and signs the bundle in one call.",
    code: `# Via MCP — one conversation:
create({ manifest, files })
✓ feasibility-study.uix — ready

# Or pack manually:
$ dotuix pack ./my-app`,
  },
  {
    n: "3",
    title: "Distribute. Open anywhere.",
    desc: "Send the file over email, USB, AirDrop — any transfer method. The desktop viewer opens it fully offline: no internet, no server, no install beyond the viewer itself.",
    code: `$ dotuix validate study.uix
✓  manifest valid
✓  entry index.html found
✓  data.db schema correct
✓  no external URLs`,
  },
];

const TOOLS = [
  {
    name: "@dotuix/mcp",
    desc: "MCP server for Claude Desktop, Cursor, and VS Code Copilot. The canonical AI interface for creating .uix files — one conversation, one signed file.",
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
    desc: "Core library — pack, unpack, validate, sign, read/write SQLite.",
    href: "https://www.npmjs.com/package/@dotuix/core",
    tag: "npm",
  },
  {
    name: "@dotuix/cli",
    desc: "CLI — pack, validate, init, sign, encrypt, export. Install globally.",
    href: "https://www.npmjs.com/package/@dotuix/cli",
    tag: "npm",
  },
  {
    name: "VS Code Extension",
    desc: "Manifest IntelliSense, .uix file icon, pack & validate commands.",
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
          Open format · MIT · v0.2.0
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
      {/* How it works                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">How it works</h2>
        <p className="text-gray-400 text-center mb-12 max-w-xl mx-auto">
          Tell any AI what you want. It generates the files, you pack them.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((step) => (
            <div
              key={step.n}
              className="rounded-xl border border-white/10 bg-white/3 p-6 flex flex-col"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold mb-4 shrink-0">
                {step.n}
              </div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-gray-400 text-sm mb-4 leading-relaxed flex-1">
                {step.desc}
              </p>
              <pre className="text-xs font-mono text-gray-400 bg-black/30 rounded-lg p-3 leading-6 overflow-x-auto">
                {step.code}
              </pre>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Demo downloads                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <h2 className="text-3xl font-bold text-center mb-3">Try it now</h2>
        <p className="text-gray-400 text-center mb-12 max-w-xl mx-auto">
          Download a pre-built demo and open it with the desktop viewer. Each file
          was generated from a template in seconds — fully offline, no server.
        </p>

        <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {([
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
          ] as { title: string; desc: string; file: string; size: string; tag: string }[]).map((d) => (
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
                <p className="text-gray-400 text-sm leading-relaxed">{d.desc}</p>
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
      {/* Format spec callout                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/8">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-blue-950/30 via-purple-950/30 to-pink-950/30 p-10 text-center">
          <h2 className="text-2xl font-bold mb-3">Open format, open spec</h2>
          <p className="text-gray-400 max-w-2xl mx-auto mb-6 leading-relaxed">
            The .uix format spec is open. Anyone can build a viewer, tool, or
            integration without asking permission. If the tools disappear, every
            .uix file ever created can still be opened by any future
            implementation that follows the spec.
          </p>
          <a
            href="https://github.com/dotuix/dotuix"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-white/20 bg-white/8 hover:bg-white/12 transition-colors text-sm font-medium"
          >
            Read the source on GitHub →
          </a>
        </div>
      </section>

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
              href="https://dotuix.com/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              llms.txt
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
