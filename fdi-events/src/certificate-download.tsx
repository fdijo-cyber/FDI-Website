import { useEffect, useState } from "react";
import { api } from "./api";
import { Brand, Footer, Notice } from "./components";
export function CertificateDownload({ token }: { token: string }) {
  const [error, setError] = useState(""),
    [c, setC] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    api("/certificate/content?token=" + token)
      .then(setC)
      .catch((e) => setError(e.message));
  }, [token]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const verified = await api("/certificate/content?token=" + token);
      const { renderCertificate } = await import("./certificate-pdf");
      const responses = await Promise.all([
        fetch(verified.template_url),
        fetch("/certificate-font.ttf"),
      ]);
      if (responses.some((r) => !r.ok))
        throw new Error(
          "The official certificate assets could not be loaded. Contact FDI.",
        );
      const [template, font] = await Promise.all(
        responses.map((r) => r.arrayBuffer()),
      );
      const bytes = await renderCertificate(
        new Uint8Array(template),
        verified,
        location.origin,
        new Uint8Array(font),
      );
      const url = URL.createObjectURL(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = verified.number + ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-shell">
      <Brand />
      <div className="eyebrow">DIGITAL CERTIFICATE</div>
      <h1>{c?.name ?? "Your FDI certificate"}</h1>
      {c && (
        <>
          <p>{c.event}</p>
          <p>{c.number}</p>
        </>
      )}
      {error && <Notice error>{error}</Notice>}
      {ready && (
        <Notice>
          Your certificate is ready. Keep its verification QR visible when
          sharing it.
        </Notice>
      )}
      <button disabled={!c || busy} onClick={generate}>
        {busy
          ? "Preparing your PDF…"
          : ready
            ? "Download again"
            : "Download certificate PDF"}
      </button>
      {c && (
        <p>
          <a href={"/verify/" + token}>Verify authenticity</a>
        </p>
      )}
      <Footer />
    </main>
  );
}
