/**
 * @dotuix/mcp-server — Remote HTTP MCP server
 *
 * Hosted at https://dotuix.com/mcp
 *
 * Implements MCP Streamable HTTP transport so any MCP-capable AI client
 * (Claude Desktop, Cursor, Windsurf) can connect with just a URL — no local
 * install required.
 *
 * Tools:
 *   get_spec    — returns llms.txt
 *   create      — manifest + files + dataRecords → packed .uix + download URL
 *   validate    — validates a .uix from a URL or base64 payload
 *
 * Generated .uix files are kept in memory for 30 minutes, then evicted.
 * Download them at: GET /download/:id
 */

import * as http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { packBuffer, validateBuffer, createDataDb } from "@dotuix/core";
import type { DataRecord } from "@dotuix/core";
import { randomUUID } from "node:crypto";

const SPEC_URL = "https://dotuix.com/llms.txt";
const DOWNLOAD_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BASE_URL = process.env.BASE_URL ?? "https://dotuix-mcp.server.jadwal.io";
const PORT = Number(process.env.PORT ?? 3100);

// ---------------------------------------------------------------------------
// In-memory file store  { id → { bytes, expiresAt, filename } }
// ---------------------------------------------------------------------------

interface StoredFile {
  bytes: Uint8Array;
  filename: string;
  expiresAt: number;
}

const store = new Map<string, StoredFile>();

function storeFile(bytes: Uint8Array, filename: string): string {
  const id = randomUUID();
  store.set(id, { bytes, filename, expiresAt: Date.now() + DOWNLOAD_TTL_MS });
  return id;
}

// Evict expired files every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, f] of store) {
    if (f.expiresAt < now) store.delete(id);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Build a .uix buffer from manifest + files + optional dataRecords
// ---------------------------------------------------------------------------

async function buildUix(opts: {
  name: string;
  manifest: Record<string, unknown>;
  files: Array<{ path: string; content: string }>;
  dataRecords?: DataRecord[];
  generatedBy?: string;
}): Promise<Uint8Array> {
  const { name, manifest, files, dataRecords, generatedBy } = opts;

  // Stamp ai provenance in manifest
  const stamped = {
    ...manifest,
    ai: {
      ...(typeof manifest.ai === "object" && manifest.ai !== null
        ? (manifest.ai as object)
        : {}),
      generatedBy: generatedBy ?? "@dotuix/mcp-server",
      generatedAt: new Date().toISOString(),
    },
  };

  // Build file map: path → Uint8Array
  const enc = new TextEncoder();
  const fileMap: Record<string, Uint8Array> = {
    "manifest.json": enc.encode(JSON.stringify(stamped, null, 2)),
  };

  for (const file of files) {
    fileMap[file.path] = enc.encode(file.content);
  }

  // Seed data.db if records provided
  if (dataRecords && dataRecords.length > 0) {
    fileMap["data.db"] = await createDataDb(dataRecords);
  }

  return packBuffer(fileMap);
}

// ---------------------------------------------------------------------------
// MCP server factory — one server instance per HTTP request (stateless)
// ---------------------------------------------------------------------------

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "dotuix", version: "0.1.0" });

  // ── get_spec ──────────────────────────────────────────────────────────────
  server.tool(
    "get_spec",
    "Returns the full .uix format specification — bridge API, SQLite schema, " +
      "manifest fields, CLI reference, and code examples. Read this before generating any .uix files.",
    {},
    async () => {
      try {
        const res = await fetch(SPEC_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { content: [{ type: "text", text: await res.text() }] };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch spec: ${
                (e as Error).message
              }\nVisit: ${SPEC_URL}`,
            },
          ],
        };
      }
    },
  );

  // ── create ────────────────────────────────────────────────────────────────
  server.tool(
    "create",
    "Create a complete .uix file. Provide the manifest, source files, and optionally " +
      "dataRecords to seed into data.db (creator content: menu items, products, catalog). " +
      "Returns a download URL valid for 30 minutes.",
    {
      name: z.string().describe("App name used as the output filename."),
      manifest: z
        .record(z.unknown())
        .describe(
          "manifest.json as a JSON object (ai block is stamped automatically).",
        ),
      files: z
        .array(
          z.object({
            path: z.string().describe("Relative path, e.g. 'index.html'"),
            content: z.string().describe("UTF-8 file content."),
          }),
        )
        .describe("Source files — do NOT include manifest.json here."),
      dataRecords: z
        .array(
          z.object({
            id: z
              .string()
              .optional()
              .describe("Optional explicit id, e.g. 'product:001'."),
            type: z
              .string()
              .describe("Record type, e.g. 'product', 'category'."),
            body: z
              .record(z.unknown())
              .describe("Record body as a plain object."),
          }),
        )
        .optional()
        .describe(
          "Creator records to seed into data.db. " +
            "Use this instead of hardcoding content arrays in app.js. " +
            "App reads them with uix.data.find({ type: 'product' }).",
        ),
      generatedBy: z
        .string()
        .optional()
        .describe("Override ai.generatedBy stamp, e.g. 'claude-opus-4'."),
    },
    async ({ name, manifest, files, dataRecords, generatedBy }) => {
      try {
        const bytes = await buildUix({
          name,
          manifest,
          files,
          dataRecords: dataRecords as DataRecord[] | undefined,
          generatedBy,
        });

        const filename = `${name.replace(/[^a-z0-9_-]/gi, "-")}.uix`;
        const id = storeFile(bytes, filename);
        const url = `${BASE_URL}/download/${id}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  downloadUrl: url,
                  filename,
                  bytes: bytes.byteLength,
                  dataRecordsSeeded: dataRecords?.length ?? 0,
                  expiresIn: "30 minutes",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── validate ──────────────────────────────────────────────────────────────
  server.tool(
    "validate",
    "Validate a .uix file provided as a base64-encoded string. " +
      "Returns { valid, errors, warnings }.",
    {
      data: z.string().describe("Base64-encoded .uix file content."),
    },
    async ({ data }) => {
      try {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const result = await validateBuffer(bytes);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Native HTTP server — routes: /health  /download/:id  /mcp
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id",
    });
    res.end();
    return;
  }

  // Health check
  if (url.pathname === "/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, service: "dotuix-mcp-server" });
    return;
  }

  // File download: GET /download/:id
  const dlMatch = url.pathname.match(/^\/download\/([a-f0-9-]+)$/);
  if (dlMatch && req.method === "GET") {
    const file = store.get(dlMatch[1]);
    if (!file || file.expiresAt < Date.now()) {
      sendJson(res, 404, { error: "File not found or expired" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(file.bytes.byteLength),
      "Access-Control-Allow-Origin": "*",
    });
    res.end(file.bytes);
    return;
  }

  // MCP endpoint: POST /mcp — stateless, one transport per request
  if (url.pathname === "/mcp" && req.method === "POST") {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    await server.connect(transport);
    const body = await readBody(req);
    // Attach parsed body so the transport can read it synchronously
    (req as http.IncomingMessage & { body?: unknown }).body = JSON.parse(
      body.toString("utf8") || "null",
    );
    await transport.handleRequest(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`dotuix MCP server → http://localhost:${PORT}`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`  Health:       http://localhost:${PORT}/health`);
});
