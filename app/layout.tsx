import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { OilSidebar } from "./components/oil-sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StockAgent",
  description: "Følg Oslo Børs med AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nb"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="border-b border-slate-200 bg-white">
          <nav
            aria-label="Hovedmeny"
            className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-5 sm:px-8"
          >
            <Link
              href="/"
              className="flex items-center gap-3 font-semibold tracking-tight"
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-800 text-sm text-white"
                aria-hidden="true"
              >
                S
              </span>
              StockAgent
            </Link>
            <span className="text-xs text-slate-500">
              Oslo Børs <span className="mx-2 text-slate-300">/</span> Nyheter &
              oversikt
            </span>
          </nav>
        </div>
        <div className="mx-auto grid w-full max-w-[1600px] items-start xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">{children}</div>
          <OilSidebar />
        </div>
        <footer className="mx-auto mt-auto w-full max-w-[1600px] px-4 py-8 text-xs leading-6 text-slate-400 sm:px-8">
          StockAgent · Nyhetsoversikter bygger på overskrifter og kildelenker.
          Åpne originalkilden for full kontekst.
        </footer>
      </body>
    </html>
  );
}
