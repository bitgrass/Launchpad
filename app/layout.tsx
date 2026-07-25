import type { Metadata } from "next";
import { WalletProvider } from "./components/WalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HoodiePad — Launch on Robinhood Chain",
    template: "%s · HoodiePad",
  },
  description:
    "Launch fixed-supply token markets paired with HOODIE. No presale, no migration, and creators keep 80% of canonical-pool fees.",
  icons: {
    icon: [{ url: "/hoodie-logo.jpg", type: "image/jpeg" }],
    shortcut: "/hoodie-logo.jpg",
    apple: "/hoodie-logo.jpg",
  },
  openGraph: {
    title: "HoodiePad — Launch markets. Keep 80%.",
    description:
      "Fixed-supply token markets paired with HOODIE on Robinhood Chain.",
    type: "website",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "HoodiePad — Launch markets. Keep 80%.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
