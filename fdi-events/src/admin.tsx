import { useCallback, useEffect, useState } from "react";
import {
  Users,
  CalendarDays,
  ScanLine,
  ClipboardList,
  LogOut,
  Settings,
  Shield,
  Search,
  Plus,
  Download,
  Printer,
  Upload,
  CheckSquare,
  Mail,
  Menu,
} from "lucide-react";
import Papa from "papaparse";
import { api, admin, auth, date, download, timestamp } from "./api";
import { csvSafe } from "../server/validation";
import { Brand, Status, Notice, Modal } from "./components";
import type { Attendee, Bootstrap, Event } from "./types";
import {
  PersonEditor,
  EventEditor,
  StaffManager,
  ImportDialog,
  RoleSettings,
  AccountSecurity,
} from "./editors";
import { SecurityGate, PasswordSetup } from "./security";
import { Footer } from "./components";
import { Scanner } from "./scanner";
export function AdminApp() {
  const [passwordSetup, setPasswordSetup] = useState(false);
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [security, setSecurity] = useState<any>(null);
  const [tab, setTab] = useState(
      location.pathname.startsWith("/scan") ? "scan" : "attendees",
    ),
    [selected, setSelected] = useState(""),
    [people, setPeople] = useState<Attendee[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [modal, setModal] = useState<{ kind: string; data?: any } | null>(null),
    [menu, setMenu] = useState(false);
  const [query, setQuery] = useState(""),
    [role, setRole] = useState(""),
    [rsvp, setRsvp] = useState(""),
    [attendance, setAttendance] = useState(""),
    [invitation, setInvitation] = useState(""),
    [cert, setCert] = useState(""),
    [sort, setSort] = useState("serial"),
    [checks, setChecks] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    setError("");
    try {
      const client = await auth();
      const gate = await api<any>("/security", undefined, true);
      if (gate.needs_mfa) {
        setSecurity(gate);
        setBoot(null);
        setPeople([]);
        return;
      }
      setSecurity(null);
      if (
        gate.needs_password ||
        sessionStorage.getItem("fdi-password-setup") === "true"
      ) {
        setPasswordSetup(true);
        setBoot(null);
        setPeople([]);
        return;
      }
      setPasswordSetup(false);
      if (gate.needs_terms) {
        setSecurity(gate);
        setBoot(null);
        setPeople([]);
        return;
      }
      const b = await admin<Bootstrap>("bootstrap");
      setBoot(b);
      setSelected((s) =>
        b.events.some((e) => e.id === s) ? s : (b.events[0]?.id ?? ""),
      );
      if (b.staff.role === "CHECK_IN_STAFF") setTab("scan");
      if (location.pathname.startsWith("/auth/"))
        history.replaceState(
          null,
          "",
          b.staff.role === "CHECK_IN_STAFF" ? "/scan" : "/admin",
        );
    } catch (e) {
      setError((e as Error).message);
      setBoot(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let unsubscribe = () => {};
    const type = new URLSearchParams(location.hash.slice(1)).get("type");
    if (type === "invite" || type === "recovery")
      sessionStorage.setItem("fdi-password-setup", "true");
    auth()
      .then(async (c) => {
        const { data } = await c.auth.getSession();
        if (data.session) await load();
        else setLoading(false);
        const sub = c.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") {
            setBoot(null);
            setSecurity(null);
            setPeople([]);
            setPasswordSetup(false);
            sessionStorage.removeItem("fdi-password-setup");
          }
          if (
            ["SIGNED_IN", "MFA_CHALLENGE_VERIFIED", "TOKEN_REFRESHED"].includes(
              event,
            )
          )
            setTimeout(load, 0);
          if (event === "PASSWORD_RECOVERY") {
            sessionStorage.setItem("fdi-password-setup", "true");
            setPasswordSetup(true);
            setTimeout(load, 0);
          }
        });
        unsubscribe = () => sub.data.subscription.unsubscribe();
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    return () => unsubscribe();
  }, [load]);
  const refresh = useCallback(async () => {
    if (!boot || !selected || boot.staff.role === "CHECK_IN_STAFF") return;
    try {
      setPeople(await admin("attendees", { event_id: selected }));
      setChecks(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [boot, selected]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (tab === "audit" && selected)
      admin("audit", { event_id: selected })
        .then(setAudit)
        .catch((e) => setError(e.message));
  }, [tab, selected]);
  const event = boot?.events.find((e) => e.id === selected);
  async function exportBadges() {
    setBusy(true);
    try {
      const rows = await admin<any[]>("badge_export", { event_id: selected });
      download(
        (event?.code ?? "FDI") + "-badge-import.csv",
        Papa.unparse(
          rows.map((r) => ({
            "FDI ID": csvSafe(r.fdi_id),
            Name: csvSafe(r.name),
            Role: csvSafe(r.role),
            Event: csvSafe(event?.name),
            QR_URL: location.origin + "/check/" + r.qr_token,
          })),
        ),
        "text/csv",
      );
      setMessage("Badge CSV downloaded. Keep these private QR links secure.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const c = await auth();
      if (password) {
        const { error } = await c.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await load();
      } else {
        const { error } = await c.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: location.origin + "/auth/callback",
          },
        });
        if (error) throw error;
        setMessage(
          "If this email belongs to an authorized account, a sign-in link will arrive shortly.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="public-shell">
        <Brand />
        <p>Loading your FDI workspace…</p>
      </main>
    );
  if (security) return <SecurityGate state={security} onComplete={load} />;
  if (passwordSetup) return <PasswordSetup onComplete={load} />;
  if (!boot)
    return (
      <main className="public-shell login">
        <Brand />
        <div className="eyebrow">AUTHORIZED FDI PERSONNEL</div>
        <h1>Staff workspace</h1>
        <p>Use the account invited by an FDI administrator.</p>
        {error && <Notice error>{error}</Notice>}
        {message && <Notice>{message}</Notice>}
        <form onSubmit={login}>
          <>
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Password{" "}
              <span className="muted">(leave blank for a magic link)</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
          <button disabled={busy}>
            {busy
              ? "Please wait…"
              : password
                ? "Sign in"
                : "Email sign-in link"}
          </button>
        </form>
        <button
          className="text-button"
          disabled={busy || !email}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await (
                await auth()
              ).auth.resetPasswordForEmail(email, {
                redirectTo: location.origin + "/auth/callback",
              });
              if (result.error) throw result.error;
              setMessage(
                "If this is your account, a password setup link will arrive by email. Existing access and invitations stay unchanged.",
              );
            } catch (ex) {
              setError((ex as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Set or reset password
        </button>
        <Footer />
      </main>
    );
  const staffOnly = boot.staff.role === "CHECK_IN_STAFF";
  const nav = [
    ...(!staffOnly
      ? [
          ["attendees", "Attendees", Users],
          ["events", "Events", CalendarDays],
        ]
      : []),
    ["scan", "Check-in scanner", ScanLine],
    ["security", "Account security", Shield],
    ...(!staffOnly ? [["audit", "Audit log", ClipboardList]] : []),
    ...(boot.staff.role === "SUPER_ADMIN"
      ? [
          ["users", "Staff access", Shield],
          ["settings", "Role labels", Settings],
        ]
      : []),
  ];
  const filtered = people
    .filter(
      (p) =>
        (!query ||
          [p.name, p.fdi_id, p.email, p.phone].some((v) =>
            v.toLowerCase().includes(query.toLowerCase()),
          )) &&
        (!role || p.role_code === role) &&
        (!rsvp || p.rsvp === rsvp) &&
        (!attendance || (attendance === "YES") === !!p.checked_in_at) &&
        (!invitation || p.invitation_status === invitation) &&
        (!cert || p.certificate_status === cert),
    )
    .sort((a, b) =>
      sort === "serial"
        ? a.serial - b.serial
        : String(a[sort as keyof Attendee] ?? "").localeCompare(
            String(b[sort as keyof Attendee] ?? ""),
          ),
    );
  const accepted = people.filter((p) => p.rsvp === "ACCEPTED").length,
    checked = people.filter((p) => p.checked_in_at).length;
  const acceptedChecked = people.filter(
    (p) => p.checked_in_at && p.rsvp === "ACCEPTED",
  ).length;
  const stats = [
    ["Total invited", people.length],
    ["Accepted", accepted],
    ["Declined", people.filter((p) => p.rsvp === "DECLINED").length],
    ["Pending", people.filter((p) => p.rsvp === "PENDING").length],
    ["Checked in", checked],
    ["Not checked in", people.length - checked],
  ];
  async function exportCSV(emergency = false) {
    let source = filtered;
    if (emergency) {
      try {
        const detailed = await admin<Attendee[]>("emergency_export", {
          event_id: selected,
        });
        source = detailed.filter((p) => filtered.some((f) => f.id === p.id));
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    const rows = source.map((p) =>
      Object.fromEntries(
        Object.entries({
          "FDI ID": p.fdi_id,
          Name: p.name,
          Role: p.role,
          Email: p.email,
          Phone: p.phone,
          RSVP: p.rsvp,
          Attendance: p.checked_in_at ? "CHECKED_IN" : "NOT_CHECKED_IN",
          "Check-in time": p.checked_in_at ?? "",
          "Certificate status": p.certificate_status,
          ...(emergency
            ? {
                "Emergency contact": p.emergency_contact_name,
                "Emergency phone": p.emergency_contact_phone,
              }
            : {}),
        }).map(([k, v]) => [k, csvSafe(v)]),
      ),
    );
    download(
      "FDI-attendees.csv",
      "\uFEFF" + Papa.unparse(rows),
      "text/csv;charset=utf-8",
    );
  }
  async function bulkCertificates() {
    setBusy(true);
    let success = 0;
    const failures: string[] = [];
    for (const id of checks) {
      try {
        await admin("issue_certificate", {
          event_id: selected,
          registration_id: id,
        });
        success++;
      } catch (e) {
        failures.push(
          (people.find((p) => p.id === id)?.name ?? id) +
            ": " +
            (e as Error).message,
        );
      }
    }
    setMessage(
      `${success} certificate records issued.${failures.length ? " " + failures.join("; ") : ""}`,
    );
    await refresh();
    setBusy(false);
  }
  return (
    <div className="workspace">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Brand />
        <div className="workspace-label">EVENT OPERATIONS</div>
        <nav>
          {nav.map(([key, label, Icon]: any) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setMenu(false);
                history.replaceState(
                  null,
                  "",
                  key === "scan" ? "/scan" : "/admin",
                );
              }}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="staff-box">
          <strong>{boot.staff.email}</strong>
          <small>{boot.staff.role.replaceAll("_", " ")}</small>
          <button
            className="secondary"
            onClick={async () => {
              await (await auth()).auth.signOut();
              setBoot(null);
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <div>
            <span className="eyebrow">FUTURE DOCTOR INITIATIVE</span>
            <h1>{nav.find((n) => n[0] === tab)?.[1] as string}</h1>
          </div>
          <label className="event-select">
            Current event
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setPeople([]);
                setChecks(new Set());
              }}
            >
              <option value="" disabled>
                Select event
              </option>
              {boot.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </header>
        {error && <Notice error>{error}</Notice>}
        {message && (
          <Notice>
            {message}
            <button className="text-button" onClick={() => setMessage("")}>
              Dismiss
            </button>
          </Notice>
        )}
        {tab === "security" ? (
          <AccountSecurity />
        ) : tab === "scan" ? (
          <Scanner events={boot.events} eventId={selected} />
        ) : tab === "users" ? (
          <StaffManager events={boot.events} />
        ) : tab === "settings" ? (
          <RoleSettings roles={boot.roles} onSaved={load} />
        ) : tab === "events" ? (
          <section className="panel">
            <div className="panel-header">
              <h2>FDI events</h2>
              {["SUPER_ADMIN", "ADMIN"].includes(boot.staff.role) && (
                <button onClick={() => setModal({ kind: "event" })}>
                  <Plus size={17} />
                  Create event
                </button>
              )}
            </div>
            <div className="event-grid">
              {boot.events.map((e) => (
                <article className="event-summary" key={e.id}>
                  <span className="eyebrow">{e.code}</span>
                  <h3>{e.name}</h3>
                  <p>{date(e.event_date)}</p>
                  <p>{e.venue || "Venue to be announced"}</p>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => setModal({ kind: "event", data: e })}
                    >
                      Edit event
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelected(e.id);
                        setTab("attendees");
                      }}
                    >
                      Manage attendees
                    </button>
                    <a
                      href={"/events/" + e.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Public event page
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : tab === "audit" ? (
          <section className="panel">
            <p>
              Immutable history of event activity. Times shown in Asia/Amman.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Target</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{timestamp(a.created_at)}</td>
                      <td>{a.action.replaceAll("_", " ")}</td>
                      <td>{a.actor ?? "Invitation holder"}</td>
                      <td>{a.target_id ?? "—"}</td>
                      <td>{JSON.stringify(a.metadata)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!audit.length && (
                <div className="empty">No event activity recorded.</div>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="event-heading">
              <div>
                <span className="eyebrow">
                  {event?.code ?? "NO EVENT SELECTED"}
                </span>
                <h2>{event?.name ?? "Create your first event"}</h2>
                <p>
                  {event
                    ? date(event.event_date)
                    : "Events can be created from the Events page."}
                  {event?.venue ? " · " + event.venue : ""}
                </p>
              </div>
              {event && (
                <button onClick={() => setModal({ kind: "person" })}>
                  <Plus size={18} />
                  Add person
                </button>
              )}
            </section>
            <section className="stats">
              {stats.map(([label, value]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </section>
            <section className="attendance-summary">
              <div>
                <strong>
                  {accepted
                    ? ((acceptedChecked / accepted) * 100).toFixed(1)
                    : "0"}
                  %
                </strong>
                <span>of confirmed attendees checked in</span>
              </div>
              <div className="role-breakdown">
                {boot.roles.map((r) => (
                  <span key={r.code}>
                    {r.label}{" "}
                    <b>{people.filter((p) => p.role_code === r.code).length}</b>
                  </span>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h2>
                  Registration list{" "}
                  <span className="count">{filtered.length}</span>
                </h2>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={!event}
                    onClick={() => setModal({ kind: "import" })}
                  >
                    <Upload size={16} />
                    Import CSV
                  </button>
                  <button
                    className="secondary"
                    disabled={!event}
                    onClick={() => exportCSV()}
                  >
                    <Download size={16} />
                    Export CSV
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={exportBadges}
                  >
                    <Download size={16} />
                    Badge import CSV
                  </button>
                  <button
                    className="secondary"
                    disabled={!event}
                    onClick={() => setModal({ kind: "print" })}
                  >
                    <Printer size={16} />
                    Print list / PDF
                  </button>
                </div>
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Search attendees"
                    placeholder="Name, FDI ID, email or phone"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                {[
                  [
                    "Role",
                    role,
                    setRole,
                    boot.roles.map((r) => [r.code, r.label]),
                  ],
                  [
                    "RSVP",
                    rsvp,
                    setRsvp,
                    ["PENDING", "ACCEPTED", "DECLINED"].map((s) => [s, s]),
                  ],
                  [
                    "Attendance",
                    attendance,
                    setAttendance,
                    [
                      ["YES", "Checked in"],
                      ["NO", "Not checked in"],
                    ],
                  ],
                  [
                    "Invitation",
                    invitation,
                    setInvitation,
                    ["DRAFT", "ACTIVE", "REVOKED", "EXPIRED"].map((s) => [
                      s,
                      s,
                    ]),
                  ],
                  [
                    "Certificate",
                    cert,
                    setCert,
                    ["NOT_ELIGIBLE", "ELIGIBLE", "ISSUED", "REVOKED"].map(
                      (s) => [s, s],
                    ),
                  ],
                ].map(([label, value, set, opts]: any) => (
                  <label key={label} className="filter-label">
                    {label}
                    <select value={value} onChange={(e) => set(e.target.value)}>
                      <option value="">All {label.toLowerCase()}</option>
                      {opts.map(([v, t]: string[]) => (
                        <option value={v} key={v}>
                          {t.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="filter-label">
                  Sort
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    {[
                      ["serial", "ID"],
                      ["name", "Name"],
                      ["role", "Role"],
                      ["rsvp", "RSVP"],
                      ["checked_in_at", "Attendance"],
                    ].map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {checks.size > 0 && (
                <div className="bulk-bar">
                  <CheckSquare size={18} />
                  {checks.size} selected
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={bulkCertificates}
                  >
                    Issue eligible certificates
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setChecks(new Set())}
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="table-wrap">
                <table className="attendees-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select filtered attendees"
                          checked={
                            !!filtered.length &&
                            filtered.every((p) => checks.has(p.id))
                          }
                          onChange={(e) =>
                            setChecks(
                              e.target.checked
                                ? new Set(filtered.map((p) => p.id))
                                : new Set(),
                            )
                          }
                        />
                      </th>
                      <th>Name / FDI ID</th>
                      <th>Role</th>
                      <th>RSVP</th>
                      <th>Attendance</th>
                      <th>Invitation</th>
                      <th>Certificate</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"Select " + p.name}
                            checked={checks.has(p.id)}
                            onChange={(e) =>
                              setChecks((s) => {
                                const n = new Set(s);
                                e.target.checked ? n.add(p.id) : n.delete(p.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                          <small>{p.fdi_id}</small>
                        </td>
                        <td>{p.role}</td>
                        <td>
                          <Status value={p.rsvp} />
                        </td>
                        <td>
                          {p.checked_in_at ? (
                            <>
                              <Status value="CHECKED_IN" />
                              <small>{timestamp(p.checked_in_at)}</small>
                            </>
                          ) : (
                            <span className="muted">Not checked in</span>
                          )}
                        </td>
                        <td>
                          <Status value={p.invitation_status} />
                        </td>
                        <td>
                          <Status value={p.certificate_status} />
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              setModal({ kind: "person", data: p })
                            }
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty">
                    <Users size={30} />
                    <h3>
                      {people.length
                        ? "No matching attendees"
                        : "Your registration list is empty"}
                    </h3>
                    <p>
                      {people.length
                        ? "Adjust your search or filters."
                        : "Add a person or import a CSV to create personalized invitations."}
                    </p>
                  </div>
                )}
              </div>
            </section>
            <div className="export-private">
              {["SUPER_ADMIN", "ADMIN"].includes(boot.staff.role) && (
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      confirm(
                        "Export emergency contacts? Only share this file with authorized FDI personnel.",
                      )
                    )
                      exportCSV(true);
                  }}
                >
                  Export with emergency contacts
                </button>
              )}
            </div>
          </>
        )}
        {modal?.kind === "person" && event && (
          <Modal
            title={modal.data ? "Manage attendee" : "Add person"}
            onClose={() => setModal(null)}
          >
            <PersonEditor
              attendee={modal.data}
              event={event}
              events={boot.events}
              roles={boot.roles}
              canOverride={["SUPER_ADMIN", "ADMIN"].includes(boot.staff.role)}
              onSaved={refresh}
              onClose={() => setModal(null)}
            />
          </Modal>
        )}
        {modal?.kind === "event" && (
          <Modal
            title={modal.data ? "Edit event" : "Create event"}
            onClose={() => setModal(null)}
          >
            <EventEditor
              event={modal.data}
              onSaved={async () => {
                await load();
                setModal(null);
              }}
            />
          </Modal>
        )}
        {modal?.kind === "import" && event && (
          <Modal title="Import attendees" onClose={() => setModal(null)}>
            <ImportDialog
              event={event}
              roles={boot.roles}
              people={people}
              onSaved={async () => {
                await refresh();
                setModal(null);
              }}
            />
          </Modal>
        )}
        {modal?.kind === "print" && event && (
          <Modal title="Registration clipboard" onClose={() => setModal(null)}>
            <div className="actions no-print">
              <button onClick={() => window.print()}>
                <Printer size={16} />
                Print / save as PDF
              </button>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    "FDI-clipboard.csv",
                    Papa.unparse(
                      filtered.map((p, i) => ({
                        "No.": i + 1,
                        "FDI ID": csvSafe(p.fdi_id),
                        Name: csvSafe(p.name),
                        Role: csvSafe(p.role),
                        RSVP: p.rsvp,
                        Attendance: p.checked_in_at ? "✓" : "☐",
                      })),
                    ),
                    "text/csv",
                  )
                }
              >
                Clipboard CSV
              </button>
            </div>
            <div className="print-sheet">
              <h2>{event.name} · Registration list</h2>
              <p>{date(event.event_date)}</p>
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>FDI ID</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>RSVP</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id}>
                      <td>{i + 1}</td>
                      <td>{p.fdi_id}</td>
                      <td>{p.name}</td>
                      <td>{p.role}</td>
                      <td>{p.rsvp}</td>
                      <td>☐</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Modal>
        )}
      </main>
    </div>
  );
}
