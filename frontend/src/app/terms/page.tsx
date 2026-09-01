import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — Savatar",
  description: "The terms that govern access to and use of the Savatar AI live-creation platform.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      description="These terms govern your access to Savatar, an AI live-creation service operated by SaffulTech, also referred to as Safful in these terms."
    >
      <div className="rounded-2xl border border-indigo-300/20 bg-indigo-400/8 p-6 text-sm leading-6 text-neutral-300">
        By creating an account, buying credits, or using Savatar, you agree to these Terms of Service and our{" "}
        <Link href="/privacy" className="font-semibold text-indigo-300 hover:text-indigo-200">Privacy Policy</Link>.
      </div>

      <LegalSection id="service" title="1. The service">
        <p>Savatar provides browser-based camera transformation, AI-assisted visual effects, live rooms, viewer chat, account management, and prepaid streaming credits. Features may change as the service develops.</p>
        <p>You must be at least 18 years old, or have permission from a parent or legal guardian who accepts these terms for you. You may use Savatar only where doing so is lawful.</p>
      </LegalSection>

      <LegalSection id="accounts" title="2. Accounts and security">
        <p>You must provide accurate account information and keep your login credentials secure. You are responsible for activity performed through your account unless you promptly notify us that it has been compromised.</p>
        <p>Do not share, sell, transfer, or create accounts through automated means. We may request reasonable information to verify account ownership before restoring access or processing an account request.</p>
      </LegalSection>

      <LegalSection id="content" title="3. Your content, likeness, and permissions">
        <p>You retain ownership of the prompts, reference images, camera feeds, audio, messages, and other material you provide. You give SaffulTech and its service providers a limited permission to process that material only as needed to operate, secure, and improve the service.</p>
        <p>You must have the rights and permissions needed for every person, image, voice, character, trademark, or other material you use. You may not use Savatar to impersonate, deceive, harass, exploit, or harm another person, or to create content that violates privacy, publicity, intellectual-property, or other legal rights.</p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="4. Acceptable use">
        <p>You may not use Savatar to create or distribute illegal, fraudulent, defamatory, sexually exploitative, hateful, threatening, or non-consensual content. You may not target minors, facilitate scams, evade platform safeguards, introduce malicious code, overload the service, probe systems without permission, or interfere with another user&apos;s session.</p>
        <p>Live rooms may be visible to other users or anyone with the link. You are responsible for what you broadcast and for clearly disclosing AI-generated or altered media where law, platform rules, or context requires it.</p>
      </LegalSection>

      <LegalSection id="ai" title="5. AI output">
        <p>AI output can be unexpected, inaccurate, or unsuitable. Review transformed content before relying on or publishing it. SaffulTech does not guarantee that output is unique, error-free, or free from similarity to content generated for others.</p>
        <p>Savatar is a creative tool and must not be used as a substitute for professional, legal, medical, financial, or safety-critical advice.</p>
      </LegalSection>

      <LegalSection id="payments" title="6. Credits, payments, and refunds">
        <p>Streaming credits represent prepaid service time. They are not currency, are not transferable, and have no cash value. Purchased credits remain available until used unless your account is terminated for a material breach, a refund is issued, or applicable law requires a different result.</p>
        <p>Prices are displayed in Ghana cedis and payments may be processed by third-party mobile-money providers. You authorize the stated charge when you confirm a purchase. Contact us promptly about duplicate or incorrect charges. Refunds are assessed for failed delivery, duplicate charges, or where required by applicable law; used credits are generally non-refundable.</p>
      </LegalSection>

      <LegalSection id="third-party" title="7. Third-party services">
        <p>Savatar relies on service providers for authentication, cloud hosting, data storage, AI processing, payments, and real-time communication. Their availability and separate terms may affect parts of the service. We are not responsible for third-party services outside our reasonable control.</p>
      </LegalSection>

      <LegalSection id="ownership" title="8. Savatar ownership">
        <p>SaffulTech owns Savatar&apos;s software, visual design, branding, documentation, and other service materials, excluding your content and third-party materials. We grant you a limited, personal, revocable, non-exclusive licence to use the service in accordance with these terms.</p>
      </LegalSection>

      <LegalSection id="suspension" title="9. Suspension and termination">
        <p>You may stop using Savatar at any time. You may request account deletion through the support contact below. We may restrict or terminate access when reasonably necessary to address a breach, fraud, abuse, security risk, legal requirement, or material threat to users or the service.</p>
        <p>Provisions that by their nature should continue after termination—including ownership, payment obligations, disclaimers, and liability limitations—will remain in effect.</p>
      </LegalSection>

      <LegalSection id="availability" title="10. Availability and disclaimers">
        <p>We work to keep Savatar reliable, but the service is provided on an “as available” basis. Live video, AI processing, payment networks, internet connections, and third-party platforms may experience delay, interruption, or failure. To the extent permitted by law, we disclaim implied warranties that cannot reasonably apply to an evolving online service.</p>
      </LegalSection>

      <LegalSection id="liability" title="11. Limitation of liability">
        <p>To the maximum extent permitted by law, SaffulTech will not be liable for indirect, incidental, special, consequential, or punitive losses, lost profits, lost data, reputational harm, or losses caused by user content, third-party services, or events outside our reasonable control.</p>
        <p>Nothing in these terms excludes liability that cannot lawfully be excluded, including liability arising from fraud, wilful misconduct, or rights that applicable consumer law protects.</p>
      </LegalSection>

      <LegalSection id="law" title="12. Governing law and disputes">
        <p>These terms are governed by the laws of the Republic of Ghana. Before bringing a formal claim, you and SaffulTech agree to make a reasonable effort to resolve the issue directly. If it cannot be resolved, the courts of Ghana will have jurisdiction, subject to any mandatory consumer rights that apply.</p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes to these terms">
        <p>We may update these terms to reflect new features, legal requirements, or operational changes. We will post the revised terms with a new effective date and provide additional notice when a change materially affects your rights. Continued use after the effective date means you accept the revised terms.</p>
      </LegalSection>

      <LegalSection id="contact" title="14. Contact">
        <p>Savatar is operated by SaffulTech (Safful), Ghana. Questions, account-deletion requests, payment disputes, and legal notices may be sent to <a href="mailto:safful652@gmail.com" className="font-semibold text-indigo-300 hover:text-indigo-200">safful652@gmail.com</a>.</p>
      </LegalSection>
    </LegalPage>
  );
}
