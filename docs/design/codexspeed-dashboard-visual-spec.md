# CodexSpeed dashboard visual specification

## Source concepts

- Desktop primary screen: `codexspeed-home-desktop.png` (1440 x 1100)
- Mobile primary screen: `codexspeed-home-mobile.png` (852 x 1832)

These generated concepts are the implementation reference for the dashboard.
The desktop concept defines the open table-and-rail composition. The mobile
concept defines the equivalent stacked data layout; it is not permission to
remove data that appears in the desktop table.

## Direction and tokens

CodexSpeed should feel like a precise editorial data instrument, not a generic
SaaS dashboard. Use a warm neutral canvas, near-black type, crisp hairline rules,
and electric lime or amber only for data state and selection.

| Token | Intent | Starting value |
| --- | --- | --- |
| `--canvas` | warm neutral page | `#f5f3ed` |
| `--ink` | primary text and rules | `#11110f` |
| `--muted` | secondary text | `#5d5b54` |
| `--rule` | structural borders | `#191916` |
| `--rule-soft` | row dividers | `#aaa79e` |
| `--lime` | measured/selection A | `#c7f33f` |
| `--lime-ink` | accessible green text | `#3f6f10` |
| `--amber` | invalid/selection B | `#ffc342` |
| `--focus` | keyboard focus | `#3457d5` |

The implementation may tune sampled values slightly after screenshot comparison,
but it must not shift the canvas to pure white or introduce gradients, glass,
glow, large shadows, or rounded-card framing.

## Typography

- Headline and major labels: a direct neo-grotesk system sans, heavy weight,
  compact tracking, and deliberate line breaks.
- Metadata, table labels, metrics, and control chrome: a compact system
  monospace with tabular numerals.
- Body copy: system sans for comfortable reading; methodology prose may use the
  same family at a wider measure.
- All buttons, tabs, table headers, mobile rows, and navigation receive explicit
  font size, weight, and line-height. Browser defaults are not acceptable.

## Component and container rules

- Header: wordmark, four essential links, one active underline; no search,
  account controls, badges, or decorative icons.
- Opening: two open columns divided by a vertical rule on desktop; one stacked
  flow on mobile. There is no hero card or eyebrow label.
- Publication facts: one ruled band with equal facts, becoming stacked ruled
  rows on mobile.
- Metric selector: text tabs with a thin active underline. It may scroll on
  mobile but the page itself must not overflow horizontally.
- Matrix: semantic table on desktop, open model sections with effort rows on
  mobile. Use square or nearly square cells, explicit textual state, tabular
  values, and visible A/B plus focus treatments. Never convert it to a bento or
  generic card grid.
- Compare: narrow ruled rail beside the matrix on wide screens and a full-width
  ruled section below it on mobile.
- Reliability and methodology: open lower band separated by rules, not floating
  cards.
- Footer: centered independent-project disclaimer behind a top rule.
- Radii are 0-4px, shadows are absent or nearly imperceptible, and structural
  separation comes from whitespace and rules.

## Interaction and accessibility lock

- Mouse, touch, and keyboard can select up to two comparable cells.
- Focus is always visible and not encoded only with lime or amber.
- Status always has a text label or pattern in addition to color.
- The metric selector, retry action, mobile menu, run links, and methodology
  links have accessible names and real behavior.
- Motion is limited to short underline/fill transitions and is removed under
  `prefers-reduced-motion`.
- Desktop and mobile expose equivalent run, metric, state, comparison,
  reliability, and methodology information.

## Above-the-fold copy lock

Allowed visible copy in the opening viewport is limited to:

- `CodexSpeed`
- `Latest`, `Runs`, `Methodology`, `GitHub`
- `Codex model speed, measured locally.`
- `Independent, reproducible benchmark results uploaded by a verified local runner.`
- live latest-run timestamp, mode, coverage, and validity values
- `Runner Verified` and a concise factual explanation
- the four approved metric names
- `Latest benchmark`

Do not add a pretitle, badge, promotional CTA, unsupported official claim, or
OpenAI brand mark. Dynamic model names, values, sample counts, and stable state
labels are data rather than added marketing copy.

## Verification ledger template

Before handoff, compare both concepts with native-size browser captures and
record at least: copy/order, page composition, typography, palette/rules,
matrix anatomy and states, compare anatomy, focus/selection treatment, and
mobile equivalence. Any fixable drift blocks completion.
