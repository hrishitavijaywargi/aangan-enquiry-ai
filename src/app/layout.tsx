import type { Metadata } from "next";
import Shell from "@/components/Shell";
import { ready } from "@/lib/ready";
import { systemStatus } from "@/lib/status";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aangan Studio — Enquiry Assistant",
  description: "AI-powered phone enquiry management for Aangan Studio, Pune",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ready();
  return (
    <html lang="en">
      <body>
        <Shell status={await systemStatus()}>{children}</Shell>
      </body>
    </html>
  );
}
