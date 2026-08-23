import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // App-Shell (HTML/CSS/JS) wird gecacht, damit die App auch ohne Netz
      // sofort öffnet. Schreibende API-Calls brauchen weiterhin eine
      // Verbindung - hier geht es nur ums schnelle/robuste Laden, nicht um
      // eine echte Offline-Warteschlange für Änderungen.
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        runtimeCaching: [
          {
            // Bereits geladene Daten (Kinder/Gruppen/etc.) bleiben so auch
            // ohne Netz kurz einsehbar - Network First mit Cache-Fallback.
            urlPattern: /^\/api\/(children|groups|clubs|move-requests|capacity-requests|notifications)/,
            method: "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
      manifest: {
        name: "SQUORA Turnen",
        short_name: "Turnen",
        description: "Verwaltung von Turngruppen, Kindern und Anwesenheit.",
        theme_color: "#1d4ed8",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/squora-favicon.png", sizes: "128x128", type: "image/png" },
          { src: "/squora-logo.png", sizes: "512x512", type: "image/png" },
          { src: "/squora-logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
