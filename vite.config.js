import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const page = (file) => fileURLToPath(new URL(file, import.meta.url));

// Tauri expects a fixed dev port and doesn't want Vite to clear its logs.
export default defineConfig({
  plugins: [tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    rollupOptions: {
      // The ghost window and the settings window.
      input: { main: page("./index.html"), settings: page("./settings.html") },
    },
  },
});
