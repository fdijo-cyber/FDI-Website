import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
export function Brand() {
  return (
    <div className="brand-space">
      <img
        className="brand-logo"
        src="/fdi-logo.png"
        alt="Future Doctor Initiative"
        width="150"
        height="150"
      />
    </div>
  );
}
export function Footer() {
  return (
    <footer>
      <strong>Free medical knowledge for all.</strong>
      <nav aria-label="Legal">
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </nav>
      <a href="mailto:info@futuredoctorinitiative.org">
        info@futuredoctorinitiative.org
      </a>
      <a href="tel:+962790556148">+962 7 9055 6148</a>
    </footer>
  );
}
export function Status({ value }: { value: string }) {
  const good = [
      "ACCEPTED",
      "ACTIVE",
      "ELIGIBLE",
      "ISSUED",
      "CHECKED_IN",
      "VALID",
      "VALID_INVITATION",
      "ALREADY_CHECKED_IN",
    ].includes(value),
    bad = /REVOKED|DECLINED|INVALID|EXPIRED|NOT_FOUND/.test(value);
  return (
    <span className={"chip " + (good ? "good" : bad ? "bad" : "neutral")}>
      {good ? (
        <CheckCircle2 size={14} />
      ) : bad ? (
        <AlertCircle size={14} />
      ) : null}
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={"notice " + (error ? "error" : "")}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function QR({ value }: { value: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#041F54", light: "#ffffff" },
    }).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [value]);
  return src ? (
    <img
      className="qr"
      src={src}
      width="240"
      height="240"
      alt="Secure FDI pass QR code"
    />
  ) : (
    <p>Preparing QR…</p>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const root = document.getElementById("root");
    const dialog = document.getElementById("modal-dialog");
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = dialog?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog?.querySelector<HTMLElement>("button,input")?.focus();
    root?.setAttribute("data-modal", "true");
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      root?.removeAttribute("data-modal");
      old?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        id="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  area = false,
  disabled = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
  type?: string;
  required?: boolean;
  area?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      {label}
      {area ? (
        <textarea
          name={name}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(name, e.target.value)}
          rows={4}
        />
      ) : (
        <input
          name={name}
          disabled={disabled}
          type={type}
          value={value}
          onChange={(e) => onChange(name, e.target.value)}
          required={required}
        />
      )}
    </label>
  );
}
