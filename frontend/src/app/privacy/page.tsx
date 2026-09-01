import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Savatar",
  description: "How SaffulTech collects, uses, shares, and protects personal data when you use Savatar.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      description="This policy explains how SaffulTech, also known as Safful, handles personal data when you visit or use Savatar."
    >
      <div className="rounded-2xl border border-indigo-300/20 bg-indigo-400/8 p-6 text-sm leading-6 text-neutral-300">
        SaffulTech is the data controller for Savatar. We process personal data in accordance with Ghana&apos;s Data Protection Act, 2012 (Act 843) and other applicable requirements.
      </div>

      <LegalSection id="collect" title="1. Information we collect">
        <p><strong className="font-semibold text-neutral-200">Account information.</strong> Your name, email address, profile image, account identifier, authentication provider, account creation date, and sign-in information. Passwords are handled by Firebase Authentication and are not visible to SaffulTech.</p>
        <p><strong className="font-semibold text-neutral-200">Wallet and transaction information.</strong> Credit balance, time purchased and used, plan, promo-code usage, payment amount, network, mobile-money phone number, payment reference, provider response, and transaction status.</p>
        <p><strong className="font-semibold text-neutral-200">Creation and live-session information.</strong> AI prompts, selected transformation mode, reference images you choose, camera and microphone streams, room identifiers, viewer counts, connection data, and live-chat messages.</p>
        <p><strong className="font-semibold text-neutral-200">Device and service information.</strong> Browser and device information, IP address and approximate location derived from it, timestamps, diagnostic logs, security events, and service-performance data. Stream preferences such as resolution and frame rate may be stored locally in your browser.</p>
      </LegalSection>

      <LegalSection id="sources" title="2. How we collect information">
        <p>We collect information directly from you, automatically when you use Savatar, from your chosen sign-in provider, from payment providers, and from service providers that help us operate and secure the platform.</p>
        <p>Camera, microphone, and reference-image access occurs only after you choose the feature and grant the relevant browser permission.</p>
      </LegalSection>

      <LegalSection id="use" title="3. How we use information">
        <ul className="list-disc space-y-2 pl-5 marker:text-indigo-400">
          <li>Create and secure your account and provide authentication.</li>
          <li>Operate AI transformations, live rooms, WebRTC delivery, and viewer chat.</li>
          <li>Process payments, maintain credit balances, prevent duplicate credits, and keep transaction records.</li>
          <li>Provide support, investigate errors, enforce our terms, and prevent fraud or abuse.</li>
          <li>Measure reliability and improve Savatar&apos;s performance and user experience.</li>
          <li>Comply with legal obligations and respond to lawful requests.</li>
        </ul>
      </LegalSection>

      <LegalSection id="basis" title="4. Legal grounds for processing">
        <p>Depending on the context, we process personal data to perform our contract with you, with your consent, to meet legal obligations, and for legitimate interests such as securing the platform, preventing fraud, supporting users, and improving service reliability. You may withdraw consent where processing depends on consent, without affecting earlier lawful processing.</p>
      </LegalSection>

      <LegalSection id="media" title="5. Camera, audio, AI, and live rooms">
        <p>Your browser sends selected media and prompts to the services needed to create the transformation. When you go live, transformed media is delivered to viewers through real-time communication technology. Anyone with access to a public or shared room may view the broadcast and messages.</p>
        <p>Savatar does not intentionally make a permanent recording of your live camera, microphone, or chat in the current service. Media may be processed transiently by AI, cloud, and communication providers, and viewers may independently capture content outside our control. Do not broadcast confidential material or anyone who has not agreed to appear.</p>
      </LegalSection>

      <LegalSection id="sharing" title="6. When we share information">
        <p>We disclose information only as needed to provide the service, protect users, complete transactions, or comply with law. Provider categories include:</p>
        <ul className="list-disc space-y-2 pl-5 marker:text-indigo-400">
          <li>Google Firebase for authentication and cloud database services.</li>
          <li>Decart and related AI infrastructure for real-time media transformation.</li>
          <li>Moolre and participating mobile-money networks for payment processing and verification.</li>
          <li>Vercel and other hosting, networking, signaling, monitoring, and security providers.</li>
          <li>Professional advisers, regulators, courts, or law-enforcement authorities where legally required.</li>
        </ul>
        <p>We do not sell personal data. We do not use personal data for third-party direct marketing without the required consent.</p>
      </LegalSection>

      <LegalSection id="transfers" title="7. International processing">
        <p>Some providers may process information outside Ghana. Where personal data is transferred internationally, we take reasonable steps to use providers and safeguards appropriate to the information and applicable law.</p>
      </LegalSection>

      <LegalSection id="retention" title="8. Retention">
        <p>We keep account information while your account is active and for a reasonable period afterward to handle support, security, disputes, and legal obligations. Payment and transaction records may be retained for the periods required by financial, tax, fraud-prevention, and recordkeeping rules.</p>
        <p>Live signaling and chat are intended to be temporary. Browser preferences remain on your device until you clear them. When information is no longer needed, we delete or anonymise it where reasonably practicable, subject to legal retention requirements and backup cycles.</p>
      </LegalSection>

      <LegalSection id="security" title="9. Security">
        <p>We use reasonable technical and organisational safeguards designed to protect personal data, including access controls, authenticated requests for sensitive operations, encrypted network transport, and restricted service credentials. No internet service is completely secure, so you should use a strong password and protect your devices and account.</p>
      </LegalSection>

      <LegalSection id="rights" title="10. Your privacy rights">
        <p>Subject to Ghana&apos;s Data Protection Act, 2012 (Act 843), you may ask to be informed about processing; access, correct, block, erase, or destroy eligible personal data; object to or prevent certain processing; withdraw consent; avoid direct marketing; challenge significant solely automated decisions; or complain about unlawful processing.</p>
        <p>Send a request from the email associated with your account to the contact below. We may need to verify your identity. You may also complain to Ghana&apos;s Data Protection Commission if you believe your data rights have been violated.</p>
      </LegalSection>

      <LegalSection id="children" title="11. Children">
        <p>Savatar is not directed to children under 13. Users under 18 must have a parent or legal guardian&apos;s permission. If you believe a child has provided personal data without appropriate permission, contact us so we can investigate and take appropriate action.</p>
      </LegalSection>

      <LegalSection id="changes" title="12. Policy changes">
        <p>We may update this policy as Savatar changes or legal requirements develop. We will post the new version with an updated effective date and provide additional notice when a change materially affects how we use personal data.</p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact and complaints">
        <p>SaffulTech (Safful), Ghana, is responsible for Savatar. Privacy questions, rights requests, and account-deletion requests may be sent to <a href="mailto:safful652@gmail.com" className="font-semibold text-indigo-300 hover:text-indigo-200">safful652@gmail.com</a>.</p>
        <p>For more information about your statutory rights, visit the <a href="https://dataprotection.org.gh/for-individuals/" className="font-semibold text-indigo-300 hover:text-indigo-200" target="_blank" rel="noreferrer">Ghana Data Protection Commission</a>. Use of Savatar is also governed by our <Link href="/terms" className="font-semibold text-indigo-300 hover:text-indigo-200">Terms of Service</Link>.</p>
      </LegalSection>
    </LegalPage>
  );
}
