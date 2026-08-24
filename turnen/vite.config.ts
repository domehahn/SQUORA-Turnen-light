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
        workbox: {
          // App-Shell (CSS/JS/Icons) wird gecacht, damit die App auch ohne
          // Netz sofort öffnet. Schreibende API-Calls brauchen weiterhin
          // eine Verbindung - hier geht es nur ums schnelle/robuste Laden,
          // nicht um eine echte Offline-Warteschlange für Änderungen.
          //
          // "html" bewusst NICHT in globPatterns: sonst precacht Workbox
          // index.html und beantwortet jede Navigation danach dauerhaft aus
          // dem lokalen Cache (CacheFirst), ohne je wieder das Netz zu
          // fragen - eine zufällig einmal fehlerhaft gecachte Antwort (z. B.
          // während eines Deploys/Routing-Wechsels) bliebe dann bis zu 24h
          // oder länger hängen, weil auch die Update-Prüfung des Browsers
          // für den Service Worker selbst nicht zuverlässig zeitnah greift.
          // Die Navigationsanfrage geht dadurch immer live ans Netz;
          // JS/CSS/Icons bleiben trotzdem für echtes Offline-Öffnen der
          // App-Shell gecacht.
          globPatterns: ["**/*.{js,css,png,svg,ico}"],
          // vite-plugin-pwa registriert sonst automatisch eine
          // NavigationRoute auf ein precachtes index.html (CacheFirst),
          // unabhängig von globPatterns - navigateFallback: null schaltet
          // das komplett ab, Navigationen gehen dadurch immer ans Netz.
          navigateFallback: null,
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
