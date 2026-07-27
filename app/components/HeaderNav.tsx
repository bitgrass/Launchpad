"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Analytics and HOODIE Fuel are both protocol-data surfaces, so they share a
// single header entry and keep the top level down to three items.
const STATS_LINKS = [
  { href: "/analytics", label: "Analytics", hint: "Volume, launches, trades" },
  { href: "/fuel", label: "HOODIE Fuel", hint: "Where every fee goes" },
];

export function HeaderNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <nav aria-label="Main navigation">
      <Link href="/explore">Explore</Link>
      <Link href="/leaderboard">Leaderboard</Link>
      <div className="nav-menu" ref={menuRef}>
        <button
          type="button"
          className="nav-menu-trigger"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          Stats <span aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="nav-dropdown" role="menu">
            {STATS_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <strong>{link.label}</strong>
                <small>{link.hint}</small>
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
