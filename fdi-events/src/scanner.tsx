import { useEffect, useRef, useState } from "react";
import { Camera, ShieldCheck, CheckCircle2, ScanLine } from "lucide-react";
import { api, timestamp } from "./api";
import { Status, Notice } from "./components";
import type { Event } from "./types";
export function Scanner({
  events,
  eventId,
}: {
  events: Event[];
  eventId: string;
}) {
  const [input, setInput] = useState(
      new URLSearchParams(location.search).get("pass") ?? "",
    ),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [token, setToken] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<{ stop: () => void } | null>(null),
    mounted = useRef(true),
    inFlight = useRef(false),
    cameraEpoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controls.current?.stop();
    };
  }, []);
  useEffect(() => {
    cameraEpoch.current++;
    controls.current?.stop();
    setCamera(false);
    setResult(null);
    setToken("");
  }, [eventId]);
  function extract(raw: string) {
    let t = raw.trim();
    if (t.startsWith("http")) {
      const u = new URL(t);
      if (
        u.origin !== location.origin ||
        !/^\/check\/[a-f0-9]{64}$/.test(u.pathname)
      )
        throw new Error("This QR is not an FDI pass for this platform.");
      t = u.pathname.split("/")[2];
    }
    if (!/^[a-f0-9]{64}$/.test(t))
      throw new Error("Enter a valid FDI pass URL or secure token.");
    return t;
  }
  async function scan(raw: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    const epoch = cameraEpoch.current;
    setError("");
    setBusy(true);
    controls.current?.stop();
    setCamera(false);
    try {
      const t = extract(raw);
      setToken(t);
      const data = await api(
        "/scan",
        { event_id: eventId, token: t, confirm: false },
        true,
      );
      if (epoch === cameraEpoch.current) setResult(data);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function start() {
    const epoch = ++cameraEpoch.current;
    setError("");
    setResult(null);
    setCamera(true);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!mounted.current || epoch !== cameraEpoch.current) return;
      const reader = new BrowserQRCodeReader();
      const c = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        video.current!,
        (result, _error, c) => {
          if (epoch !== cameraEpoch.current) {
            c.stop();
            return;
          }
          if (result) {
            c.stop();
            scan(result.getText());
          }
        },
      );
      if (!mounted.current || epoch !== cameraEpoch.current) c.stop();
      else controls.current = c;
    } catch (e) {
      setCamera(false);
      setError(
        "Camera unavailable. Allow camera permission over HTTPS, or paste the pass link below.",
      );
    }
  }
  async function confirm() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(
        await api(
          "/scan",
          {
            event_id: eventId,
            token,
            confirm: true,
            device: navigator.userAgent.slice(0, 200),
          },
          true,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const valid =
    result &&
    ["VALID_INVITATION", "CHECKED_IN", "ALREADY_CHECKED_IN"].includes(
      result.status,
    );
  return (
    <section className="scanner-shell">
      <div className="scanner-intro">
        <span className="eyebrow">REGISTRATION DESK</span>
        <h2>Verify. Then confirm.</h2>
        <p>
          Scanning checks the pass. Attendance is recorded only after you press
          Confirm attendance.
        </p>
        <strong>
          {events.find((e) => e.id === eventId)?.name ??
            "Select an assigned event to begin"}
        </strong>
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className={"camera-frame " + (camera ? "live" : "")}>
        <video ref={video} autoPlay playsInline muted hidden={!camera} />
        {!camera && (
          <div className="camera-idle">
            <ScanLine size={48} />
            <p>Ready to verify an FDI pass</p>
            <button disabled={!eventId || busy} onClick={start}>
              <Camera size={18} />
              Open camera scanner
            </button>
          </div>
        )}
        {camera && (
          <button
            className="camera-stop secondary"
            onClick={() => {
              controls.current?.stop();
              setCamera(false);
            }}
          >
            Stop camera
          </button>
        )}
      </div>
      <form
        className="manual-token"
        onSubmit={(e) => {
          e.preventDefault();
          scan(input);
        }}
      >
        <label className="field">
          Pass link or token
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste the /check/ link"
            autoComplete="off"
            required
          />
        </label>
        <button className="secondary" disabled={!eventId || busy}>
          {busy ? "Checking…" : "Verify pass"}
        </button>
      </form>
      {result && (
        <div
          className={"scan-result " + (valid ? "valid" : "invalid")}
          role="status"
        >
          <Status value={result.status} />
          {valid ? (
            <>
              <h2>{result.name}</h2>
              <p>{result.role}</p>
              <strong className="fdi-id">{result.fdi_id}</strong>
              <p>{result.event}</p>
              <div className="scan-status">
                <span>RSVP</span>
                <Status value={result.rsvp} />
                <span>Attendance</span>
                <strong>
                  {result.checked_in_at ? "CHECKED IN" : "NOT CHECKED IN"}
                </strong>
              </div>
              {result.checked_in_at ? (
                <Notice>
                  <CheckCircle2 size={18} />
                  Recorded {timestamp(result.checked_in_at)}
                  <small>
                    Checked in by:{" "}
                    {result.checked_in_by_email ?? result.checked_in_by}
                  </small>
                </Notice>
              ) : (
                <button
                  className="confirm-attendance"
                  onClick={confirm}
                  disabled={busy}
                >
                  <ShieldCheck size={21} />
                  {busy ? "Confirming…" : "Confirm attendance"}
                </button>
              )}
            </>
          ) : (
            <p>
              {
                (
                  {
                    INVALID_INVITATION: "This pass could not be validated.",
                    REVOKED_INVITATION: "This invitation was revoked.",
                    EXPIRED_INVITATION:
                      "This pass or event check-in period has expired.",
                    WRONG_EVENT:
                      "This pass belongs to a different event. Select the correct assigned event.",
                    DECLINED_INVITATION: "The invitation was declined.",
                    NOT_YET_ACCEPTED:
                      "The attendee must accept the invitation before check-in.",
                  } as Record<string, string>
                )[result.status]
              }
            </p>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setResult(null);
              setInput("");
              setToken("");
              start();
            }}
          >
            Scan next pass
          </button>
        </div>
      )}
    </section>
  );
}
