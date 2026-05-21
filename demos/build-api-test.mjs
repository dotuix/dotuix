#!/usr/bin/env node
/**
 * Builds demos/api-test.uix
 *
 * Usage:  node demos/build-api-test.mjs
 *
 * Creates a data.db seeded with 10 test products, then packs
 * demos/api-test/ → demos/api-test.uix using the dotuix CLI.
 */
import { writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(__dirname, "api-test");
const outFile = join(__dirname, "api-test.uix");
const cli = join(root, "packages", "cli", "dist", "index.js");

// ── Import createDataDb from @dotuix/core ─────────────────────────────────
const { createDataDb } = await import(
  join(root, "packages", "core", "dist", "index.js")
);

// ── Seed data ─────────────────────────────────────────────────────────────
const records = [
  {
    id: "product:001",
    type: "product",
    body: { name: "Mixed Grill", price: 85, category: "grills", sort: 1 },
  },
  {
    id: "product:002",
    type: "product",
    body: { name: "Chicken Tikka", price: 65, category: "grills", sort: 2 },
  },
  {
    id: "product:003",
    type: "product",
    body: { name: "Lamb Chops", price: 95, category: "grills", sort: 3 },
  },
  {
    id: "product:004",
    type: "product",
    body: { name: "Hummus", price: 18, category: "appetizers", sort: 4 },
  },
  {
    id: "product:005",
    type: "product",
    body: { name: "Fattoush Salad", price: 22, category: "salads", sort: 5 },
  },
  {
    id: "product:006",
    type: "product",
    body: { name: "Basmati Rice", price: 12, category: "sides", sort: 6 },
  },
  {
    id: "product:007",
    type: "product",
    body: { name: "Arabic Bread", price: 5, category: "sides", sort: 7 },
  },
  {
    id: "product:008",
    type: "product",
    body: { name: "Lemon Mint", price: 15, category: "drinks", sort: 8 },
  },
  {
    id: "product:009",
    type: "product",
    body: { name: "Fresh Juice", price: 20, category: "drinks", sort: 9 },
  },
  {
    id: "product:010",
    type: "product",
    body: { name: "Umm Ali", price: 30, category: "desserts", sort: 10 },
  },
  {
    id: "category:grills",
    type: "category",
    body: { name: "Grills", sort: 1 },
  },
  {
    id: "category:appetizers",
    type: "category",
    body: { name: "Appetizers", sort: 2 },
  },
  {
    id: "category:salads",
    type: "category",
    body: { name: "Salads", sort: 3 },
  },
  { id: "category:sides", type: "category", body: { name: "Sides", sort: 4 } },
  {
    id: "category:drinks",
    type: "category",
    body: { name: "Drinks", sort: 5 },
  },
  {
    id: "category:desserts",
    type: "category",
    body: { name: "Desserts", sort: 6 },
  },
];

console.log("Creating data.db with", records.length, "records…");
const dbBytes = await createDataDb(records);
await writeFile(join(srcDir, "data.db"), dbBytes);
console.log("  → demos/api-test/data.db written");

// ── Pack ──────────────────────────────────────────────────────────────────
console.log("Packing demos/api-test/ → demos/api-test.uix…");
execSync(`node "${cli}" pack "${srcDir}" -o "${outFile}"`, {
  stdio: "inherit",
});
console.log("Done →", outFile);
