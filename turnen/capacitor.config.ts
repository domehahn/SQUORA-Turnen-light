import type { CapacitorConfig } from "@capacitor/cli";

// Native Shell (iOS/Android) um denselben React-Build. Die Web-App unter
// squora.de/turnen-light bleibt davon unberührt.
//
// Der native Client authentifiziert sich per Bearer-Token (siehe
// src/lib/api.ts + worker: X-Client "turnen-app"), nicht per Cookie -
// deshalb muss VITE_API_URL beim Mobile-Build auf die absolute API-URL
// zeigen (z.B. https://squora.de/turnen-light). Siehe MOBILE.md.
const config: CapacitorConfig = {
  appId: "de.squora.turnen",
  appName: "SQUORA Turnen",
  webDir: "dist",
  ios: {
    contentInset: "always",
  },
  android: {
    // Kein Klartext-HTTP - die API läuft ausschließlich über HTTPS.
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
