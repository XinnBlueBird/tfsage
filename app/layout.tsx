import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TFSage — terraform plan blast-radius analyzer",
  description:
    "Paste a terraform plan output. Get blast-radius scoring, destructive-change detection, and concrete review notes powered by MiMo v2.5 Pro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
