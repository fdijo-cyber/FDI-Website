// Normalize presentation only; never use partial or fuzzy identity matching.
export const normalizeName = (value: string) => value.normalize("NFKC")
  .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
  .trim().replace(/\s+/gu, " ").toLowerCase();
export const normalizeId = (value: string) => value.normalize("NFKC")
  .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
  .replace(/[\u2010-\u2015\u2212]/g, "-")
  .replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x660))
  .replace(/[\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) - 0x6f0))
  .replace(/\s+/gu, "").replace(/^#/, "").toUpperCase();
