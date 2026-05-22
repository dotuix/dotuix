import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dotuix } from "@dotuix/vite-plugin";

export default defineConfig({
  plugins: [vue(), dotuix()],
});
