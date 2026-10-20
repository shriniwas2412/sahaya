import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// VITE_BASE is set by the GitHub Pages workflow to "/<repo>/"; "/" everywhere else.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [preact()],
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
  build: { target: "es2020" },
});
