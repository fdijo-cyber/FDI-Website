import QRCode from "qrcode";
import { download } from "./api";
export async function exportPassQR(
  token: string,
  id: string,
  format: "svg" | "png",
) {
  const value = location.origin + "/check/" + token;
  const filename = id.replace(/[^a-z0-9_-]/gi, "") || "FDI-pass";
  if (format === "svg")
    download(
      filename + "-QR.svg",
      await QRCode.toString(value, {
        type: "svg",
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#041F54", light: "#ffffff" },
      }),
      "image/svg+xml",
    );
  else {
    const src = await QRCode.toDataURL(value, {
      width: 1200,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#041F54", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = src;
    a.download = filename + "-QR.png";
    a.click();
  }
}
