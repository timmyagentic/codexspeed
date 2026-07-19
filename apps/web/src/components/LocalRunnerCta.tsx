import { Terminal } from "lucide-react";

export function LocalRunnerCta() {
  return (
    <aside
      className="local-runner-cta"
      aria-labelledby="local-runner-cta-heading"
    >
      <div className="local-runner-prompt">
        <span className="terminal-mark" aria-hidden="true">
          <Terminal size={24} strokeWidth={2.2} />
        </span>
        <div>
          <p className="eyebrow">
            Your device · your network · your Codex account
          </p>
          <h2 id="local-runner-cta-heading">
            Measure the path you actually use.
          </h2>
          <p>
            Run the same controlled benchmark locally. Review the exact turn
            count, then see the result in your terminal or open it here.
          </p>
        </div>
      </div>
      <a className="primary-link" href="/local">
        <Terminal aria-hidden="true" size={18} strokeWidth={2.2} />
        Test on this device
      </a>
    </aside>
  );
}
