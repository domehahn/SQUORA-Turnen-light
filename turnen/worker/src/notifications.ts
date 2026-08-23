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
    const linkLine = input.link ? `\n\n${env.FRONTEND_URL}${input.link}` : "";
    await env.EMAIL.send({
      to: { email: input.userEmail, name: input.userName ?? input.userEmail },
      from: { email: env.EMAIL_FROM_ADDRESS, name: "Turnen" },
      subject: input.title,
      text: `${input.body}${linkLine}`,
      html: `<p>${escapeHtml(input.body)}</p>${input.link ? `<p><a href="${env.FRONTEND_URL}${input.link}">In der App ansehen</a></p>` : ""}`,
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
