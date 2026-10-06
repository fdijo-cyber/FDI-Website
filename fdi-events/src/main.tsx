import React from "react";
import { createRoot } from "react-dom/client";
import {
  PublicInvitation,
  CertificateVerification,
  PublicEvent,
  Pass,
} from "./public";
import { lazy, Suspense } from "react";
const CertificateDownload = lazy(() =>
  import("./certificate-download").then((m) => ({
    default: m.CertificateDownload,
  })),
);
const AdminApp = lazy(() =>
  import("./admin").then((m) => ({ default: m.AdminApp })),
);
import { Brand, Footer } from "./components";
import "./styles.css";
const path = location.pathname;
let page;
if (path.startsWith("/invite/"))
  page = <PublicInvitation token={path.split("/")[2]} />;
else if (path.startsWith("/certificate/"))
  page = <CertificateDownload token={path.split("/")[2]} />;
else if (path.startsWith("/verify/"))
  page = <CertificateVerification token={path.split("/")[2]} />;
else if (path.startsWith("/events/"))
  page = <PublicEvent id={path.split("/")[2]} />;
else if (path.startsWith("/check/")) page = <Pass token={path.split("/")[2]} />;
else if (
  path.startsWith("/admin") ||
  path.startsWith("/scan") ||
  path.startsWith("/auth/")
)
  page = <AdminApp />;
else
  page = (
    <main className="public-shell">
      <Brand />
      <div className="eyebrow">FUTURE DOCTOR INITIATIVE</div>
      <h1>Events & invitations</h1>
      <p>Open your personal invitation link to access your FDI event pass.</p>
      <div className="actions">
        <a className="button" href="/admin">
          Staff sign in
        </a>
        <a className="button secondary" href="/scan">
          Registration scanner
        </a>
      </div>
      <Footer />
    </main>
  );
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p className="public-shell">Loading FDI workspace…</p>}>
      {page}
    </Suspense>
  </React.StrictMode>,
);
