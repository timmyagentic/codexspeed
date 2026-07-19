# CodexSpeed Evidence Ledger — Design QA

## Sources

- Selected reference: `/Users/timmy/.codex/visualizations/2026/07/19/019f79d0-42b0-7cc3-be35-4b071ec9aeec/five-site-redesign/selected/codexspeed.png`
- Baseline desktop: `/Users/timmy/.codex/visualizations/2026/07/19/019f79d0-42b0-7cc3-be35-4b071ec9aeec/five-site-redesign/before/codexspeed-desktop-full.png`
- Baseline mobile: `/Users/timmy/.codex/visualizations/2026/07/19/019f79d0-42b0-7cc3-be35-4b071ec9aeec/five-site-redesign/before/codexspeed-mobile-full.png`

## Implementation captures

- Desktop, latest ledger, 1440 × 1024: `/Users/timmy/.codex/visualizations/2026/07/19/019f79d0-42b0-7cc3-be35-4b071ec9aeec/five-site-redesign/local/codexspeed/desktop-1440x1024.png`
- Desktop, two-cell comparison, 1440 × 1024: `/Users/timmy/.codex/visualizations/2026/07/19/019f79d0-42b0-7cc3-be35-4b071ec9aeec/five-site-redesign/local/codexspeed/desktop-compare-1440x1024.png`
- Mobile, latest ledger, 390 × 844: `/Users/timmy/.codex/visualizations/2026/07/19/019f79d0-42b0-7cc3-be35-4b071ec9aeec/five-site-redesign/local/codexspeed/mobile-390x844.png`

All implementation captures use the current production `/api/v1/latest` run copied into a temporary local D1 and published with the local test signing key. No production data was changed.

## Comparison history

1. Compared the full selected Evidence Ledger reference with the desktop implementation capture. Header rhythm, two-column proof hero, four-part evidence strip, local-runner callout, metric tabs, matrix/compare split, warm paper palette, lime proof signals, amber validity signal, and ledger footer all map closely to the selected target.
2. Compared the focused two-cell state. A/B marks stay anchored to the selected cells; distribution evidence, relative difference, Clear, p50 direction, and every non-measured cell state remain visible and factual.
3. Compared the mobile capture with the baseline mobile information order. The layout retains the compact menu, hero, evidence facts, verification proof, and local-runner action without horizontal overflow or hidden evidence.
4. Exercised all four metric tabs, two-cell replacement and Clear, mobile menu open/Escape, and local links. Console showed no warnings or errors.

## Findings

- P0: none.
- P1: none.
- P2: none.
- Desktop overflow: none at 1440 × 1024.
- Mobile overflow: none at 390 × 844.
- Reduced motion: positional motion is removed; brief opacity/color feedback remains.
- Reduced transparency: no translucent control surface is required to understand or operate the page.

final result: passed
