import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Premium Check",
  description:
    "What does it really cost to hold BTC or ETH? SoDEX spot & perps vs spot ETFs vs treasury stocks (mNAV), on live SoSoValue + SoDEX data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link href="/" className="brand">
              Premium Check
            </Link>
            <nav>
              <Link className="nav-full" href="/">Compare</Link>
              <Link className="nav-full" href="/journal">Journal</Link>
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
                  <Link href="/diag">Data status</Link>
                  <a href="https://github.com/Lazaniaaa/premium-check">GitHub</a>
                </div>
              </details>
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
