import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import LoadingScreen from "@/components/LoadingScreen";

const bodyFont = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Manrope({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Savatar — AI Live Streaming for Creators",
  description: "Go live, transform instantly with AI, and stream anywhere. The browser-based AI live streaming platform for desktop creators.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Whether the brand-intro splash already played this browser session. The
  // server can't read sessionStorage, so the splash mirrors its flag in a
  // session cookie; this lets auth pages render the splash in their very
  // first server response instead of flashing the page first.
  let introSeen = false;
  try {
    const jar = await cookies();
    introSeen = jar.get("savatar_intro_seen")?.value === "1";
  } catch {
    // Cookies unavailable (e.g. prerendering) — splash falls back to client logic.
  }

  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a flash.
            New visitors get light mode by default; the saved choice always wins. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("savatar-theme");if(t==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        {/* Full-viewport scroll container — required by the dark-mode
            inversion theme so fixed navbars and modals stay put. */}
        <div className="app-root">
          <LoadingScreen introSeen={introSeen} />
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
