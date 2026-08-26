import * as db from "./db";
import type { Env } from "./types";

// Legt eine In-App-Benachrichtigung an und verschickt sie best effort per
// E-Mail. Das Postfach in der App ist die verlässliche Quelle - schlägt der
// E-Mail-Versand fehl (z.B. weil die Absender-Domain noch nicht bei Email
// Sending onboarded ist), wird das nur geloggt, niemals geworfen. Der
// aufrufende Request-Handler darf davon nie blockiert oder abgebrochen
// werden.
export async function notifyUser(
  env: Env,
  input: {
    userId: string;
    userEmail: string;
    userName: string | null;
    type: string;
    title: string;
    body: string;
    // Optionaler, abweichender Text nur für die E-Mail (z.B. ohne
    // Gesundheitsdaten/Notfallkontakte) - siehe childContactSummary() in
    // index.ts. Ohne Angabe wird `body` auch für die E-Mail verwendet.
    // Grund: Gesundheitsdaten (Art. 9 DSGVO) sollen die App nicht per
    // Klartext-E-Mail an externe Postfächer verlassen - im In-App-
    // Postfach (`body`) bleiben sie, da der/die Empfänger*in dort ohnehin
    // zum Einsehen berechtigt ist (siehe PRIVACY_SECURITY_GAP_ANALYSIS.md,
    // Finding PRIV-01).
    emailBody?: string;
    link: string | null;
  }
): Promise<void> {
  await db.createNotification(env.DB, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link,
  });

  if (!env.EMAIL || !env.EMAIL_FROM_ADDRESS) return;

  try {
    const emailText = input.emailBody ?? input.body;
    const linkLine = input.link ? `\n\n${env.FRONTEND_URL}${input.link}` : "";
    await env.EMAIL.send({
      to: { email: input.userEmail, name: input.userName ?? input.userEmail },
      from: { email: env.EMAIL_FROM_ADDRESS, name: "Turnen" },
      subject: input.title,
      text: `${emailText}${linkLine}`,
      html: `<p>${escapeHtml(emailText).replace(/\n/g, "<br>")}</p>${input.link ? `<p><a href="${env.FRONTEND_URL}${input.link}">In der App ansehen</a></p>` : ""}`,
    });
  } catch (err) {
    console.error("E-Mail-Versand fehlgeschlagen:", err);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
