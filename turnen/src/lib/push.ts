import { Capacitor } from "@capacitor/core";
import { api, IS_NATIVE } from "./api";

// Push nur in der nativen App. Registriert das Geräte-Token beim Backend,
// horcht auf eingehende Meldungen und navigiert beim Antippen zum `link`.
// Im Browser sind alle Funktionen No-ops.

let started = false;
let currentToken: string | null = null;

export async function startPush(navigate: (path: string) => void): Promise<void> {
  if (!IS_NATIVE || started) return;
  started = true;

  const { PushNotifications } = await import("@capacitor/push-notifications");
  const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";

  const perm = await PushNotifications.checkPermissions();
  let status = perm.receive;
  if (status === "prompt" || status === "prompt-with-rationale") {
    status = (await PushNotifications.requestPermissions()).receive;
  }
  if (status !== "granted") return;

  await PushNotifications.addListener("registration", async ({ value }) => {
    currentToken = value;
    try {
      await api.post("/api/me/device-tokens", { token: value, platform });
    } catch {
      /* Registrierung wird beim nächsten Start erneut versucht */
    }
  });

  await PushNotifications.addListener("registrationError", () => {
    /* still - kein Push, App funktioniert normal weiter */
  });

  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const link = notification.data?.link;
    if (typeof link === "string" && link.startsWith("/")) navigate(link);
  });

  await PushNotifications.register();
}

// Beim Logout aufrufen: Token serverseitig entfernen und Listener lösen.
export async function stopPush(): Promise<void> {
  if (!IS_NATIVE) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  if (currentToken) {
    try {
      await api.del("/api/me/device-tokens", { token: currentToken });
    } catch {
      /* egal - Server sortiert tote Tokens ohnehin aus */
    }
  }
  currentToken = null;
  started = false;
  await PushNotifications.removeAllListeners();
}
