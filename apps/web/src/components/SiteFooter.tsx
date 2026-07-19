import { ArrowRight } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="footer-summary">
        CodexSpeed is a public, display-only archive of independent local
        model-speed benchmarks. Not affiliated with or endorsed by OpenAI.
      </p>
      <p className="footer-workflow">
        <strong>Workflow:</strong>
        <span>zero-upload local benchmark</span>
        <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
        <span>signed result</span>
        <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
        <span>public ledger</span>
      </p>
      <nav className="footer-navigation" aria-label="Footer">
        <a href="/methodology">Methodology</a>
        <a
          href="https://github.com/timmyagentic/codexspeed"
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </a>
        <a href="/THIRD_PARTY_NOTICES.md">Third-party notices</a>
      </nav>
    </footer>
  );
}
