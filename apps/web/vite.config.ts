import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Root .env holds VITE_* (only VITE_-prefixed keys reach the bundle).
  envDir: "../..",
  server: {
    proxy: {
      // wrangler dev serves the API on 8787
      "/api": "http://localhost:8787",
    },
  },
});
