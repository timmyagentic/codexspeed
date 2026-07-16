import { CopyCommand } from "../../components/CopyCommand.js";
import { LocalArtifactViewer } from "../../components/LocalArtifactViewer.js";
import {
  NODE_RUN_COMMAND,
  POSIX_RUN_COMMAND,
  PUBLIC_RUNNER_VERSION,
  RELEASE_ROOT,
  RUNNER_DOWNLOADS,
  WINDOWS_RUN_COMMAND,
} from "../local-runner.js";

export function LocalRunPage() {
  return (
    <article className="local-run-page">
      <header className="local-page-hero">
        <p className="eyebrow">CodexSpeed Runner v{PUBLIC_RUNNER_VERSION}</p>
        <h1>Test Codex speed on this device</h1>
        <p>
          Measure the Codex path that matters to you: this computer, this
          network, this login, right now.
        </p>
      </header>

      <section className="local-principles" aria-label="Local benchmark facts">
        <div>
          <strong>4</strong>
          <span>Default real Codex turns</span>
        </div>
        <div>
          <strong>0</strong>
          <span>Credentials sent to this site</span>
        </div>
        <div>
          <strong>Local</strong>
          <span>Terminal summary and JSON result</span>
        </div>
      </section>

      <section className="runner-start" aria-labelledby="runner-start-heading">
        <div className="runner-start-copy">
          <p className="eyebrow">Run once</p>
          <h2 id="runner-start-heading">One command, then a guided test.</h2>
          <p>
            You need an installed Codex CLI and an existing ChatGPT login. The
            runner checks both without starting a model turn, asks you to choose
            a model and reasoning effort, and shows the exact turn count before
            it can continue.
          </p>
        </div>
        <div className="runner-commands">
          <CopyCommand command={POSIX_RUN_COMMAND} label="macOS or Linux" />
          <CopyCommand
            command={WINDOWS_RUN_COMMAND}
            label="Windows PowerShell"
          />
          <details>
            <summary>Already have Node.js 22?</summary>
            <CopyCommand command={NODE_RUN_COMMAND} label="Fixed-version npx" />
          </details>
        </div>
      </section>

      <section className="download-section" aria-labelledby="download-heading">
        <div>
          <p className="eyebrow">Direct download</p>
          <h2 id="download-heading">Portable runner archives</h2>
          <p>
            Each archive includes a fixed Node.js runtime, project licenses, and
            a manifest. Verify it against the release checksums before running.
          </p>
        </div>
        <div className="download-grid">
          {RUNNER_DOWNLOADS.map((download) => (
            <a
              key={download.filename}
              href={`${RELEASE_ROOT}/${download.filename}`}
              rel="noreferrer"
            >
              {download.label}
            </a>
          ))}
          <a href={`${RELEASE_ROOT}/SHA256SUMS`} rel="noreferrer">
            SHA-256 checksums
          </a>
        </div>
      </section>

      <LocalArtifactViewer />

      <section
        className="local-privacy"
        aria-labelledby="local-privacy-heading"
      >
        <h2 id="local-privacy-heading">What stays on your computer</h2>
        <p>
          Nothing is uploaded automatically. The result contains model and
          effort identifiers, sanitized OS and architecture fields, timings,
          token counts, and runner versions. It does not contain the prompt,
          response text, reasoning text, credentials, account identifiers, or
          local paths.
        </p>
      </section>
    </article>
  );
}
