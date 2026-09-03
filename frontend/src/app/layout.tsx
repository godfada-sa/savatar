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
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body className="antialiased">
        <LoadingScreen />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
