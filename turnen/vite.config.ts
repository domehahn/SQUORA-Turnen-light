import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // Produktions-Build läuft unter squora.de/turnen-light/ statt am
    // Domain-Root (siehe .env.production) - lokale Entwicklung bleibt bei
    // "/", weil .env.production im dev-Mode nicht geladen wird.
    base: env.VITE_APP_BASE_PATH || "/",
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
              // Ohne führendes "^/": funktioniert unabhängig davon, ob die
              // App am Domain-Root oder unter /turnen-light/ läuft.
              urlPattern: /\/api\/(children|groups|clubs|move-requests|capacity-requests|notifications)/,
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
          // Relativ statt "/": funktioniert am Domain-Root genauso wie unter
          // /turnen-light/, ohne den Pfad hier hart einzutragen.
          start_url: ".",
          icons: [
            { src: "squora-favicon.png", sizes: "128x128", type: "image/png" },
            { src: "squora-logo.png", sizes: "512x512", type: "image/png" },
            { src: "squora-logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
  };
});
