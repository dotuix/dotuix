import type { Manifest, UIXRecord } from "@dotuix/core";
import type { UIXDataDB, UIXStateDB } from "@dotuix/core";

// ---------------------------------------------------------------------------
// Bridge script injected into the iframe HTML
//
// This runs inside the .uix app's context (no access to our modules).
// All DB calls are forwarded to the parent via postMessage and resolved async.
// ---------------------------------------------------------------------------

export function generateBridgeScript(manifest: Manifest): string {
  const m = JSON.stringify(manifest);
  return `(function(){
  var _manifest = ${m};
  var _id = 0;
  var _pending = {};

  window.addEventListener('message', function(ev) {
    var d = ev.data;
    if (d && d.__uixr && _pending[d.id]) {
      var p = _pending[d.id];
      delete _pending[d.id];
      d.e ? p.rej(new Error(d.e)) : p.res(d.r);
    }
  });

  function _call(m, p) {
    return new Promise(function(res, rej) {
      var id = ++_id;
      _pending[id] = { res: res, rej: rej };
      window.parent.postMessage({ __uixc: true, id: id, m: m, p: p }, '*');
    });
  }

  window.__uix = {
    data: {
      find:  function(q)         { return _call('d.find',   q);                    },
      get:   function(id)        { return _call('d.get',    { id: id });            },
      raw:   function(s, params) { return _call('d.raw',    { sql: s, params: params }); },
    },
    state: {
      find:   function(q)         { return _call('s.find',   q);                          },
      get:    function(id)        { return _call('s.get',    { id: id });                  },
      insert: function(r)         { return _call('s.insert', r);                          },
      update: function(id, body)  { return _call('s.update', { id: id, body: body });     },
      delete: function(id)        { return _call('s.delete', { id: id });                 },
      raw:    function(s, params) { return _call('s.raw',    { sql: s, params: params }); },
      purge:  function(q)         { return _call('s.purge',  q);                          },
    },
    manifest: function() { return Promise.resolve(_manifest); },
    print:    function() { window.print(); },
    exit:     function() {},
  };
})();`;
}

// ---------------------------------------------------------------------------
// Message handler — runs in the parent (Viewer component)
// Routes postMessage calls from the iframe to the real DB objects
// ---------------------------------------------------------------------------

export interface BridgeHandlerOptions {
  dataDb: UIXDataDB | null;
  stateDb: UIXStateDB;
  onStateChange: () => void;
}

export function createMessageHandler(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  opts: BridgeHandlerOptions,
) {
  const { dataDb, stateDb, onStateChange } = opts;

  return async function handleMessage(ev: MessageEvent) {
    const d = ev.data;
    if (!d || !d.__uixc) return;

    const { id, m, p } = d as { id: number; m: string; p: unknown };
    const post = (result: unknown) =>
      iframeRef.current?.contentWindow?.postMessage(
        { __uixr: true, id, r: result },
        "*",
      );
    const postErr = (e: unknown) =>
      iframeRef.current?.contentWindow?.postMessage(
        { __uixr: true, id, e: String(e) },
        "*",
      );

    try {
      let result: unknown;

      switch (m) {
        // data (read-only)
        case "d.find":
          result = dataDb
            ? dataDb.find(p as Parameters<UIXDataDB["find"]>[0])
            : [];
          break;
        case "d.get": {
          const { id: rid } = p as { id: string };
          result = dataDb ? dataDb.get(rid) : null;
          break;
        }
        case "d.raw": {
          const { sql, params } = p as { sql: string; params?: unknown[] };
          result = dataDb
            ? dataDb.raw(sql, (params ?? []) as (string | number | null)[])
            : [];
          break;
        }

        // state (read-write)
        case "s.find":
          result = stateDb.find(p as Parameters<UIXStateDB["find"]>[0]);
          break;
        case "s.get": {
          const { id: rid } = p as { id: string };
          result = stateDb.get(rid);
          break;
        }
        case "s.insert":
          result = stateDb.insert(p as Parameters<UIXStateDB["insert"]>[0]);
          onStateChange();
          break;
        case "s.update": {
          const { id: rid, body } = p as { id: string; body: unknown };
          stateDb.update(rid, body);
          onStateChange();
          result = null;
          break;
        }
        case "s.delete": {
          const { id: rid } = p as { id: string };
          stateDb.delete(rid);
          onStateChange();
          result = null;
          break;
        }
        case "s.raw": {
          const { sql, params } = p as { sql: string; params?: unknown[] };
          result = stateDb.raw(
            sql,
            (params ?? []) as (string | number | null)[],
          );
          break;
        }
        case "s.purge":
          result = stateDb.purge(p as Parameters<UIXStateDB["purge"]>[0]);
          onStateChange();
          break;

        default:
          throw new Error(`Unknown bridge method: ${m}`);
      }

      post(result);
    } catch (err) {
      postErr((err as Error).message);
    }
  };
}
