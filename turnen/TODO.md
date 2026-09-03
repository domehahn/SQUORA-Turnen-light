# TODO – native App (iOS / Android)

Stand: 2026-09-03 · `main` @ `47294ce6` (PR #18 gemergt)

Siehe auch [`MOBILE.md`](./MOBILE.md) für Setup/Build.

---

## ✅ Fertig & in `main`

| Bereich | Status |
|---|---|
| Bearer-Token-Auth für die App (additiv, Web unverändert) | ✅ deployed |
| FCM-Push-Backend (`worker/src/push.ts`, no-op ohne Secret) | ✅ deployed |
| Capacitor-Scaffolding, `ios/` + `android/` im Repo | ✅ |
| App-Icons + Splashscreens (iOS **und** Android, hell + dunkel) | ✅ generiert & committet |
| iOS-Push-Verkabelung (Info.plist, Entitlements, pbxproj, AppDelegate) | ✅ |
| Mobile-Layout-Fix, native Idle-Lock aus, Safe-Area | ✅ deployed |
| Login-CORS/CSRF für `capacitor://localhost` | ✅ deployed |

App startet in Simulator/Emulator, Login funktioniert, auf iOS + Android getestet.

---

## 📋 Offen – nur du (brauchen deine Accounts)

### 1. Apple Developer (99 €/Jahr) – blockt iOS-Geräte-/Store-Builds

- [ ] Apple-Developer-Account anlegen/bezahlen.
- [ ] Xcode: `App`-Target → *Signing & Capabilities* → **Team** wählen, Bundle-ID `de.squora.turnen` registrieren.
- ⚠️ `aps-environment` (Push-Entitlement) ist eingetragen → jeder Geräte-/Archive-Build braucht jetzt ein bezahltes Team. Simulator läuft weiter ohne. Bei Bedarf kann das Entitlement wieder optional gemacht werden.

### 2. Firebase + APNs – aktiviert Push

- [ ] Firebase-Projekt anlegen, darin **iOS-App** und **Android-App** mit `de.squora.turnen` registrieren.
- [ ] Firebase → Projekteinstellungen → **Cloud Messaging** → APNs-**Auth-Key** (`.p8`) + Key-ID + Team-ID hochladen.
- [ ] `GoogleService-Info.plist` herunterladen → nach `turnen/ios/App/App/` legen.
- [ ] `google-services.json` herunterladen → nach `turnen/android/app/` legen.
- [ ] Firebase → Dienstkonten → *Neuen privaten Schlüssel generieren* → JSON.
- [ ] Als Worker-Secret setzen:
  ```bash
  cd turnen/worker && npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
  ```
  Ohne dieses Secret bleibt Push ein stiller No-op – nichts bricht.

### 3. Android google-services-Plugin (2 Gradle-Zeilen)

Sobald `google-services.json` da ist (Capacitor-Doku „Push Notifications"):

- [ ] `android/build.gradle`: `classpath 'com.google.gms:google-services:4.4.2'`
- [ ] `android/app/build.gradle` unten: `apply plugin: 'com.google.gms.google-services'`

→ Kann als PR vorbereitet werden, sobald die JSON im Repo ist.

### 4. Store-Einreichung

- [ ] **App Store Connect**: App anlegen, Screenshots, Datenschutz-Angaben, `npm run mobile:ios` → Xcode *Archive* → *Distribute*.
- [ ] **Play Console** (einmalig 25 $): App anlegen, `npm run mobile:android` → Android Studio *Generate Signed Bundle (AAB)* → Upload. Upload-Keystore sicher aufbewahren.

### 5. Vor dem Release prüfen

- [ ] In `capacitor.config.ts` steht **kein** `server.url` (Live-Reload).
- [ ] `aps-environment` in `App.entitlements`: für den Store `production` (Xcode setzt das beim Archivieren i. d. R. automatisch übers Provisioning-Profil).

---

## 🔧 Optional / später (kann ich übernehmen)

- [ ] QR-Scanner fürs Anwesenheits-Check-in (`@capacitor-mlkit/barcode-scanning`).
- [ ] OTA-Updates der Web-Assets (z. B. Capgo), damit JS/CSS ohne Store-Review ausrollt.
- [ ] Refresh-Token-Flow statt langer Session (aktuell: Re-Login nach 30 Tagen Inaktivität).
