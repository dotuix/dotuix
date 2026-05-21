# dotuix — Product Plan

**Created:** 2026-05-21
**Status:** Living document — updated as phases complete

---

## Problem Statements

1. **No raw/data distinction** — A used `.uix` file carries user data inside it. Copying it leaks that data. Apps need a way to stay permanently clean so they can be freely distributed.
2. **No app versioning** — There is no standard way for a new version of an app to know what schema the stored data was written with, or how to upgrade it.
3. **No data portability** — Users have no tooling to explicitly move data from an old version of an app to a new one without destroying either file.
4. **No distribution control** — Anyone who receives a `.uix` file can copy it freely. There is no licensing mechanism to bind a file to a customer, a device, or a time window.
5. **No canonical use-case demo** — The project lacks a comprehensive real-world demo app that exercises all of the above.

---

## Core Concept: App Mode vs Document Mode

The foundational distinction that everything below builds on.

| Dimension        | **Document** (`state.mode: "file"`) | **App** (`state.mode: "device"`)        |
| ---------------- | ----------------------------------- | --------------------------------------- |
| State lives in   | The `.uix` file itself              | Viewer's app directory on device        |
| On close         | state.db written back into archive  | No write-back; archive stays clean      |
| Sharing the file | Shares app + accumulated data       | Shares only the template; no data       |
| Use case         | Filled forms, reports, notebooks    | POS, CRM, inventory, any multi-user app |
| Viewer badge     | **Document**                        | **App**                                 |

---

## Roadmap

### Phase 1 — `state.mode` (Raw File vs Data-Bearing File) ✅ Done — `1c8db43`

**Spec changes:** `§2.3` new `state.mode` field · `§3.3` amended roles · `§3.4` conditional repack
**Viewer changes:** Read `state.mode` from manifest; skip `repack_uix()` when mode is `"device"`

| Manifest field | Type                 | Default  | Description                                                                                                                                                                                                                 |
| -------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.mode`   | `"file" \| "device"` | `"file"` | `"file"` — state is written back into the archive on close (existing behaviour). `"device"` — state is stored by the viewer in its app directory, keyed by `manifest.id`. The archive is never modified after distribution. |
| `state.seed`   | boolean              | false    | Existing field — unchanged semantics                                                                                                                                                                                        |

**What changes in the viewer:**

- Load `state.mode` from manifest and store in `AppState`
- Skip `repack_uix()` on close, on file-switch, and on window destroy when `state_mode == "device"`
- No change to state.db path or schema

**Deliverable:** A `.uix` app with `state.mode: "device"` stays byte-for-byte identical no matter how many times it is opened, used, and closed. The `.uix` file is safe to copy and distribute without leaking user data.

---

### Phase 2 — `schemaVersion` + `uix.schema.onUpgrade()` ✅ Done — `a4015c2`

**Goal:** Give app authors a standard way to evolve their data schema across releases without breaking existing user state.

**Spec changes:** `§2.2` new `schemaVersion` integer field · `§4.x` new bridge method `uix.schema.onUpgrade()`
**Viewer changes:** Compare stored `meta.schema_version` with `manifest.schemaVersion`; call upgrade handler before first render if they differ; update `meta.schema_version` after handler completes

**New manifest fields:**

| Field           | Type    | Default | Description                                                                                                 |
| --------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | integer | 1       | Monotonically increasing integer. Increment whenever the structure of records stored in `state.db` changes. |

**New bridge method:**

```js
uix.schema.onUpgrade(async ({ from, to, state }) => {
  // 'from' — schemaVersion stored in state meta (what the user's data was written with)
  // 'to'   — schemaVersion declared in manifest (what this code expects)
  // 'state' — the uix.state bridge, fully operational
  // Run all needed transforms before first render.
});
```

Viewer flow:

1. Open state.db, read `meta.schema_version` (default: 1 if absent)
2. Compare with `manifest.schemaVersion`
3. If lower: call `onUpgrade({ from, to, state })` before injecting the app HTML
4. If no handler registered and versions differ: emit a console warning, open anyway
5. After successful upgrade: `UPDATE meta SET value = ? WHERE key = 'schema_version'`

---

### Phase 3 — `.uixdata` Bundle Format + CLI Export/Import ✅ Done (`7d39ec5`)

**Goal:** Give users explicit, safe tools to move data from one version of an app to another. The original file is never touched.

**New file format: `.uixdata`** (plain JSON, optionally gzip-compressed)

```json
{
  "format": "uixdata/1.0",
  "appId": "com.example.pos",
  "schemaVersion": 2,
  "exportedAt": "2026-05-21T09:00:00Z",
  "exportedBy": "dotuix-cli/0.1.3",
  "checksum": "sha256:abc123...",
  "types": ["product", "category", "stock"],
  "records": [
    {
      "id": "product:001",
      "type": "product",
      "body": "{...}",
      "created_at": 0,
      "updated_at": 0
    }
  ]
}
```

**New CLI commands (`@dotuix/cli`):**

```bash
dotuix export mypos.uix --output backup.uixdata            # all state
dotuix export mypos.uix --types product,category,stock     # selective
dotuix import newpos.uix --data backup.uixdata             # replace
dotuix import newpos.uix --data backup.uixdata --merge     # merge (skip conflicts)
dotuix inspect-data backup.uixdata                         # dry-run summary
```

**New bridge methods (`uix.state`):**

```js
uix.state.exportBundle({ types?: string[] }) → Promise<string>      // JSON string
uix.state.importBundle(json: string, { merge?: boolean }) → Promise<{ imported: number, skipped: number }>
```

In-app UX: "Transfer my data → Export bundle" → save `.uixdata` → open new version → "Import bundle". No CLI needed for end users.

---

### Phase 4 — In-App `exportBundle` / `importBundle` Bridge Methods ✅ Done (`712f4c0`)

Expose Phase 3 bundle I/O through the runtime bridge so apps can build their own transfer UI without requiring the CLI.

**Viewer changes:** Two new `uix.state` bridge methods backed by Rust commands `state_export_bundle` and `state_import_bundle`.

---

### Phase 5 — POS Demo App ✅ Done

**Goal:** A fully functional point-of-sale application as the canonical complex use-case, exercising all platform features.

**App identity:**

```json
{
  "id": "com.dotuix.demos.pos",
  "name": "dotuix POS",
  "version": "1.0.0",
  "schemaVersion": 1,
  "mode": "kiosk",
  "state": { "mode": "device", "seed": true },
  "permissions": [
    "print",
    "file-save",
    "notifications",
    "fullscreen",
    "raw-sql"
  ]
}
```

**Modules:**

| Module        | Features                                                     |
| ------------- | ------------------------------------------------------------ |
| Catalog       | Products, categories, variants, pricing, barcode/SKU         |
| Inventory     | Stock levels, low-stock alerts, reorder points, location     |
| Checkout      | Cart, line discounts, tax, Cash / Card / Split payment       |
| Receipts      | Print or save digital receipt; transaction history           |
| Reports       | Daily/weekly/monthly revenue, top products, CSV export       |
| Customers     | Name, phone, loyalty points                                  |
| Staff         | Multiple staff members with individual PINs, per-staff sales |
| Settings      | Store name, currency, tax rate, receipt footer               |
| Data Transfer | In-app export/import bundle UI (Phase 3/4)                   |

**State.db record types:**

| Type        | Key body fields                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `product`   | `name`, `sku`, `barcode`, `price`, `cost`, `taxRate`, `categoryId`                                                 |
| `category`  | `name`, `color`                                                                                                    |
| `stock`     | `productId`, `qty`, `reorderAt`, `location`                                                                        |
| `sale`      | `staffId`, `total`, `tax`, `discount`, `paymentMethod`, `status`, `closedAt`                                       |
| `sale_item` | `saleId`, `productId`, `qty`, `unitPrice`, `lineTotal`                                                             |
| `customer`  | `name`, `phone`, `email`, `loyaltyPoints`                                                                          |
| `staff`     | `name`, `pin` (hashed), `role`, `active`                                                                           |
| `settings`  | Single record `id: "settings:app"`                                                                                 |
| `supplier`  | `name`, `contact`, `email`                                                                                         |
| `shift`     | `staffId`, `openedAt`, `closedAt`, `openingFloat`, `closingTotal`, `salesCount`, `status` (`"open"` \| `"closed"`) |

**Seed data:** 20 products across 5 categories, 3 staff members, store settings pre-filled.

---

### Phase 6 — License Token (Distribution Control)

**Goal:** Allow creators to control who can run their `.uix` app — without requiring any server at runtime.

**New bridge methods (`uix.license`):**

```js
await uix.license.get();
// Returns: { issuedTo, issuedAt, expiresAt, features, valid }

await uix.license.hasFeature("reports");
// Returns: boolean — true if the loaded license includes the named feature
```

This gives developers a clean API to gate features without parsing the license token themselves.

**New manifest block:**

```json
"license": {
  "required": true,
  "publisherKey": "ed25519:BASE64URL_PUBLIC_KEY",
  "appId": "com.example.pos"
}
```

**License token (`.uixlicense`)** — a signed JSON payload verified offline:

```json
{
  "appId": "com.example.pos",
  "issuedTo": "Sunrise Café",
  "issuedAt": "2026-05-21",
  "expiresAt": "2027-05-21",
  "features": ["multi-staff", "reports"],
  "maxDevices": 3,
  "deviceId": null
}
```

Signed with the publisher's Ed25519 private key. Verified against `publisherKey` in the manifest. **No server call — pure cryptography.**

**New CLI commands:**

```bash
dotuix issue-license \
  --app com.example.pos \
  --to "Sunrise Café" \
  --expires 2027-05-21 \
  --features multi-staff,reports \
  --max-devices 3 \
  --key ./publisher.priv \
  --output sunrise-cafe.uixlicense

dotuix device-id   # prints device fingerprint (for device-bound licenses)
```

**Distribution flow:**

1. Creator distributes `pos.uix` (opens to "License required" screen without a token)
2. Customer runs `dotuix device-id`, sends fingerprint to creator
3. Creator issues `sunrise-cafe.uixlicense` (device-bound, expiring)
4. Customer drops the `.uixlicense` into the viewer → app opens

**Tiers of protection:**

| Layer                    | Mechanism                                          | Leak resistance                    |
| ------------------------ | -------------------------------------------------- | ---------------------------------- |
| PIN                      | Shared password (spec §6)                          | Low (shareable with password)      |
| License token            | Ed25519-signed JWT, expiring                       | Medium (token bound to app + time) |
| Device-bound token       | Token contains device fingerprint                  | High (won't run on other machines) |
| Encrypted + device-bound | Content encrypted, key derived from token + device | Maximum                            |

---

### Phase 7 — `dotuix issue-license` + `dotuix device-id` CLI

Implement the CLI commands from Phase 6 in `@dotuix/cli`.

---

## Progress Tracker

| Phase                                      | Status         | Commit    |
| ------------------------------------------ | -------------- | --------- |
| 1 — `state.mode`                           | ✅ Done        | `1c8db43` |
| 2 — `schemaVersion` + upgrade handler      | ✅ Done        | `a4015c2` |
| 3 — `.uixdata` bundle + CLI export/import  | ✅ Done        | `7d39ec5` |
| 4 — In-app `exportBundle` / `importBundle` | ✅ Done        | `712f4c0` |
| 5 — POS demo app                           | ✅ Done        | —         |
| 6 — License token spec                     | ⬜ Not started | —         |
| 7 — License CLI commands                   | ⬜ Not started | —         |
