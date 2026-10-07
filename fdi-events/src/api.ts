import { type SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | null = null;
export async function auth() {
  if (!client) {
    const c = await api<{ supabaseUrl: string; supabaseAnonKey: string }>(
      "/config",
    );
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: {
        storage: sessionStorage,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    });
  }
  return client;
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  authenticated = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authenticated) {
    const { data } = await (await auth()).auth.getSession();
    if (data.session)
      headers.Authorization = "Bearer " + data.session.access_token;
  }
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const d: any = await r.json();
  if (!r.ok)
    throw new Error(
      d.error +
        (d.issues
          ? " " +
            d.issues.map((i: any) => `${i.field}: ${i.message}`).join("; ")
          : ""),
    );
  return d;
}
export const admin = <T = any>(
  action: string,
  payload: Record<string, unknown> = {},
) => api<T>("/admin", { action, payload }, true);
export const date = (s: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Amman",
  }).format(new Date(s.length === 10 ? s + "T12:00:00Z" : s));
export const timestamp = (s: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Amman",
  }).format(new Date(s));
export function download(name: string, content: string, type = "text/plain") {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function invitationMessage(
  a: { name: string; fdi_id: string; invitation_token?: string },
  e: {
    name: string;
    event_date: string;
    rsvp_deadline: string;
    contact_email: string;
    contact_phone: string;
  },
) {
  return `Dear ${a.name},\n\nYou are invited to attend the ${e.name} on ${date(e.event_date)}.\n\nYour personal FDI invitation is available below:\n${location.origin}/invite/${a.invitation_token}\n\nFDI ID: ${a.fdi_id}\n\nPlease confirm your attendance by ${date(e.rsvp_deadline)}.\n\nThis invitation is personal and non-transferable.\n\nBest regards,\nFuture Doctor Initiative\nFree medical knowledge for all.\n${e.contact_email}\n${e.contact_phone}`;
}
