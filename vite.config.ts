import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // Tauri expects a fixed port and surfaces Rust errors rather than swallowing them.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Vite 8 minifies with oxc; the esbuild path needs a separate install.
    minify: !process.env.TAURI_ENV_DEBUG,
    // The bundle ships inside the app and loads from disk, so chunk size is not a
    // download cost. Splitting it would only add requests.
    chunkSizeWarningLimit: 2000,
  },
});
