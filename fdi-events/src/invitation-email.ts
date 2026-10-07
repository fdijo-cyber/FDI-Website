import template from "./invitation-email.html?raw";
import { date } from "./api";
import type { Attendee, Event } from "./types";

type Recipient = Pick<
  Attendee,
  "name" | "role" | "fdi_id" | "email" | "invitation_token"
>;
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function invitationEmail(
  a: Recipient,
  e: Event,
  origin = location.origin,
) {
  if (!a.invitation_token)
    throw new Error("This attendee does not have an invitation link.");
  const link = `${origin}/invite/${encodeURIComponent(a.invitation_token)}`;
  const values: Record<string, string> = {
    NAME: a.name,
    ROLE: a.role,
    FDI_ID: a.fdi_id,
    EVENT: e.name,
    DATE: date(e.event_date),
    DEADLINE: date(e.rsvp_deadline),
    VENUE: e.venue || "Venue to be announced",
    ADDRESS: e.address || "See your invitation for location updates.",
    DESCRIPTION:
      e.description ||
      "Join us to learn, connect, and build essential medical knowledge.",
    INVITE_URL: link,
    PARTNER: e.partner
      ? `In partnership with ${e.partner}`
      : "Organized by Future Doctor Initiative",
    CONTACT_EMAIL: e.contact_email,
    CONTACT_PHONE: e.contact_phone,
  };
  const text = `Dear ${a.name},\n\nYou’re invited to ${e.name}.\n\nRole: ${a.role}\nFDI ID: ${a.fdi_id}\nDate: ${values.DATE}\nVenue: ${values.VENUE}\n${e.address ? `Address: ${e.address}\n` : ""}\n${values.DESCRIPTION}\n\nYour personal invitation:\n${link}\n\nTo access it, enter your full name and FDI ID above. Please respond by ${values.DEADLINE}.\n\nThis invitation is personal and non-transferable.\n\nThe Future Doctor Initiative Team\n${values.PARTNER}\nFree medical knowledge for all.\n${e.contact_email}\n${e.contact_phone}`;
  return {
    subject: `Your invitation · ${e.name}`,
    text,
    html: template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) =>
      escapeHtml(values[key] || ""),
    ),
  };
}

export function gmailInvitationUrl(
  a: Recipient,
  e: Event,
  origin = location.origin,
  useApp = isAppleMobile(),
) {
  const message = invitationEmail(a, e, origin);
  if (useApp) {
    const query = Object.entries({
      to: a.email,
      subject: message.subject,
      body: message.text,
    })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    return `googlegmail:///co?${query}`;
  }
  const query = new URLSearchParams({
    view: "cm",
    fs: "1",
    tf: "cm",
    to: a.email,
    su: message.subject,
    body: message.text,
  });
  return `https://mail.google.com/mail/?${query}`;
}

function isAppleMobile() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function openGmailInvitation(a: Recipient, e: Event) {
  const url = gmailInvitationUrl(a, e);
  if (url.startsWith("googlegmail:")) location.assign(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyFormattedInvitation(a: Recipient, e: Event) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error(
      "Formatted copying is unavailable in this browser. Open Gmail invitation to use the prefilled text email.",
    );
  const message = invitationEmail(a, e);
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([message.html], { type: "text/html" }),
      "text/plain": new Blob([message.text], { type: "text/plain" }),
    }),
  ]);
}
