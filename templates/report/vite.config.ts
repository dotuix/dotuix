import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dotuix } from "@dotuix/vite-plugin";

export default defineConfig({
  plugins: [react(), dotuix()],
});
