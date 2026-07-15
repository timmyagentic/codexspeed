# CodexSpeed

CodexSpeed is an independent benchmark and public dashboard for comparing the
visible output speed of Codex models at different reasoning efforts.

The benchmark runs locally through the installed Codex App Server. A signed
publisher uploads sanitized benchmark results to a display-only Cloudflare
site. The public website never runs Codex and never receives Codex credentials.

The project is independent and is not affiliated with, sponsored by, or
endorsed by OpenAI. “Codex” is used only to identify the product being measured.

## Status

MVP implementation is in progress. The approved design is documented in
[`docs/superpowers/specs/2026-07-16-codexspeed-design.md`](docs/superpowers/specs/2026-07-16-codexspeed-design.md).

## License

Apache-2.0. See `LICENSE` once the implementation baseline lands.
