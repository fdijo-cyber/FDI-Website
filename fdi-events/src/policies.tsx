import { Brand, Footer } from "./components";
import { TERMS_VERSION } from "./security";
export function Policy({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <main className="public-shell policy">
      <Brand />
      <div className="eyebrow">FUTURE DOCTOR INITIATIVE</div>
      <h1>{kind === "privacy" ? "Privacy notice" : "Event & staff terms"}</h1>
      <p>Version {TERMS_VERSION}</p>
      {kind === "privacy" ? (
        <>
          <h2>Who handles your information</h2>
          <p>
            Future Doctor Initiative (FDI) operates this event platform. Contact
            info@futuredoctorinitiative.org or +962 7 9055 6148 for privacy
            questions or requests.
          </p>
          <h2>Information and purposes</h2>
          <p>
            FDI records your name, FDI ID, event role, contact details,
            invitation and RSVP decisions, attendance, and certificate records
            to organize events and verify participation. Emergency contact
            details, if supplied, are used for event emergencies. Staff account
            details, assigned roles, login information, and action logs support
            secure administration.
          </p>
          <h2>Who can see it</h2>
          <p>
            Invitations show only the holder’s name, ID, role and event details
            after name and ID verification. Authorized check-in staff see
            identity and attendance information for assigned events. Personal
            contact and emergency contact details remain restricted to
            authorized management. Public certificate links show the recipient,
            program, dates, certificate number and issuer.
          </p>
          <h2>Service providers and external links</h2>
          <p>
            Cloudflare hosts the platform and Supabase provides authentication,
            database and file storage. Processing locations depend on the
            deployed services and project region and may be outside Jordan.
            Email and WhatsApp invitations use the sender’s chosen provider.
            Opening Google Maps or other external links sends information to
            that provider under its own terms. Maps load only when you choose to
            open them.
          </p>
          <h2>Storage and security</h2>
          <p>
            Essential session storage and cookies keep your login and invitation
            verification active. This application includes no advertising
            trackers. FDI restricts access, requires staff TOTP, and records
            important actions. Keep private invitation and badge links
            confidential. Information is retained only for event administration,
            certificate verification, security and applicable record
            obligations; contact FDI to ask about a particular record’s
            retention or deletion.
          </p>
          <h2>Your choices and requests</h2>
          <p>
            Contact FDI to request access, correction, deletion, restriction,
            objection, portability, or withdrawal of consent where applicable.
            FDI may need to verify your identity and explain any applicable
            legal reason to retain a record. Declining an invitation stops
            check-in eligibility. Withdrawal or deletion requests may affect
            participation or certificate verification.
          </p>
          <h2>Providing someone else’s details</h2>
          <p>
            Before providing an emergency contact’s information, inform them and
            obtain appropriate permission. Staff must establish an appropriate
            lawful basis and provide this notice before importing personal data.
            This notice is not a substitute for consent where required. Do not
            submit unnecessary medical or other sensitive information.
          </p>
        </>
      ) : (
        <>
          <h2>Personal invitations and event participation</h2>
          <p>
            Passes are personal and non-transferable. FDI may verify identity,
            revoke misuse, adjust schedules or venues, and communicate event
            changes. Follow organizer and venue instructions and treat
            participants respectfully. A certificate confirms the recorded
            program and does not itself grant a professional license or clinical
            authority.
          </p>
          <h2>Educational purpose</h2>
          <p>
            Event content is educational. It does not replace individualized
            medical advice, local clinical protocols, professional supervision,
            or emergency services. Participate in practical activities within
            your competence and follow the trainer’s safety instructions.
          </p>
          <h2>Staff confidentiality and permitted use</h2>
          <p>
            Use only your own invited account. Do not share passwords,
            authenticator setup keys or sessions. Access only information needed
            for your assigned duties and events. Do not copy, publish, sell,
            forward or reuse attendee details for personal purposes. Keep
            exports and printed lists secure, share them only with authorized
            personnel, and dispose of them when no longer needed.
          </p>
          <h2>Check-in and records</h2>
          <p>
            Verify the holder before manually confirming attendance. Do not
            falsify attendance, certificates or delivery records. Administrative
            actions and agreement acceptance are recorded. Roles and event
            assignments can be changed or disabled by authorized FDI
            administrators.
          </p>
          <h2>Incidents and departure</h2>
          <p>
            Immediately report lost devices, exposed links, suspected
            unauthorized access or inaccurate records to
            info@futuredoctorinitiative.org. Stop using data when your
            assignment ends and return or securely delete local copies as
            directed by FDI. Confidentiality obligations continue after access
            is removed.
          </p>
          <h2>Rights and responsibility</h2>
          <p>
            Nothing in these terms excludes rights or liabilities that
            applicable law does not allow to be excluded, or waives data
            protection rights. FDI will consider concerns raised through its
            contact address. These terms are governed by applicable Jordanian
            law, subject to mandatory rights that apply.
          </p>
        </>
      )}
      <p>
        <a href={kind === "privacy" ? "/terms" : "/privacy"}>
          {kind === "privacy"
            ? "Read event & staff terms"
            : "Read privacy notice"}
        </a>{" "}
        · <a href="/admin">Staff sign in</a>
      </p>
      <Footer />
    </main>
  );
}
