import { useEffect, useState } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  Shirt,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { api, date, download, timestamp } from "./api";
import { Brand, Footer, Status, Notice, QR, Field } from "./components";
import type { Invitation, Event } from "./types";
const escapeICS = (s: string) =>
  s
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
export function calendar(e: Event) {
  const d = e.event_date.replaceAll("-", "");
  const timed = (t: string) => d + "T" + t.replace(":", "") + "00";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FDI//Events//EN",
    "BEGIN:VEVENT",
    "UID:" + e.id + "@futuredoctorinitiative.org",
    "DTSTAMP:" +
      new Date().toISOString().replace(/[-:]/g, "").split(".")[0] +
      "Z",
    e.start_time
      ? `DTSTART;TZID=${e.timezone}:${timed(e.start_time)}`
      : "DTSTART;VALUE=DATE:" + d,
    ...(e.end_time ? [`DTEND;TZID=${e.timezone}:${timed(e.end_time)}`] : []),
    "SUMMARY:" + escapeICS(e.name),
    "LOCATION:" + escapeICS([e.venue, e.address].filter(Boolean).join(", ")),
    "DESCRIPTION:" + escapeICS(e.instructions),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  download("FDI-event.ics", lines.join("\r\n"), "text/calendar");
}
export function PublicInvitation({ token }: { token: string }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [meta, setMeta] = useState<{ name: string }>({
      name: "FDI Event Invitation",
    }),
    [invite, setInvite] = useState<Invitation | null>(null),
    [name, setName] = useState(""),
    [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/invitation/meta?token=" + token)
      .then(setMeta)
      .catch((e) => setError(e.message));
    api<Invitation>("/invitation?token=" + token)
      .then(setInvite)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setInvite(
        await api("/invitation/unlock?token=" + token, { name, fdi_id: id }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function rsvp(response: string) {
    setBusy(true);
    setError("");
    try {
      setInvite(await api("/invitation/rsvp?token=" + token, { response }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!invite)
    return (
      <main className="public-shell access">
        <Brand />
        <div className="eyebrow">PERSONAL INVITATION</div>
        <h1>{meta.name}</h1>
        <p className="lead">Access your invitation</p>
        <p className="muted">
          Enter your name and FDI ID exactly as provided in your invitation
          message.
        </p>
        <form onSubmit={unlock} className="access-form">
          <Field
            label="Full name"
            name="name"
            value={name}
            onChange={(_, v) => setName(v)}
            required
          />
          <Field
            label="FDI ID number"
            name="fdi_id"
            value={id}
            onChange={(_, v) => setId(v)}
            required
          />
          <small>Example: #FDI-JPS-P-137</small>
          {error && <Notice error>{error}</Notice>}
          <button disabled={busy || loading}>
            {busy ? "Verifying…" : "Access invitation"}
          </button>
        </form>
        <p className="security-note">
          <ShieldCheck size={17} />
          Your invitation is personal and non-transferable.
        </p>
        <Footer />
      </main>
    );
  const e = invite.event;
  const rsvpOpen = invite.rsvp_open && clock <= Date.parse(e.rsvp_deadline);
  return (
    <main className="invitation-shell reveal">
      <section className="invitation-card">
        <div className="invitation-top">
          <Brand />
          {e.partner && (
            <div className="partner">
              <span>TRAINING PARTNER</span>
              {e.partner_logo_url && (
                <img src={e.partner_logo_url} alt={e.partner} />
              )}
              <strong>{e.partner}</strong>
            </div>
          )}
        </div>
        <div className="invitation-title">
          <div className="eyebrow">YOU’RE INVITED</div>
          <h1>{invite.name}</h1>
          <span className="role-label">{invite.role}</span>
          <h2>{e.name}</h2>
          <p>{date(e.event_date)}</p>
        </div>
        <div className="pass-card">
          <div>
            <span className="eyebrow">YOUR FDI IDENTIFICATION</span>
            <strong className="fdi-id">{invite.fdi_id}</strong>
            <Status value={invite.status} />
            <Status value={invite.rsvp} />
            {invite.checked_in_at && (
              <p>✓ Checked in · {timestamp(invite.checked_in_at)}</p>
            )}
          </div>
          <div className="qr-wrap">
            {invite.qr_token ? (
              <>
                <QR value={location.origin + "/check/" + invite.qr_token} />
                <small>Present this pass at registration</small>
              </>
            ) : (
              <div className="qr-placeholder">
                <ShieldCheck size={34} />
                <p>
                  {invite.rsvp === "PENDING"
                    ? "Accept your invitation to activate your QR pass."
                    : invite.rsvp === "DECLINED"
                      ? "Your pass is inactive."
                      : "Check-in is closed or this pass is inactive."}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="event-cards">
          {[
            [CalendarDays, "Date", date(e.event_date)],
            [Clock, "Arrival", e.arrival_time],
            [Clock, "Start", e.start_time],
            [Clock, "End", e.end_time],
            [MapPin, "Location", e.venue],
            [Shirt, "Dress code", e.dress_code],
          ].map(([Icon, label, value]: any) => (
            <div className="event-card" key={label}>
              <Icon size={19} />
              <span>{label}</span>
              <strong>{value || "To be announced"}</strong>
            </div>
          ))}
        </div>
        {e.address && <p>{e.address}</p>}
        {error && <Notice error>{error}</Notice>}
        <section className="rsvp-panel">
          <div>
            <h3>Confirm your attendance</h3>
            <p>
              {rsvpOpen
                ? `Respond by ${date(e.rsvp_deadline)}. You can change your decision before the deadline.`
                : "The RSVP deadline has passed. Contact FDI to request a change."}
            </p>
          </div>
          <div className="actions">
            <button
              disabled={
                !rsvpOpen ||
                invite.status !== "ACTIVE" ||
                busy ||
                invite.rsvp === "ACCEPTED"
              }
              onClick={() => rsvp("ACCEPTED")}
            >
              Accept invitation
            </button>
            <button
              className="secondary"
              disabled={
                !rsvpOpen ||
                invite.status !== "ACTIVE" ||
                busy ||
                invite.rsvp === "DECLINED"
              }
              onClick={() => rsvp("DECLINED")}
            >
              Decline invitation
            </button>
          </div>
        </section>
        <div className="actions utility">
          <button className="secondary" onClick={() => calendar(e)}>
            Add to calendar
          </button>
          {(e.directions_url || e.maps_url) && (
            <a
              className="button secondary"
              href={e.directions_url || e.maps_url}
              target="_blank"
              rel="noreferrer"
            >
              Get directions
            </a>
          )}
          <a className="button secondary" href={"mailto:" + e.contact_email}>
            <Mail size={16} />
            Contact FDI
          </a>
        </div>
        <details className="schedule">
          <summary>View event schedule</summary>
          <p className="preserve">
            {e.schedule || "The schedule will be added here by FDI."}
          </p>
        </details>
        {e.instructions && (
          <section>
            <h3>Additional instructions</h3>
            <p className="preserve">{e.instructions}</p>
          </section>
        )}
        {invite.certificate && (
          <div className="notice">
            <strong>Digital certificate · {invite.certificate.number}</strong>
            <div className="actions">
              <a href={"/verify/" + invite.certificate.token}>
                Verify certificate
              </a>
              {invite.certificate.status === "ISSUED" &&
                invite.certificate.template_url && (
                  <a
                    href={
                      "/api/certificate/download?token=" +
                      invite.certificate.token
                    }
                  >
                    Download certificate
                  </a>
                )}
            </div>
          </div>
        )}
        <p className="disclaimer">{e.disclaimer}</p>
        <Footer />
      </section>
    </main>
  );
}
export function CertificateVerification({ token }: { token: string }) {
  const [c, setC] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/certificate?token=" + token)
      .then(setC)
      .catch((e) => setError(e.message));
  }, [token]);
  return (
    <main className="public-shell verification">
      <Brand />
      <div className="eyebrow">CERTIFICATE VERIFICATION</div>
      {error ? (
        <Notice error>{error}</Notice>
      ) : !c ? (
        <p>Verifying certificate…</p>
      ) : c.status === "VALID" ? (
        <>
          <ShieldCheck className="verified-icon" size={42} />
          <h1>Valid FDI certificate</h1>
          <p className="lead">{c.name}</p>
          <dl className="verification-details">
            <dt>Program</dt>
            <dd>{c.event}</dd>
            <dt>Program date</dt>
            <dd>{date(c.date)}</dd>
            <dt>Certificate ID</dt>
            <dd>{c.number}</dd>
            <dt>Issued by</dt>
            <dd>Future Doctor Initiative</dd>
            <dt>Issue date</dt>
            <dd>{date(c.issued_at)}</dd>
            {c.partner && (
              <>
                <dt>Training partner</dt>
                <dd>{c.partner}</dd>
              </>
            )}
          </dl>
          <Status value="VALID" />
        </>
      ) : (
        <>
          <h1>
            {c.status === "REVOKED"
              ? "Certificate revoked"
              : "Certificate not found"}
          </h1>
          <Notice error>
            {c.status === "REVOKED"
              ? "This certificate is no longer valid."
              : "No FDI certificate matches this verification link."}
          </Notice>
        </>
      )}
      <Footer />
    </main>
  );
}
export function Pass({ token }: { token: string }) {
  return (
    <main className="public-shell">
      <Brand />
      <div className="eyebrow">FDI EVENT PASS</div>
      <h1>Present your pass</h1>
      <p>
        Please present this QR code to authorized FDI registration personnel.
      </p>
      <a className="button" href={"/scan?pass=" + token}>
        Authorized staff sign in
      </a>
      <Footer />
    </main>
  );
}
export function PublicEvent({ id }: { id: string }) {
  const [e, setE] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/event?id=" + id)
      .then(setE)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="public-shell">
      <Brand />
      {error ? (
        <Notice error>{error}</Notice>
      ) : e?.name ? (
        <>
          <div className="eyebrow">FDI EVENT</div>
          <h1>{e.name}</h1>
          <p>{date(e.date)}</p>
          <p>{e.description}</p>
          <p>{e.venue || "Venue to be announced"}</p>
          <p className="preserve">{e.schedule}</p>
        </>
      ) : (
        <p>Loading event…</p>
      )}
      <Footer />
    </main>
  );
}
