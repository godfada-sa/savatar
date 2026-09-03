import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved/system theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("savatar-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        {/* Full-viewport scroll container — required by the dark-mode
            inversion theme so fixed navbars and modals stay put. */}
        <div className="app-root">
          <LoadingScreen />
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
