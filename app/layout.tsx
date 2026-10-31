import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { FirebaseAuthProvider } from "@/components/firebase-auth-provider";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "RydeGrub — Good food. Great journeys.",
  description:
    "Explore RydeGrub, a railway food ordering frontend demo. Find comforting Indian meals, build your cart, and follow a simulated seat delivery.",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07111F",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the trusted request nonce to enable dynamic SSR and script noncing.
  await headers();
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased`}>
        <FirebaseAuthProvider>
          {children}
        </FirebaseAuthProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
