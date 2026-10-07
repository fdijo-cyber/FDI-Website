import { useEffect, useState } from "react";
import { auth, api } from "./api";
import { Brand, Notice, QR, Footer } from "./components";
export const TERMS_VERSION = "2026-10-07";
export function Authenticator({ onVerified }: { onVerified: () => void }) {
  const [factor, setFactor] = useState<any>(null),
    [factors, setFactors] = useState<any[]>([]),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    auth()
      .then((c) => c.auth.mfa.listFactors())
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setError(error.message);
        else setFactors(data.totp.filter((f) => f.status === "verified"));
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const c = await auth();
      const listed = await c.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      // Remove abandoned unverified enrollments, never a verified factor.
      for (const f of listed.data.all.filter(
        (f) => f.factor_type === "totp" && f.status === "unverified",
      )) {
        const r = await c.auth.mfa.unenroll({ factorId: f.id });
        if (r.error) throw r.error;
      }
      const r = await c.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Future Doctor Initiative",
        friendlyName: "FDI authenticator",
      });
      if (r.error) throw r.error;
      setFactor(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel security-panel">
      <h2>
        {factors.length
          ? "Verify your authenticator"
          : "Set up your authenticator"}
      </h2>
      <p>
        Use Google Authenticator, Microsoft Authenticator, or another TOTP app.
        Set your phone’s clock to automatic.
      </p>
      {error && <Notice error>{error}</Notice>}
      {!factors.length && !factor && (
        <button onClick={enroll} disabled={busy}>
          {busy ? "Preparing…" : "Set up TOTP"}
        </button>
      )}
      {factor && (
        <>
          <QR value={factor.totp.uri} />
          <details>
            <summary>Enter setup key manually</summary>
            <code className="setup-key">{factor.totp.secret}</code>
            <p>Account: FDI · Time based · 6 digits · 30 seconds</p>
          </details>
        </>
      )}
      {(factor || factors.length > 0) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const c = await auth();
              const result = await c.auth.mfa.challengeAndVerify({
                factorId: factor?.id ?? factors[0].id,
                code: code.trim(),
              });
              if (result.error) throw result.error;
              const level = await c.auth.mfa.getAuthenticatorAssuranceLevel();
              if (level.error) throw level.error;
              if (level.data.currentLevel !== "aal2")
                throw new Error(
                  "Verification did not upgrade the session. Please sign in again.",
                );
              setCode("");
              setFactor(null);
              onVerified();
            } catch (ex) {
              setError((ex as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {factors.length > 1 && (
            <label className="field">
              Authenticator
              <select
                value={factors[0].id}
                onChange={(e) =>
                  setFactors(
                    [...factors].sort((a) =>
                      a.id === e.target.value ? -1 : 1,
                    ),
                  )
                }
              >
                {factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.friendly_name || f.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Six-digit authenticator code
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
          <button disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify code"}
          </button>
        </form>
      )}
    </section>
  );
}
export function SecurityGate({
  state,
  onComplete,
}: {
  state: any;
  onComplete: () => void;
}) {
  const [accepted, setAccepted] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="public-shell login">
      <Brand />
      <div className="eyebrow">AUTHORIZED FDI PERSONNEL</div>
      <h1>Secure your workspace</h1>
      {state.needs_mfa ? (
        <Authenticator onVerified={onComplete} />
      ) : (
        <section className="panel">
          <h2>Privacy & staff responsibilities</h2>
          <p>
            Before accessing records, review the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              privacy notice
            </a>{" "}
            and{" "}
            <a href="/terms" target="_blank" rel="noreferrer">
              staff terms
            </a>
            .
          </p>
          <p>
            Only access assigned events, keep attendee information confidential,
            and report suspected misuse to FDI immediately.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I have read the privacy notice and agree to the staff terms (version{" "}
            {TERMS_VERSION}).
          </label>
          {error && <Notice error>{error}</Notice>}
          <button
            disabled={!accepted || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/security/terms", { version: TERMS_VERSION }, true);
                onComplete();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept & continue
          </button>
        </section>
      )}
      <button
        className="text-button"
        onClick={async () => {
          await (await auth()).auth.signOut();
          location.assign("/admin");
        }}
      >
        Sign out
      </button>
      <Footer />
    </main>
  );
}
