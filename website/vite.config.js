import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [tailwindcss()],
  server: { port: 5174 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
