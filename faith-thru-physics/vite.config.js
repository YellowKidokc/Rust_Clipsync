import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// "preview" mode builds with relative paths and hash URLs, for hosts without
// a fallback route (like an Artifact preview). The normal build is for Cloudflare Pages.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  css: { postcss: {} }, // keep this site independent of any parent folder's PostCSS config
  base: mode === "preview" ? "./" : "/",
  build: { outDir: mode === "preview" ? "dist-preview" : "dist" },
}));
