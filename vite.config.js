import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev port and doesn't want Vite to clear its logs.
export default defineConfig({
  plugins: [tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
