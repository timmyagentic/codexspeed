import { Menu as MenuIcon, X as XIcon } from "lucide-react";
import { useRef, useState } from "react";

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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const links = [
    { href: "/", label: "Latest" },
    { href: "/local", label: "Test locally" },
    { href: "/runs", label: "Runs" },
    { href: "/methodology", label: "Methodology" },
    { href: REPOSITORY_URL, label: "GitHub", external: true },
  ] as const;

  return (
    <header
      className="site-header"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          setMenuOpen(false);
          menuButtonRef.current?.focus();
        }
      }}
    >
      <a className="wordmark" href="/" aria-label="CodexSpeed home">
        CodexSpeed
      </a>
      <button
        ref={menuButtonRef}
        className="menu-button"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="site-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? (
          <XIcon aria-hidden="true" size={19} strokeWidth={2} />
        ) : (
          <MenuIcon aria-hidden="true" size={19} strokeWidth={2} />
        )}
        Menu
      </button>
      <nav
        id="site-navigation"
        className="site-navigation"
        data-open={menuOpen}
        aria-label="Primary"
      >
        {links.map((link) => {
          const active = activeFor(link.href, activePath);
          return (
            <a
              key={link.href}
              className={active ? "active" : undefined}
              href={link.href}
              aria-current={active ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
              {...("external" in link
                ? { rel: "noreferrer", target: "_blank" }
                : {})}
            >
              {link.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
