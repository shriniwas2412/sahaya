import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: { target: "es2020" },
});
