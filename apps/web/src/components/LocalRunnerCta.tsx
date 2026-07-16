export function LocalRunnerCta() {
  return (
    <aside
      className="local-runner-cta"
      aria-labelledby="local-runner-cta-heading"
    >
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
      <a className="primary-link" href="/local">
        Test on this device
      </a>
    </aside>
  );
}
