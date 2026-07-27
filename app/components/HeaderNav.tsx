import Link from "next/link";

// Top level stays to three destinations. HOODIE Fuel lives in the footer for
// now, and everything account-shaped sits in the profile menu.
export function HeaderNav() {
  return (
    <nav aria-label="Main navigation">
      <Link href="/explore">Explore</Link>
      <Link href="/analytics">Analytics</Link>
      <Link href="/leaderboard">Leaderboard</Link>
      <Link href="/docs">Docs</Link>
    </nav>
  );
}
