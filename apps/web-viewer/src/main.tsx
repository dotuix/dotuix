import { createRoot } from "react-dom/client";
import { configureSqlJs } from "@dotuix/core";
import App from "./App.js";
import "./app.css";

// Tell sql.js where to find its WASM file (served from /public/sql-wasm.wasm)
configureSqlJs({ locateFile: () => "/sql-wasm.wasm" });

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

// StrictMode is intentionally omitted: the viewer holds blob URLs and DB
// connections that cannot survive React's dev-mode double-mount/unmount cycle.
createRoot(root).render(<App />);
