import { z } from "zod";
const text = z.string().trim().max(2000);
const url = z.union([
  z.literal(""),
  z.url().refine((s) => s.startsWith("https://"), "Use an HTTPS URL"),
]);
const optionalText = text.optional().default("");
export const personSchema = z.object({
  full_name: z.string().trim().min(2).max(160),
  role_code: z.enum(["P", "T", "V", "TR", "S", "G"]),
  email: z
    .union([z.literal(""), z.email()])
    .optional()
    .default(""),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+\d\s().-]*$/)
    .optional()
    .default(""),
  emergency_contact_name: z.string().trim().max(160).optional().default(""),
  emergency_contact_phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+\d\s().-]*$/)
    .optional()
    .default(""),
  person_id: z.uuid().optional(),
  allow_duplicate: z.boolean().optional().default(false),
});
export const eventSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(160),
    short_name: optionalText,
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{2,12}$/),
    description: optionalText,
    event_date: z.iso.date(),
    timezone: z
      .string()
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone")
      .default("Asia/Amman"),
    rsvp_deadline: z.iso.datetime({ offset: true }),
    arrival_time: z.string().max(32).default(""),
    start_time: z.string().max(32).default(""),
    end_time: z.string().max(32).default(""),
    venue: optionalText,
    address: optionalText,
    directions_url: url.default(""),
    maps_url: url.default(""),
    dress_code: optionalText,
    contact_email: z.email().default("info@futuredoctorinitiative.org"),
    contact_phone: z.string().max(32).default("+962 7 9055 6148"),
    partner: optionalText,
    partner_logo_url: url.default(""),
    schedule: z.string().max(16000).default(""),
    instructions: z.string().max(8000).default(""),
    disclaimer: z
      .string()
      .max(2000)
      .default(
        "This invitation is personal and non-transferable. FDI reserves the right to verify the identity of the invitation holder.",
      ),
    certificates_enabled: z.boolean().default(true),
    checkin_enabled: z.boolean().default(true),
    invitation_expires_at: z
      .union([z.literal(""), z.iso.datetime({ offset: true }), z.null()])
      .optional(),
    checkin_closes_at: z.iso.datetime({ offset: true }),
    keep_invitation_record: z.boolean().default(true),
    certificate_template_url: url.default(""),
    certificate_layout: z
      .record(
        z.string(),
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          size: z.number().min(6).max(72),
        }),
      )
      .default({}),
  })
  .refine(
    (v) => Date.parse(v.checkin_closes_at) > Date.parse(v.rsvp_deadline),
    "Check-in closing time must follow RSVP deadline",
  );
export const adminSchema = z.object({
  action: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export function validateAdmin(
  action: string,
  p: Record<string, unknown>,
): Record<string, unknown> {
  const eventId = () => z.uuid().parse(p.event_id),
    registration = () => z.uuid().parse(p.registration_id);
  if (action === "bootstrap" || action === "staff_list") return {};
  if (action === "staff_save")
    return z
      .object({
        user_id: z.uuid(),
        email: z.email(),
        role: z.enum([
          "SUPER_ADMIN",
          "ADMIN",
          "EVENT_MANAGER",
          "CHECK_IN_STAFF",
        ]),
        enabled: z.boolean(),
        events: z.array(z.uuid()).max(100),
      })
      .parse(p);
  if (action === "staff_remove") return { user_id: z.uuid().parse(p.user_id) };
  if (action === "roles_save")
    return z
      .object({
        code: z.enum(["P", "T", "V", "TR", "S", "G"]),
        label: z.string().trim().min(2).max(60),
      })
      .parse(p);
  if (action === "event_save") return eventSchema.parse(p);
  if (["attendees", "audit", "emergency_export"].includes(action))
    return { event_id: eventId() };
  if (action === "people_search")
    return {
      event_id: eventId(),
      query: z.string().trim().min(2).max(160).parse(p.query),
    };
  if (action === "attendee_create")
    return { event_id: eventId(), ...personSchema.parse(p) };
  if (action === "import" || action === "import_preview")
    return {
      event_id: eventId(),
      rows: z.array(personSchema).min(1).max(500).parse(p.rows),
    };
  const base = { event_id: eventId(), registration_id: registration() };
  switch (action) {
    case "attendee_edit":
      return { ...base, ...personSchema.parse(p) };
    case "attendee_move":
      return { ...base, new_event_id: z.uuid().parse(p.new_event_id) };
    case "rsvp_override":
      return {
        ...base,
        response: z.enum(["PENDING", "ACCEPTED", "DECLINED"]).parse(p.response),
      };
    case "issue_certificate":
    case "regenerate_certificate":
      return {
        ...base,
        override: z.boolean().optional().parse(p.override),
        reason: z.string().max(1000).optional().parse(p.reason),
      };
    case "revoke":
    case "undo_checkin":
      return {
        ...base,
        reason: z.string().max(1000).optional().parse(p.reason),
      };
    case "delivery":
      return {
        ...base,
        channel: z.enum(["EMAIL", "WHATSAPP", "LINK"]).parse(p.channel),
        state: z.enum(["PREPARED", "SENT"]).parse(p.state),
      };
    case "attendee_detail":
    case "remove":
    case "reactivate":
    case "reset":
    case "manual_checkin":
    case "revoke_certificate":
      return base;
    default:
      throw new Error("Unknown action");
  }
}
export function csvSafe(value: unknown) {
  const s = String(value ?? "");
  return /^[=+@\-\t\r]/.test(s) ? "'" + s : s;
}
