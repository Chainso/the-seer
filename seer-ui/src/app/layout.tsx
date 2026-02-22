import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seer MVP Shell",
  description: "Foundational route shell for Seer modules",
};

const navLinks = [
  { href: "/ontology", label: "Ontology Explorer" },
  { href: "/ingestion", label: "Ingestion Monitor" },
  { href: "/process", label: "Process Explorer" },
  { href: "/root-cause", label: "Root-Cause Lab" },
  { href: "/insights", label: "Insights Dashboard" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="page-chrome">
          <header className="top-nav">
            <p className="brand">Seer MVP</p>
            <nav>
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
