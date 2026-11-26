import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeToggle } from "./components/theme-toggle";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

// Applies a stored theme before the first paint, so a dark choice never flashes light.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Premium Check",
  description:
    "What does it really cost to hold BTC or ETH? SoDEX spot & perps vs spot ETFs vs treasury stocks (mNAV), on live SoSoValue + SoDEX data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link href="/" className="brand">
              Premium Check
            </Link>
            <nav>
              <Link className="nav-full" href="/">Compare</Link>
              <Link className="nav-full" href="/journal">Journal</Link>
              <Link className="nav-full" href="/validation">Validation</Link>
              <Link className="nav-full" href="/diag">Data status</Link>
              <Link href="/judges">For judges</Link>
              <a className="nav-full" href="https://github.com/Lazaniaaa/premium-check" target="_blank" rel="noreferrer">
                GitHub
              </a>
              <details className="nav-menu">
                <summary>Menu</summary>
                <div className="nav-menu-list">
                  <Link href="/">Compare</Link>
                  <Link href="/journal">Journal</Link>
                  <Link href="/validation">Validation</Link>
                  <Link href="/diag">Data status</Link>
                  <a href="https://github.com/Lazaniaaa/premium-check">GitHub</a>
                </div>
              </details>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap footer">
          Data: SoSoValue OpenAPI (ETFs, BTC treasuries, crypto stocks, balance sheets) and SoDEX mainnet
          market data. Not investment advice. Nothing on this site places orders.
        </footer>
      </body>
    </html>
  );
}
