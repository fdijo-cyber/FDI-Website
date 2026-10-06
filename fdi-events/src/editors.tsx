import { useEffect, useState } from "react";
import Papa from "papaparse";
import { Copy, Mail, Send, Link, Save, Plus, ShieldCheck } from "lucide-react";
import { admin, api, invitationMessage, download, timestamp } from "./api";
import { personSchema } from "../server/validation";
import { Field, Status, Notice, QR as SecurityQR } from "./components";
import type { Attendee, Event, Staff } from "./types";
import { defaultLayout } from "./certificate-layout";
const blankPerson = {
  full_name: "",
  role_code: "P",
  email: "",
  phone: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  allow_duplicate: false,
  person_id: undefined as string | undefined,
};
export function PersonEditor({
  attendee,
  event,
  events,
  roles,
  canOverride,
  onSaved,
  onClose,
}: {
  attendee?: Attendee;
  event: Event;
  events: Event[];
  roles: { code: string; label: string }[];
  canOverride: boolean;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [p, setP] = useState({
      ...blankPerson,
      ...(attendee ? { ...attendee, full_name: attendee.name } : {}),
    }),
    [a, setA] = useState<Attendee | undefined>(attendee),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<any[]>([]),
    [move, setMove] = useState("");
  useEffect(() => {
    if (attendee)
      admin<Attendee>("attendee_detail", {
        event_id: event.id,
        registration_id: attendee.id,
      })
        .then(setA)
        .catch((e) => setError(e.message));
  }, [attendee, event.id]);
  const change = (name: string, value: string) =>
    setP((s) => ({ ...s, [name]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await admin<Attendee>(
        a ? "attendee_edit" : "attendee_create",
        { event_id: event.id, ...(a ? { registration_id: a.id } : {}), ...p },
      );
      setA(data);
      setMessage(
        a
          ? "Attendee updated."
          : "Attendee created. Copy the personal invitation below.",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(act: string, payload: Record<string, unknown> = {}) {
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const data = await admin(act, {
        event_id: event.id,
        registration_id: a.id,
        ...payload,
      });
      if (act === "remove" || act === "attendee_move") {
        await onSaved();
        onClose();
        return;
      }
      setA(
        await admin("attendee_detail", {
          event_id: event.id,
          registration_id: a.id,
        }),
      );
      setMessage(
        act === "issue_certificate"
          ? "Certificate record issued. The official PDF is available after a template is configured."
          : act === "manual_checkin"
            ? data.status.replaceAll("_", " ")
            : "Action recorded.",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deliver(channel: string, kind: string) {
    if (!a?.invitation_token) return;
    setError("");
    const msg = invitationMessage(a, event),
      url = location.origin + "/invite/" + a.invitation_token;
    try {
      if (kind === "link") await navigator.clipboard.writeText(url);
      if (kind === "message") await navigator.clipboard.writeText(msg);
      if (kind === "email")
        location.href =
          "mailto:" +
          encodeURIComponent(a.email) +
          "?subject=" +
          encodeURIComponent("Your invitation · " + event.name) +
          "&body=" +
          encodeURIComponent(msg);
      if (kind === "whatsapp")
        window.open(
          "https://wa.me/" +
            a.phone.replace(/\D/g, "") +
            "?text=" +
            encodeURIComponent(msg),
          "_blank",
          "noopener,noreferrer",
        );
      await admin("delivery", {
        event_id: event.id,
        registration_id: a.id,
        channel,
        state: "PREPARED",
      });
      setMessage(
        kind === "link"
          ? "Invitation link copied."
          : kind === "message"
            ? "Invitation message copied."
            : "Message prepared. Mark it sent after sending.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {a && (
        <div className="attendee-heading">
          <div>
            <strong>{a.name}</strong>
            <small>
              {a.fdi_id} · {a.person_fdi_id}
            </small>
          </div>
          <Status value={a.rsvp} />
          <Status value={a.invitation_status} />
        </div>
      )}
      {!a && (
        <section className="reuse-person">
          <h3>Existing FDI person?</h3>
          <div className="actions">
            <input
              aria-label="Find existing person"
              placeholder="Search name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className="secondary"
              type="button"
              onClick={async () => {
                try {
                  setMatches(
                    await admin("people_search", {
                      event_id: event.id,
                      query: search,
                    }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Search
            </button>
          </div>
          {matches.map((m) => (
            <button
              key={m.id}
              className="match"
              onClick={() => {
                setP({
                  ...p,
                  full_name: m.full_name,
                  email: m.email,
                  phone: m.phone,
                  emergency_contact_name: m.emergency_contact_name,
                  emergency_contact_phone: m.emergency_contact_phone,
                  person_id: m.id,
                });
                setMatches([]);
              }}
            >
              {m.full_name} · FDI-PERSON-{m.serial}
            </button>
          ))}
          {p.person_id && (
            <Notice>
              Using an existing person. Choose the role for this event.
            </Notice>
          )}
        </section>
      )}
      <form onSubmit={save}>
        <div className="form-grid">
          <Field
            label="Full name"
            name="full_name"
            value={p.full_name}
            onChange={change}
            required
          />
          <label className="field">
            Event role
            <select
              value={p.role_code}
              onChange={(e) => change("role_code", e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Email · admin only"
            name="email"
            type="email"
            value={p.email}
            onChange={change}
          />
          <Field
            label="Phone · admin only"
            name="phone"
            value={p.phone}
            onChange={change}
          />
          <Field
            label="Emergency contact · admin only"
            name="emergency_contact_name"
            value={p.emergency_contact_name}
            onChange={change}
          />
          <Field
            label="Emergency phone · admin only"
            name="emergency_contact_phone"
            value={p.emergency_contact_phone}
            onChange={change}
          />
        </div>
        {!a && !p.person_id && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={p.allow_duplicate}
              onChange={(e) =>
                setP({ ...p, allow_duplicate: e.target.checked })
              }
            />
            Create a separate person even if similar details exist
          </label>
        )}
        <button disabled={busy}>
          <Save size={16} />
          {a ? "Save changes" : "Create invitation"}
        </button>
      </form>
      {a && (
        <>
          <section className="editor-section">
            <h3>Personal invitation</h3>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => deliver("LINK", "link")}
                disabled={!a.invitation_token}
              >
                <Link size={16} />
                Copy link
              </button>
              <button
                className="secondary"
                onClick={() => deliver("LINK", "message")}
                disabled={!a.invitation_token}
              >
                <Copy size={16} />
                Copy message
              </button>
              <button
                className="secondary"
                onClick={() => deliver("EMAIL", "email")}
                disabled={!a.invitation_token || !a.email}
              >
                <Mail size={16} />
                Email invitation
              </button>
              <button
                className="secondary"
                onClick={() => deliver("WHATSAPP", "whatsapp")}
                disabled={!a.invitation_token || !a.phone}
              >
                <Send size={16} />
                Open WhatsApp
              </button>
              {a.invitation_token && (
                <a
                  className="button secondary"
                  target="_blank"
                  rel="noreferrer"
                  href={"/invite/" + a.invitation_token}
                >
                  View invitation
                </a>
              )}
            </div>
            <div className="actions">
              <span className="muted">Sending is manual.</span>
              <button
                className="text-button"
                onClick={() =>
                  action("delivery", { channel: "EMAIL", state: "SENT" })
                }
              >
                Mark email sent
              </button>
              <button
                className="text-button"
                onClick={() =>
                  action("delivery", { channel: "WHATSAPP", state: "SENT" })
                }
              >
                Mark WhatsApp sent
              </button>
            </div>
          </section>
          <section className="editor-section">
            <h3>RSVP & attendance</h3>
            <div className="actions">
              <label className="field">
                Admin RSVP override
                <select
                  value={a.rsvp}
                  disabled={busy}
                  onChange={(e) =>
                    action("rsvp_override", { response: e.target.value })
                  }
                >
                  {["PENDING", "ACCEPTED", "DECLINED"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              {a.checked_in_at ? (
                <>
                  <p>Checked in · {timestamp(a.checked_in_at)}</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt(
                        "Reason for undoing check-in (issued certificates will be revoked):",
                      );
                      if (reason) action("undo_checkin", { reason });
                    }}
                  >
                    Undo check-in
                  </button>
                </>
              ) : (
                <button
                  disabled={
                    busy ||
                    a.rsvp !== "ACCEPTED" ||
                    a.invitation_status !== "ACTIVE"
                  }
                  onClick={() => {
                    if (confirm("Confirm attendance for " + a.name + "?"))
                      action("manual_checkin");
                  }}
                >
                  Confirm attendance
                </button>
              )}
            </div>
          </section>
          <section className="editor-section">
            <h3>Digital certificate</h3>
            <Status value={a.certificate_status} />
            <div className="actions">
              {a.certificate_status !== "ISSUED" && (
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    !event.certificates_enabled ||
                    (!a.checked_in_at && !canOverride)
                  }
                  onClick={() => {
                    if (!a.checked_in_at) {
                      const reason = prompt(
                        "Admin eligibility override: enter the reason",
                      );
                      if (reason)
                        action("issue_certificate", { override: true, reason });
                    } else action("issue_certificate");
                  }}
                >
                  {a.certificate_status === "REVOKED"
                    ? "Reissue certificate"
                    : "Issue certificate record"}
                </button>
              )}
              {a.certificate_token && (
                <a
                  className="button secondary"
                  href={"/verify/" + a.certificate_token}
                  target="_blank"
                  rel="noreferrer"
                >
                  View verification
                </a>
              )}
              {a.certificate_token &&
                a.certificate_status === "ISSUED" &&
                event.certificate_template_url && (
                  <a
                    className="button secondary"
                    href={
                      "/api/certificate/download?token=" + a.certificate_token
                    }
                  >
                    Download certificate
                  </a>
                )}
              {a.certificate_status === "ISSUED" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Regenerate with the current template and details? The previous verification link will stop working.",
                      )
                    )
                      action("regenerate_certificate");
                  }}
                >
                  Regenerate certificate
                </button>
              )}
              {a.certificate_status === "ISSUED" && (
                <button
                  className="danger secondary"
                  onClick={() => {
                    if (confirm("Revoke this certificate?"))
                      action("revoke_certificate");
                  }}
                >
                  Revoke certificate
                </button>
              )}
            </div>
            {!event.certificate_template_url && (
              <p className="muted">
                Official certificate template has not been configured.
                Certificate records and verification work; PDF issuance waits
                for FDI’s template.
              </p>
            )}
          </section>
          <section className="editor-section">
            <h3>Invitation controls</h3>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (a.invitation_status === "REVOKED") action("reactivate");
                  else {
                    const reason = prompt(
                      "Reason for revoking this invitation:",
                    );
                    if (reason !== null) action("revoke", { reason });
                  }
                }}
              >
                {a.invitation_status === "REVOKED"
                  ? "Reactivate invitation"
                  : "Revoke invitation"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Reset access? Existing invitation links and QR codes will stop working.",
                    )
                  )
                    action("reset");
                }}
              >
                Reset link & QR
              </button>
            </div>
            <div className="actions">
              <label className="field">
                Move to another event
                <select value={move} onChange={(e) => setMove(e.target.value)}>
                  <option value="">Choose event</option>
                  {events
                    .filter((e) => e.id !== event.id)
                    .map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="secondary"
                disabled={!move || busy}
                onClick={() => {
                  if (
                    confirm(
                      "Move registration? RSVP will reset and invitation access will rotate.",
                    )
                  )
                    action("attendee_move", { new_event_id: move });
                }}
              >
                Move registration
              </button>
            </div>
            <button
              className="danger text-button"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Remove this registration and revoke its invitation and certificate? The audit trail is retained.",
                  )
                )
                  action("remove");
              }}
            >
              Remove registration
            </button>
          </section>
        </>
      )}
    </div>
  );
}
export function localDate(iso: string, zone = "Asia/Amman") {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return parts.replace(" ", "T");
}
export function toISO(local: string, zone: string) {
  if (!local) return "";
  let d = new Date(local + "Z");
  const target = d.getTime();
  for (let i = 0; i < 3; i++) {
    const represented = new Date(
      localDate(d.toISOString(), zone) + "Z",
    ).getTime();
    d = new Date(d.getTime() + target - represented);
  }
  return d.toISOString();
}
export function EventEditor({
  event,
  onSaved,
}: {
  event?: Event;
  onSaved: () => Promise<void>;
}) {
  const [e, setE] = useState<any>(
      event
        ? {
            ...event,
            rsvp_deadline: localDate(event.rsvp_deadline, event.timezone),
            checkin_closes_at: localDate(
              event.checkin_closes_at,
              event.timezone,
            ),
            invitation_expires_at: localDate(
              event.invitation_expires_at ?? "",
              event.timezone,
            ),
          }
        : {
            name: "",
            short_name: "",
            code: "JPS",
            description: "",
            event_date: "2026-11-07",
            timezone: "Asia/Amman",
            rsvp_deadline: "2026-10-30T23:59",
            checkin_closes_at: "2026-11-07T23:59",
            invitation_expires_at: "2026-11-07T23:59",
            contact_email: "info@futuredoctorinitiative.org",
            contact_phone: "+962 7 9055 6148",
            partner: "Jordan Paramedic Society (JPS)",
            certificates_enabled: true,
            checkin_enabled: true,
            keep_invitation_record: true,
            disclaimer:
              "This invitation is personal and non-transferable. FDI reserves the right to verify the identity of the invitation holder.",
          },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const change = (name: string, value: string) =>
    setE((s: any) => ({ ...s, [name]: value }));
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    setBusy(true);
    try {
      await admin("event_save", {
        ...e,
        rsvp_deadline: toISO(e.rsvp_deadline, e.timezone),
        checkin_closes_at: toISO(e.checkin_closes_at, e.timezone),
        invitation_expires_at: e.invitation_expires_at
          ? toISO(e.invitation_expires_at, e.timezone)
          : null,
      });
      await onSaved();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      {error && <Notice error>{error}</Notice>}
      <h3>Event identity</h3>
      <div className="form-grid">
        {[
          ["name", "Event name", "text", true],
          ["short_name", "Short name"],
          ["code", "Event code", "text", true],
          ["event_date", "Event date", "date", true],
          ["timezone", "Timezone"],
          ["partner", "Training partner"],
          ["contact_email", "FDI contact email", "email", true],
          ["contact_phone", "FDI contact phone"],
        ].map(([n, l, t, r]: any) => (
          <Field
            key={n}
            name={n}
            label={l}
            type={t ?? "text"}
            required={!!r}
            value={e[n] ?? ""}
            onChange={change}
          />
        ))}
      </div>
      <Field
        label="Description"
        name="description"
        value={e.description ?? ""}
        onChange={change}
        area
      />
      <h3>Times & access</h3>
      <p className="muted">
        Times are interpreted in the event’s timezone. Check-in closes even if
        invitations remain viewable.
      </p>
      <div className="form-grid">
        {[
          ["rsvp_deadline", "RSVP deadline", "datetime-local"],
          ["checkin_closes_at", "Check-in closing time", "datetime-local"],
          [
            "invitation_expires_at",
            "Invitation expiry (optional)",
            "datetime-local",
          ],
          ["arrival_time", "Arrival time", "time"],
          ["start_time", "Start time", "time"],
          ["end_time", "End time", "time"],
        ].map(([n, l, t]) => (
          <Field
            key={n}
            name={n}
            label={l}
            type={t}
            value={e[n] ?? ""}
            onChange={change}
            required={n !== "invitation_expires_at" && t === "datetime-local"}
          />
        ))}
      </div>
      <h3>Venue & instructions</h3>
      <div className="form-grid">
        {[
          ["venue", "Venue"],
          ["address", "Address"],
          ["directions_url", "Directions URL"],
          ["maps_url", "Google Maps URL"],
          ["dress_code", "Dress code"],
          ["partner_logo_url", "Partner logo URL (optional)"],
        ].map(([n, l]) => (
          <Field
            key={n}
            name={n}
            label={l}
            value={e[n] ?? ""}
            onChange={change}
          />
        ))}
      </div>
      {[
        ["schedule", "Schedule"],
        ["instructions", "Additional instructions"],
        ["disclaimer", "Invitation disclaimer"],
      ].map(([n, l]) => (
        <Field
          key={n}
          name={n}
          label={l}
          area
          value={e[n] ?? ""}
          onChange={change}
        />
      ))}
      <h3>Certificates & event settings</h3>
      {[
        ["certificates_enabled", "Enable digital certificates"],
        ["checkin_enabled", "Enable QR check-in"],
        ["keep_invitation_record", "Keep invitation viewable after expiration"],
      ].map(([n, l]) => (
        <label className="check-label" key={n}>
          <input
            type="checkbox"
            checked={!!e[n]}
            onChange={(ev) => setE({ ...e, [n]: ev.target.checked })}
          />
          {l}
        </label>
      ))}
      <Field
        label="Official certificate PDF template URL"
        name="certificate_template_url"
        value={e.certificate_template_url ?? ""}
        onChange={change}
      />
      <p className="muted">
        Upload FDI’s approved PDF template. Recipient details and verification
        QR are applied when a certificate is downloaded. Default positions are
        documented in the README.
      </p>
      {event && (
        <label className="field">
          Upload official PDF template
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading}
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try {
                if (f.size > 5242880)
                  throw new Error("Use a PDF smaller than 5MB.");
                const { PDFDocument } = await import("pdf-lib");
                const pdf = await PDFDocument.load(await f.arrayBuffer());
                if (pdf.getPageCount() !== 1)
                  throw new Error("Use a one-page PDF certificate template.");
                const { data } = await (await import("./api"))
                  .auth()
                  .then((c) => c.auth.getSession());
                const r = await fetch("/api/template?event=" + event.id, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/pdf",
                    Authorization: "Bearer " + data.session?.access_token,
                  },
                  body: f,
                });
                const d: any = await r.json();
                if (!r.ok) throw new Error(d.error);
                setE({ ...e, certificate_template_url: d.url });
              } catch (ex) {
                setError((ex as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
      )}
      <details className="schedule">
        <summary>Certificate field positions</summary>
        <p className="muted">
          X and Y are fractions of the PDF page (0–1). Y is measured from the
          bottom. Text is centered at X. QR size and text size are in points.
          Save before issuing certificates.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>X</th>
                <th>Y</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(defaultLayout).map(([key, defaults]) => (
                <tr key={key}>
                  <th>{key.replace("_", " ")}</th>
                  {(["x", "y", "size"] as const).map((axis) => (
                    <td key={axis}>
                      <input
                        aria-label={key + " " + axis}
                        type="number"
                        min={axis === "size" ? 6 : 0}
                        max={axis === "size" ? 72 : 1}
                        step={axis === "size" ? 1 : 0.01}
                        value={
                          e.certificate_layout?.[key]?.[axis] ?? defaults[axis]
                        }
                        onChange={(ev) =>
                          setE({
                            ...e,
                            certificate_layout: {
                              ...e.certificate_layout,
                              [key]: {
                                ...defaults,
                                ...e.certificate_layout?.[key],
                                [axis]: Number(ev.target.value),
                              },
                            },
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <button disabled={busy || uploading}>
        <Save size={16} />
        {busy ? "Saving…" : "Save event"}
      </button>
    </form>
  );
}
export function ImportDialog({
  event,
  roles,
  people,
  onSaved,
}: {
  event: Event;
  roles: { code: string; label: string }[];
  people: Attendee[];
  onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<
      { row: number; data: any; errors: string[]; include: boolean }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function parse(file: File) {
    if (file.size > 500000) {
      setError("Use a CSV smaller than 500KB with at most 500 rows.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (r) => {
        if (r.errors.length) {
          setError(r.errors.map((e) => e.message).join("; "));
          return;
        }
        if (r.data.length > 500) {
          setError("Maximum 500 rows per import.");
          return;
        }
        const seen = new Set<string>();
        const preliminary = r.data.map((row, i) => {
          const role =
            roles.find(
              (r) =>
                r.code === row.role?.toUpperCase() ||
                r.label.toLowerCase() === row.role?.toLowerCase(),
            )?.code ?? row.role;
          const data = { ...row, role_code: role };
          const v = personSchema.safeParse(data);
          const errors = v.success
            ? []
            : v.error.issues.map((i) => i.path.join(".") + ": " + i.message);
          const key = row.full_name?.trim().toLowerCase();
          if (seen.has(key)) errors.push("Duplicate name in CSV");
          seen.add(key);
          if (
            people.some(
              (p) =>
                p.name.toLowerCase() === key ||
                (row.email &&
                  p.email.toLowerCase() === row.email.toLowerCase()) ||
                (row.phone && p.phone === row.phone),
            )
          )
            errors.push("Likely existing person in this event");
          return {
            row: i + 2,
            data: v.success ? v.data : data,
            errors,
            include: !errors.length,
          };
        });
        setRows(preliminary);
        setError("");
        const candidates = preliminary.filter((r) => !r.errors.length);
        if (candidates.length) {
          setBusy(true);
          try {
            const check = await admin<{ index: number; duplicate: boolean }[]>(
              "import_preview",
              { event_id: event.id, rows: candidates.map((r) => r.data) },
            );
            const duplicates = new Set(
              check
                .filter((r) => r.duplicate)
                .map((r) => candidates[r.index].row),
            );
            setRows(
              preliminary.map((r) =>
                duplicates.has(r.row)
                  ? {
                      ...r,
                      include: false,
                      errors: [
                        ...r.errors,
                        "Likely existing FDI person. Add their existing person record manually.",
                      ],
                    }
                  : r,
              ),
            );
          } catch (e) {
            setError((e as Error).message);
            setRows(preliminary.map((r) => ({ ...r, include: false })));
          } finally {
            setBusy(false);
          }
        }
      },
    });
  }
  const valid = rows.filter((r) => r.include && !r.errors.length);
  return (
    <section>
      <p>
        Columns: full_name, role, email, phone, emergency_contact_name,
        emergency_contact_phone. Role accepts a label or code.
      </p>
      <div className="actions">
        <button
          className="secondary"
          onClick={() =>
            download(
              "FDI-import-template.csv",
              "full_name,role,email,phone,emergency_contact_name,emergency_contact_phone\n",
              "text/csv",
            )
          }
        >
          Download CSV template
        </button>
        <label className="field">
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              if (e.target.files?.[0]) parse(e.target.files[0]);
            }}
          />
        </label>
      </div>
      {error && <Notice error>{error}</Notice>}
      {rows.length > 0 && (
        <>
          <Notice>
            {valid.length} selected valid records. Invalid rows will not be
            imported. Existing global duplicates are rejected by the database
            and roll back the entire import.
          </Notice>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Import</th>
                  <th>CSV row</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"Import row " + r.row}
                        disabled={!!r.errors.length}
                        checked={r.include}
                        onChange={(e) =>
                          setRows(
                            rows.map((x) =>
                              x.row === r.row
                                ? { ...x, include: e.target.checked }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>{r.row}</td>
                    <td>{r.data.full_name}</td>
                    <td>{r.data.role_code}</td>
                    <td>
                      {r.errors.length ? (
                        <span className="error-text">
                          {r.errors.join("; ")}
                        </span>
                      ) : (
                        "✓ Valid"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || !valid.length}
            onClick={async () => {
              setBusy(true);
              try {
                await admin("import", {
                  event_id: event.id,
                  rows: valid.map((r) => r.data),
                });
                await onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Importing…" : `Import ${valid.length} valid records`}
          </button>
        </>
      )}
    </section>
  );
}
export function StaffManager({ events }: { events: Event[] }) {
  const [staff, setStaff] = useState<Staff[]>([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("CHECK_IN_STAFF"),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    admin<Staff[]>("staff_list")
      .then(setStaff)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function update(s: Staff) {
    try {
      await admin("staff_save", { ...s, events: s.events ?? [] });
      await load();
      setMessage("Access updated.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <h2>Authorized FDI accounts</h2>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/staff/invite", { email, role, events: selected }, true);
            setMessage("Staff invitation sent.");
            setEmail("");
            await load();
          } catch (ex) {
            setError((ex as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field
            label="Staff email"
            name="email"
            type="email"
            value={email}
            onChange={(_, v) => setEmail(v)}
            required
          />
          <label className="field">
            Access role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {["CHECK_IN_STAFF", "EVENT_MANAGER", "ADMIN", "SUPER_ADMIN"].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
            </select>
          </label>
        </div>
        <p>Assigned events (required for event managers and check-in staff)</p>
        {events.map((e) => (
          <label className="check-label" key={e.id}>
            <input
              type="checkbox"
              checked={selected.includes(e.id)}
              onChange={(v) =>
                setSelected(
                  v.target.checked
                    ? [...selected, e.id]
                    : selected.filter((id) => id !== e.id),
                )
              }
            />
            {e.name}
          </label>
        ))}
        <button
          disabled={
            busy ||
            (["EVENT_MANAGER", "CHECK_IN_STAFF"].includes(role) &&
              !selected.length)
          }
        >
          <Mail size={16} />
          Invite staff by email
        </button>
      </form>
      <div className="staff-list">
        {staff.map((s) => (
          <article key={s.user_id}>
            <div>
              <strong>{s.email}</strong>
              <Status value={s.enabled ? "ACTIVE" : "REVOKED"} />
            </div>
            <label className="field">
              Role
              <select
                value={s.role}
                onChange={(e) => update({ ...s, role: e.target.value })}
              >
                {[
                  "CHECK_IN_STAFF",
                  "EVENT_MANAGER",
                  "ADMIN",
                  "SUPER_ADMIN",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <p className="muted">
              Last sign-in:{" "}
              {s.last_login ? timestamp(s.last_login) : "Not available"}
            </p>
            <fieldset>
              <legend>Event access</legend>
              {events.map((e) => (
                <label className="check-label" key={e.id}>
                  <input
                    type="checkbox"
                    checked={s.events?.includes(e.id) ?? false}
                    onChange={(v) =>
                      update({
                        ...s,
                        events: v.target.checked
                          ? [...(s.events ?? []), e.id]
                          : (s.events ?? []).filter((id) => id !== e.id),
                      })
                    }
                  />
                  {e.name}
                </label>
              ))}
            </fieldset>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => update({ ...s, enabled: !s.enabled })}
              >
                {s.enabled ? "Disable access" : "Enable access"}
              </button>
              <button
                className="danger text-button"
                onClick={async () => {
                  if (confirm("Remove FDI access for " + s.email + "?")) {
                    try {
                      await admin("staff_remove", { user_id: s.user_id });
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }
                }}
              >
                Remove access
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export function RoleSettings({
  roles,
  onSaved,
}: {
  roles: { code: string; label: string }[];
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState(roles),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <section className="panel">
      <h2>Attendee role labels</h2>
      <p>Codes remain stable for IDs; display labels can be edited.</p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {values.map((r, i) => (
        <form
          key={r.code}
          className="actions"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await admin("roles_save", r);
              await onSaved();
              setMessage("Role label updated.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <span className="role-code">{r.code}</span>
          <Field
            label="Display label"
            name={r.code}
            value={r.label}
            onChange={(_, v) =>
              setValues(
                values.map((s, j) => (i === j ? { ...s, label: v } : s)),
              )
            }
          />
          <button className="secondary">Save label</button>
        </form>
      ))}
    </section>
  );
}
export function AccountSecurity() {
  const [factor, setFactor] = useState<any>(null),
    [enrolled, setEnrolled] = useState<any[]>([]),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const { auth } = await import("./api");
    const { data, error } = await (await auth()).auth.mfa.listFactors();
    if (error) setError(error.message);
    else setEnrolled(data.totp);
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="panel">
      <h2>Authenticator protection</h2>
      <p>
        Protect this account with an authenticator app. Once enabled, the server
        requires a verified second factor for staff operations.
      </p>
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {enrolled.map((f) => (
        <div key={f.id} className="actions">
          <Status value="ACTIVE" />
          <strong>{f.friendly_name ?? "Authenticator"}</strong>
          <button
            className="danger secondary"
            onClick={async () => {
              if (!confirm("Remove this authenticator from your account?"))
                return;
              const { auth } = await import("./api");
              const { error } = await (
                await auth()
              ).auth.mfa.unenroll({ factorId: f.id });
              if (error) setError(error.message);
              else {
                setMessage("Authenticator removed.");
                load();
              }
            }}
          >
            Remove authenticator
          </button>
        </div>
      ))}
      {!enrolled.length && !factor && (
        <button
          onClick={async () => {
            try {
              const { auth } = await import("./api");
              const { data, error } = await (
                await auth()
              ).auth.mfa.enroll({
                factorType: "totp",
                friendlyName: "FDI authenticator",
              });
              if (error) throw error;
              setFactor(data);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Enable authenticator
        </button>
      )}
      {factor && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const { auth } = await import("./api");
            const { error } = await (
              await auth()
            ).auth.mfa.challengeAndVerify({ factorId: factor.id, code });
            if (error) setError(error.message);
            else {
              setFactor(null);
              setMessage("Authenticator enabled.");
              load();
            }
          }}
        >
          <p>
            Scan this QR in your authenticator app, then enter its six-digit
            code.
          </p>
          <SecurityQR value={factor.totp.uri} />
          <Field
            name="code"
            label="Authenticator code"
            value={code}
            onChange={(_, v) => setCode(v)}
            required
          />
          <button>Verify & enable</button>
        </form>
      )}
    </section>
  );
}
