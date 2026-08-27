import * as db from "./db";
import type { Env } from "./types";
import { redactError } from "./log-redaction";

// E-Mail-Design (Farben/Schrift/Wrapper/Button/Footer) übernimmt bewusst 1:1
// den bereits etablierten Stil der Schwester-Apps im selben SQUORA-Familien-
// Kontext (heimturnier/team-invites/helper unter workspace/tournament-manager,
// jeweils worker/src/email.ts) - gleiches Emerald-Branding, gleiche
// Wrapper-/Button-/Footer-Struktur, nur App-Name/Emoji angepasst. Empfänger
// bekommen so ein konsistentes Erscheinungsbild über alle Apps hinweg, statt
// pro App ein eigenes E-Mail-Design.
const BRAND_NAME = "Turnen";
const BRAND_EMOJI = "🤸";
const BRAND_COLOR = "#059669";
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const WRAPPER = (bodyHtml: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b; font-size: 15px; line-height: 1.6;">
    <p style="margin: 0 0 20px; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; color: ${BRAND_COLOR};">
      ${BRAND_EMOJI} ${BRAND_NAME}
    </p>
    ${bodyHtml}
  </div>
`;

const FOOTER = `
  <p style="margin: 32px 0 0; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
    Diese E-Mail wurde automatisch von <strong>Turnen</strong> verschickt, der App zur Verwaltung von
    Turngruppen, Kindern und Anwesenheit. Diese Adresse wird nicht überwacht (no-reply) – bei Rückfragen
    wende dich bitte direkt an deine Vereinsleitung.
  </p>
`;

const BUTTON = (url: string, label: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
    <tr>
      <td style="border-radius: 6px; background-color: ${BRAND_COLOR};">
        <a href="${url}" style="display: inline-block; padding: 12px 24px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
          ${label}
        </a>
      </td>
    </tr>
  </table>
`;

// Fallback-Zeile unter dem Button (falls der Button beim Empfänger aus
// irgendeinem Grund nicht funktioniert/nicht klickbar dargestellt wird) -
// exakt dasselbe Muster wie in den Schwester-Apps.
const LINK_FALLBACK = (url: string) => `
  <p style="margin: 0 0 16px; font-size: 13px; color: #64748b;">
    Falls der Button bei dir nicht funktioniert, kopiere stattdessen diesen Link in deinen Browser:<br>
    <a href="${url}" style="color: ${BRAND_COLOR}; word-break: break-all;">${url}</a>
  </p>
`;

function bodyHtml(text: string, link: string | null, linkLabel: string): string {
  return `
    <p style="margin: 0 0 16px;">${escapeHtml(text).replace(/\n/g, "<br>")}</p>
    ${link ? `${BUTTON(link, linkLabel)}${LINK_FALLBACK(link)}` : ""}
    ${FOOTER}
  `;
}

async function sendViaResend(
  env: Env,
  input: { to: string; subject: string; text: string; html: string }
): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM_ADDRESS) return false;

  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Turnen <${env.EMAIL_FROM_ADDRESS}>`,
      // Nur die bereits serverseitig normalisierte Adresse übergeben. Ein
      // frei eingegebener Anzeigename darf nicht Teil eines Mail-Headers sein.
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  if (!response.ok) {
    // Resend-Fehlertexte können Empfängeradressen enthalten. Status und
    // Request-ID genügen für die Diagnose, ohne PII in Logs zu übernehmen.
    const requestId = response.headers.get("x-request-id");
    throw new Error(
      `Resend-Versand fehlgeschlagen (HTTP ${response.status}${requestId ? `, Request-ID ${requestId}` : ""})`
    );
  }
  return true;
}

// Legt eine In-App-Benachrichtigung an und verschickt sie best effort per
// E-Mail. Das Postfach in der App ist die verlässliche Quelle - schlägt der
// E-Mail-Versand fehl (z.B. weil Resend nicht erreichbar ist), wird das nur
// geloggt, niemals geworfen. Der
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
    // Strukturierte Referenz aufs betroffene Kind, falls zutreffend - siehe
    // db.redactChildTraces(), das bei einer harten Kind-Löschung darüber
    // verbliebene Freitext-Spuren findet und anonymisiert.
    childId?: string | null;
  }
): Promise<void> {
  await db.createNotification(env.DB, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link,
    childId: input.childId,
  });

  try {
    const emailText = input.emailBody ?? input.body;
    const linkUrl = input.link ? `${env.FRONTEND_URL}${input.link}` : null;
    await sendViaResend(env, {
      to: input.userEmail,
      subject: input.title,
      text: `${emailText}${linkUrl ? `\n\n${linkUrl}` : ""}`,
      html: WRAPPER(bodyHtml(emailText, linkUrl, "In der App ansehen")),
    });
  } catch (err) {
    console.error("E-Mail-Versand fehlgeschlagen:", redactError(err));
  }
}

// Reiner E-Mail-Versand OHNE In-App-Notification (Finding SEC-07) - für den
// Passwort-Reset-Link und das Einmal-Passwort beim Anlegen eines Accounts.
// notifyUser() legt immer zusätzlich eine In-App-Benachrichtigung in D1 an;
// für diese sensiblen, kurzlebigen Werte wäre das ein unnötiges, dauerhaftes
// Klartext-Artefakt in der Datenbank. Best effort wie notifyUser() - schlägt
// der Versand fehl, wird das nur geloggt, nie geworfen.
export async function sendEmailOnly(
  env: Env,
  input: {
    to: string;
    subject: string;
    text: string;
    // Optionaler Call-to-Action-Link (z.B. Passwort-Reset-URL, Login-Seite) -
    // wird in der HTML-Fassung als Button plus Klartext-Fallback dargestellt,
    // in der Text-Fassung an den Fließtext angehängt.
    link?: string;
    linkLabel?: string;
  }
): Promise<boolean> {
  try {
    return await sendViaResend(env, {
      to: input.to,
      subject: input.subject,
      text: `${input.text}${input.link ? `\n\n${input.link}` : ""}`,
      html: WRAPPER(bodyHtml(input.text, input.link ?? null, input.linkLabel ?? "Jetzt öffnen")),
    });
  } catch (err) {
    console.error("E-Mail-Versand fehlgeschlagen:", redactError(err));
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
