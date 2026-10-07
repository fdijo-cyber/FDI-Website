import { useState } from "react";
import { Modal } from "./components";
import type { Event } from "./types";
export function EventSchedule({
  event,
}: {
  event: Pick<Event, "schedule" | "schedule_image_url" | "schedule_items">;
}) {
  const [track, setTrack] = useState("");
  const items = event.schedule_items ?? [];
  const tracks = [...new Set(items.map((i) => i.track).filter(Boolean))];
  return (
    <details className="schedule">
      <summary>View event schedule</summary>
      {event.schedule_image_url && (
        <img
          className="schedule-image"
          src={event.schedule_image_url}
          alt="Event schedule"
          loading="lazy"
        />
      )}
      {event.schedule && <p className="preserve">{event.schedule}</p>}
      {items.length > 0 && (
        <>
          {tracks.length > 0 && (
            <label className="field">
              Schedule track
              <select value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="">All tracks</option>
                {tracks.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          )}
          <ol className="timeline">
            {items
              .filter((i) => !track || i.track === track)
              .map((i, n) => (
                <li key={n}>
                  <time>{i.time}</time>
                  <div>
                    <strong>{i.title}</strong>
                    {i.track && <span className="chip neutral">{i.track}</span>}
                    {i.details && (
                      <details>
                        <summary>Session details</summary>
                        <p className="preserve">{i.details}</p>
                      </details>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        </>
      )}
      {!event.schedule && !event.schedule_image_url && !items.length && (
        <p>The schedule will be added here by FDI.</p>
      )}
    </details>
  );
}
export function EventMap({
  event,
}: {
  event: Pick<Event, "venue" | "address" | "directions_url" | "maps_url">;
}) {
  const [open, setOpen] = useState(false);
  const destination = [event.venue, event.address].filter(Boolean).join(", ");
  if (!destination && !event.maps_url && !event.directions_url) return null;
  const external =
    event.directions_url ||
    event.maps_url ||
    "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(destination);
  return (
    <>
      <button className="secondary" onClick={() => setOpen(true)}>
        Open Google Maps
      </button>
      {open && (
        <Modal
          title={event.venue || "Event location"}
          onClose={() => setOpen(false)}
        >
          {destination && (
            <iframe
              title="Google Maps event location"
              className="map-window"
              src={
                "https://www.google.com/maps?q=" +
                encodeURIComponent(destination) +
                "&output=embed"
              }
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
          <p>
            {destination ||
              "Open the event’s Google Maps link for the exact location."}
          </p>
          <a
            className="button"
            href={external}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get directions in Google Maps
          </a>
          <p className="muted">Map content is provided by Google.</p>
        </Modal>
      )}
    </>
  );
}
