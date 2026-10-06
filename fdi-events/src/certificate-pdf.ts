import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { defaultLayout } from "./certificate-layout";

export async function renderCertificate(
  template: Uint8Array,
  c: any,
  origin: string,
  fontBytes?: Uint8Array,
) {
  const doc = await PDFDocument.load(template);
  if (doc.getPageCount() !== 1)
    throw new Error("Use a one-page certificate template.");
  const page = doc.getPages()[0],
    { width, height } = page.getSize();
  doc.registerFontkit(fontkit);
  const font = fontBytes
    ? await doc.embedFont(fontBytes, { subset: true })
    : await doc.embedFont(StandardFonts.Helvetica);
  const layout = { ...defaultLayout, ...c.layout };
  const values = {
    name: c.name,
    event: c.event,
    date: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Amman",
    }).format(new Date(c.date + "T12:00:00Z")),
    number: c.number,
    fdi_id: c.fdi_id,
    issued: "Issued " + new Date(c.issued_at).toISOString().slice(0, 10),
  };
  for (const [key, value] of Object.entries(values)) {
    const p = layout[key];
    const size = Math.min(
      p.size,
      (width * 0.8) / Math.max(font.widthOfTextAtSize(String(value), 1), 1),
    );
    page.drawText(String(value), {
      x: width * p.x - font.widthOfTextAtSize(String(value), size) / 2,
      y: height * p.y,
      size,
      font,
      color: rgb(4 / 255, 31 / 255, 84 / 255),
    });
  }
  const png = await QRCode.toDataURL(origin + "/verify/" + c.token, {
    margin: 2,
    width: 256,
    errorCorrectionLevel: "M",
  });
  const im = await doc.embedPng(png);
  const q = layout.qr;
  page.drawImage(im, {
    x: width * q.x - q.size / 2,
    y: height * q.y,
    width: q.size,
    height: q.size,
  });
  return doc.save();
}
