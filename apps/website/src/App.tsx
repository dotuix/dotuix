import { useState } from "react";

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

const USE_CASES = [
  {
    icon: "🍽",
    title: "Restaurant kiosk",
    desc: "Gulf menu on a tablet — Arabic, QAR prices, working cart. No WiFi needed.",
  },
  {
    icon: "🏪",
    title: "Retail catalogue",
    desc: "Product showcase at exhibitions — category filters, SKU, pricing. No internet.",
  },
  {
    icon: "🏛",
    title: "Government forms",
    desc: "Offline intake forms with built-in validation. Submit when connectivity returns.",
  },
  {
    icon: "🔒",
    title: "Classified briefing",
    desc: "Encrypted, signed, expiry-limited. Air-gapped. PIN auth. Tamper-evident.",
  },
  {
    icon: "🏥",
    title: "Healthcare reference",
    desc: "Drug interactions for remote clinics. No account, no app install required.",
  },
  {
    icon: "📚",
    title: "Education",
    desc: "Self-contained exercises with progress tracked in state.db. USB-distributable.",
  },
  {
    icon: "💼",
    title: "Sales proposals",
    desc: "Live budget calculators, Gantt charts. Signed and frozen on submission.",
  },
  {
    icon: "🚀",
    title: "Extreme remote",
    desc: "Procedure manuals for spacecraft and polar expeditions. Fully air-gapped.",
  },
];

const HOW_IT_WORKS = [
  {
    n: "1",
    title: "Point your AI at the spec",
    desc: "Share dotuix.com/llms.txt with GPT, Gemini, Claude, or any AI. It contains the full format: manifest fields, bridge API, SQLite schema, and code examples.",
    code: `# Tell your AI:
"Read dotuix.com/llms.txt and
build a restaurant menu .uix
for Al Madina with 10 items."`,
  },
  {
    n: "2",
    title: "AI generates the files",
    desc: "The AI produces manifest.json, index.html, app.js, style.css — all correct .uix structure. Via MCP (Claude Desktop, Cursor) the agent packs it for you automatically.",
    code: `# Via MCP — one call:
create({ manifest, files })
✓ my-app.uix — ready

# Or save files and:
$ dotuix pack ./my-app`,
  },
  {
    n: "3",
    title: "Share and open offline",
    desc: "Share the .uix file over email, USB, AirDrop, or any file transfer. The desktop viewer opens it fully offline — no internet, no install beyond the viewer.",
    code: `$ dotuix validate my-menu.uix
✓  manifest valid
✓  entry index.html found
✓  data.db schema correct
✓  no external URLs`,
  },
];

const TOOLS = [
  {
    name: "@dotuix/mcp",
    desc: "MCP server — connects Claude Desktop, Cursor, and VS Code Copilot. Say what you want; the AI generates and packs the .uix for you.",
    href: "https://www.npmjs.com/package/@dotuix/mcp",
    tag: "npm",
  },
  {
    name: "@dotuix/ai",
    desc: "One-function SDK for AI-generated code. createUIX({ manifest, files }) — handles everything and stamps AI provenance.",
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
              className="hover:text-white transition-colors hidden sm:block"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/cli"
              className="hover:text-white transition-colors hidden sm:block"
            >
              npm
            </a>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix"
              className="hover:text-white transition-colors hidden sm:block"
            >
              VS Code
            </a>
            <a
              href="https://github.com/dotuix/dotuix"
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
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-4 leading-[1.1]">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
            .uix
          </span>{" "}
          — one file.
          <br />
          offline. interactive.
        </h1>

        {/* category */}
        <p className="text-base text-gray-500 mb-5 tracking-wide">
          The{" "}
          <span className="text-gray-300 font-medium">
            transport format for AI-generated software
          </span>{" "}
          — and everything else that needs to run offline.
        </p>

        {/* subtext */}
        <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Pack any HTML/JS app into a single portable file.
          <br className="hidden sm:block" />
          No server. No URL. No install. Runs fully offline — in a clinic, a
          courtroom, an air-gapped datacenter, or a kiosk in a remote camp.
        </p>

        {/* CTAs */}
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
        <div className="max-w-lg mx-auto rounded-xl border border-white/10 bg-white/3 overflow-hidden text-left shadow-2xl">
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
          No existing format covers all four properties at once.
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
              <div className="text-2xl mb-3">{u.icon}</div>
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
          Built-in trust model
        </h2>
        <p className="text-gray-400 text-center mb-10 max-w-xl mx-auto">
          Regular apps omit the security block entirely and are unaffected. For
          classified or access-controlled content, it’s all built in.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {[
            {
              icon: "🔐",
              title: "PIN auth",
              desc: "Viewer prompts before opening. Key derived with PBKDF2-SHA256. No server.",
            },
            {
              icon: "🛡️",
              title: "AES-256-GCM encryption",
              desc: "Selected files encrypted at rest. Decrypted in memory after auth. Never written to disk.",
            },
            {
              icon: "✏️",
              title: "Ed25519 signatures",
              desc: "Bundle signed over all file hashes. Viewer refuses tampered files before any content runs.",
            },
            {
              icon: "⏱️",
              title: "Expiry & open limits",
              desc: "Files expire by date or after N opens. Tracked by the viewer locally — the file cannot bypass it.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/10 bg-white/3 p-5"
            >
              <div className="text-2xl mb-3">{f.icon}</div>
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
            ✦ Claude Desktop · Cursor · VS Code Copilot
          </div>
          <h2 className="text-2xl font-bold mb-3">
            Skip the manual step entirely
          </h2>
          <p className="text-gray-400 mb-6 leading-relaxed text-sm">
            Install <span className="text-white font-mono">@dotuix/mcp</span>{" "}
            and your AI agent generates <em>and packs</em> the .uix file in one
            conversation — no terminal, no copy-paste. Just describe the app and
            get a file.
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
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://dotuix.com/llms.txt"
              className="hover:text-gray-300 transition-colors"
            >
              llms.txt
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/core"
              className="hover:text-gray-300 transition-colors"
            >
              @dotuix/core
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/cli"
              className="hover:text-gray-300 transition-colors"
            >
              @dotuix/cli
            </a>
            <a
              href="https://www.npmjs.com/package/@dotuix/mcp"
              className="hover:text-gray-300 transition-colors"
            >
              @dotuix/mcp
            </a>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=intenttext.dotuix"
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
