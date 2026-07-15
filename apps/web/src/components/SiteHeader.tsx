import { useState } from "react";

const REPOSITORY_URL = "https://github.com/timmyagentic/codexspeed";

type SiteHeaderProps = {
  activePath: string;
};

function activeFor(path: string, activePath: string): boolean {
  if (path === "/runs") {
    return activePath === "/runs" || activePath.startsWith("/runs/");
  }
  return path === activePath;
}

export function SiteHeader({ activePath }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const links = [
    { href: "/", label: "Latest" },
    { href: "/runs", label: "Runs" },
    { href: "/methodology", label: "Methodology" },
    { href: REPOSITORY_URL, label: "GitHub", external: true },
  ] as const;

  return (
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="CodexSpeed home">
        CodexSpeed
      </a>
      <button
        className="menu-button"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="site-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="menu-lines" aria-hidden="true"><i /><i /><i /></span>
        Menu
      </button>
      <nav id="site-navigation" className="site-navigation" data-open={menuOpen} aria-label="Primary">
        {links.map((link) => (
          <a
            key={link.href}
            className={activeFor(link.href, activePath) ? "active" : undefined}
            href={link.href}
            {...("external" in link ? { rel: "noreferrer", target: "_blank" } : {})}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
