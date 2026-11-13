import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const backendTarget = `http://127.0.0.1:${process.env.ASTER_BACKEND_PORT || 4181}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@core": fileURLToPath(new URL("../core", import.meta.url)),
    },
  },
  server: {
    port: 4180,
    strictPort: true,
    proxy: {
      "/api": { target: backendTarget, changeOrigin: false },
      "/healthz": { target: backendTarget, changeOrigin: false },
    },
  },
  build: { outDir: "../../dist/web/client", emptyOutDir: true },
});
