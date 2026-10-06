export interface Event {
  id: string;
  name: string;
  short_name: string;
  code: string;
  description: string;
  event_date: string;
  timezone: string;
  rsvp_deadline: string;
  arrival_time: string;
  start_time: string;
  end_time: string;
  venue: string;
  address: string;
  directions_url: string;
  maps_url: string;
  dress_code: string;
  contact_email: string;
  contact_phone: string;
  partner: string;
  partner_logo_url: string;
  schedule: string;
  instructions: string;
  disclaimer: string;
  certificates_enabled: boolean;
  checkin_enabled: boolean;
  invitation_expires_at: string | null;
  checkin_closes_at: string;
  keep_invitation_record: boolean;
  certificate_template_url: string;
  certificate_layout: Record<string, { x: number; y: number; size: number }>;
}
export interface Attendee {
  id: string;
  person_id: string;
  person_fdi_id: string;
  event_id: string;
  name: string;
  fdi_id: string;
  serial: number;
  role_code: string;
  role: string;
  email: string;
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  rsvp: string;
  invitation_status: string;
  checked_in_at: string | null;
  certificate_status: string;
  invitation_token?: string;
  qr_token?: string;
  certificate_token?: string;
  created_at: string;
}
export interface Staff {
  user_id: string;
  email: string;
  role: string;
  enabled: boolean;
  events?: string[];
  last_login?: string | null;
}
export interface Bootstrap {
  staff: Staff;
  events: Event[];
  roles: { code: string; label: string }[];
}
export interface Invitation {
  name: string;
  fdi_id: string;
  role: string;
  rsvp: string;
  status: string;
  qr_token: string | null;
  checked_in_at: string | null;
  event: Event;
  rsvp_open: boolean;
  certificate: {
    number: string;
    token: string;
    status: string;
    template_url: string;
  } | null;
}
