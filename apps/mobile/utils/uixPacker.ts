/**
 * utils/uixPacker.ts
 *
 * ZIP pack / unpack helpers for .uix files.
 * Uses fflate for pure-JS decompression; Buffer global for base64 <-> bytes.
 */

import * as FileSystem from 'expo-file-system';
import { unzipSync, zipSync, strFromU8 } from 'fflate';

// base64 <-> Uint8Array

export function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// .uix parsing

export interface UixContents {
  manifest: Record<string, unknown>;
  /** All files from the ZIP keyed by path */
  files: Record<string, Uint8Array>;
  dataDb: Uint8Array | null;
  stateDb: Uint8Array | null;
}

export function unpackUix(bytes: Uint8Array): UixContents {
  const files = unzipSync(bytes);
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('Invalid .uix file: missing manifest.json');
  const manifest = JSON.parse(strFromU8(manifestBytes)) as Record<string, unknown>;
  return {
    manifest,
    files,
    dataDb: files['data.db'] ?? null,
    stateDb: files['state.db'] ?? null,
  };
}

/**
 * Write every file except data.db / state.db to `dir`.
 * Injects `bridgeHtml` (a <script> tag string) into index.html before </head>.
 */
export async function extractSession(
  files: Record<string, Uint8Array>,
  dir: string,
  bridgeHtml: string,
): Promise<void> {
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  for (const [name, bytes] of Object.entries(files)) {
    if (name === 'data.db' || name === 'state.db') continue;
    if (name.endsWith('/')) continue;

    const filePath = `${dir}/${name}`;

    const slash = name.lastIndexOf('/');
    if (slash !== -1) {
      await FileSystem.makeDirectoryAsync(`${dir}/${name.slice(0, slash)}`, {
        intermediates: true,
      }).catch(() => {});
    }

    if (name === 'index.html') {
      let html = strFromU8(bytes);
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${bridgeHtml}`);
      } else {
        html = bridgeHtml + '\n' + html;
      }
      await FileSystem.writeAsStringAsync(filePath, html, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    } else {
      await FileSystem.writeAsStringAsync(filePath, bytesToBase64(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  }
}

export function repackUix(
  originalFiles: Record<string, Uint8Array>,
  newStateDb: Uint8Array,
): Uint8Array {
  return zipSync({ ...originalFiles, 'state.db': newStateDb });
}

/**
 * Build the <script> block injected into index.html.
 * Mirrors the Tauri bridge surface but uses ReactNativeWebView.postMessage.
 */
export function makeMobileBridgeScript(manifest: Record<string, unknown>): string {
  const manifestJson = JSON.stringify(manifest);
  return `<script>
(function () {
  if (window.__uix) return;
  var m = ${manifestJson};
  var _viewer_version = "0.1.0-mobile";
  var _perms = (m.permissions || []);
  var _seq = 0;
  window._uixPending = {};

  function relay(cmd, payload) {
    return new Promise(function (resolve, reject) {
      var id = ++_seq;
      window._uixPending[id] = function (ok, data) {
        if (ok) resolve(data); else reject(new Error(data));
      };
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ __dotuix: true, id: id, cmd: cmd, payload: payload || {} })
      );
    });
  }

  window.__uix = {
    manifest: function () { return m; },
    data: {
      find: function (opts) {
        var q = (typeof opts === 'string') ? { type: opts } : Object.assign({}, opts);
        return relay('data_find', { query: q });
      },
      get:   function (id)           { return relay('data_get',   { id: id }); },
      count: function (opts) {
        var q = (typeof opts === 'string') ? { type: opts } : Object.assign({}, opts);
        return relay('data_count', { query: q });
      },
      raw: function (sql, params) { return relay('data_raw', { sql: sql, params: params || [] }); },
    },
    state: {
      find: function (opts) {
        var q = (typeof opts === 'string') ? { type: opts } : Object.assign({}, opts);
        return relay('state_find', { query: q });
      },
      get:    function (id)         { return relay('state_get',    { id: id }); },
      insert: function (opts) {
        var body = opts.body;
        if (typeof body !== 'string') body = JSON.stringify(body);
        return relay('state_insert', { type: opts.type, body: body });
      },
      update: function (id, body) {
        if (typeof body !== 'string') body = JSON.stringify(body);
        return relay('state_update', { id: id, body: body });
      },
      delete: function (id)         { return relay('state_delete', { id: id }); },
      purge:  function (opts) {
        return relay('state_purge', { type: (opts && opts.type) || opts, older_than: (opts && opts.olderThan) || '30d' });
      },
      count: function (opts) {
        var q = (typeof opts === 'string') ? { type: opts } : Object.assign({}, opts);
        return relay('state_count', { query: q });
      },
      transaction: function (ops) {
        var normalized = (ops || []).map(function (op) {
          var o = Object.assign({}, op);
          if (o.body && typeof o.body === 'string') { try { o.body = JSON.parse(o.body); } catch (e) {} }
          return o;
        });
        return relay('state_transaction', { ops: normalized });
      },
      clear: function (opts) {
        var p = {};
        if (opts && opts.type) p.record_type = opts.type;
        return relay('state_clear', p);
      },
      reset:      function ()       { return relay('state_reset',  {}); },
      upsert: function (opts) {
        var body = opts.body;
        if (typeof body !== 'string') body = JSON.stringify(body);
        return relay('state_upsert', { id: opts.id, type: opts.type, body: body });
      },
      insertMany: function (records) {
        var n = (records || []).map(function (r) {
          var o = Object.assign({}, r);
          if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
          return o;
        });
        return relay('state_insert_many', { records: n });
      },
      size:   function ()           { return relay('state_size',   {}); },
      vacuum: function ()           { return relay('state_vacuum', {}); },
      export: function (opts) {
        opts = opts || {};
        var p;
        if (opts.type) {
          p = relay('state_find', { query: { type: opts.type } });
        } else if (_perms.indexOf('raw-sql') !== -1) {
          p = relay('state_raw', { sql: 'SELECT id, type, body, created_at, updated_at FROM records ORDER BY created_at', params: [] });
        } else {
          return Promise.reject(new Error("state.export() without a type filter requires the raw-sql permission."));
        }
        return p.then(function (all) {
          if (opts.before) { var c = opts.before; all = all.filter(function (r) { return r.created_at < c; }); }
          return JSON.stringify(all);
        });
      },
      raw:  function (sql, params)  { return relay('state_raw',   { sql: sql, params: params || [] }); },
      sync: function ()             { return Promise.reject(new Error('state.sync() is not available on mobile.')); },
    },
    clipboard: {
      write: function (text) {
        if (_perms.indexOf('clipboard-write') === -1)
          return Promise.reject(new Error("Permission denied: clipboard-write not declared."));
        return relay('clipboard_write', { text: text });
      },
    },
    fullscreen: {
      enter:  function () { return Promise.resolve(); },
      exit:   function () { return Promise.resolve(); },
      toggle: function () { return Promise.resolve(); },
    },
    viewer:  { version: function () { return _viewer_version; } },
    browser: { open: function (url) { return relay('uix_open_url', { url: url }); } },
    window:  { setTitle: function (title) { return relay('uix_set_title', { title: title }); } },
    notify:  function (title, body) { return relay('uix_notify', { title: title, body: body }); },
    file: {
      save: function (filename, content, mimeType) {
        var b64;
        if (content instanceof ArrayBuffer) {
          var bytes = new Uint8Array(content);
          var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
          b64 = btoa(s);
        } else {
          b64 = btoa(unescape(encodeURIComponent(String(content))));
        }
        return relay('uix_save_file', { filename: filename, content_b64: b64 });
      },
      open: function (opts) { return relay('uix_open_file', { filter: (opts || {}).filter || null }); },
    },
    print:   function () { window.print(); },
    exit:    function () { return relay('uix_exit', {}); },
  };
  window.uix = window.__uix;
})();
</script>`;
}
