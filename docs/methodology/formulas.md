# Metric formulas

For one valid measured sample:

- `O` is App Server reported output tokens.
- `R` is reported reasoning-output tokens.
- `V = O - R` is estimated visible-output tokens.
- `t_first` is milliseconds from `turn/start` send to the first non-empty
  visible agent-message delta.
- `t_last` is milliseconds to the last visible agent-message delta.
- `t_complete` is milliseconds to the matching completed-turn notification.

The four dashboard metrics are:

```text
first_visible_text_ms = t_first
visible_stream_tps_est = (V - 1) / ((t_last - t_first) / 1000)
visible_e2e_tps = V / (t_complete / 1000)
total_latency_ms = t_complete
```

The displayed selector uses `first_visible_text_ms`,
`visible_stream_tps_est`, `visible_e2e_tps`, and `total_latency_ms`.
`generated_e2e_tps` remains auxiliary evidence in the public API summary so an
auditor can compare reported total output (including reasoning) against visible
output. It is not a fifth dashboard selector.

```text
generated_e2e_tps = O / (t_complete / 1000)
```

Visible stream TPS is unavailable when `V < 2` or `t_last = t_first`; the site
never displays infinity. It is an estimate because App Server emits text chunks,
not one event per token.

These speed metrics use different windows. `visible_stream_tps_est` describes
the cadence after visible output has begun and stops at the last visible chunk;
it excludes first-visible-text latency and the completion tail.
`visible_e2e_tps` divides by the complete turn duration, so it includes startup,
reasoning before visible output, network delay, and the tail before the matching
completion notification. A lower end-to-end value does not imply that visible
text streamed at that lower cadence.

Server code recomputes values from raw durations and token counts. Per selected
model/effort cell, only valid measured samples contribute. The site reports p50,
minimum, maximum, and `n`. p50 is the middle sorted value for odd `n` and the
mean of the two middle values for even `n`. Warm-ups never contribute. There is
no composite score; p95 and p99 are omitted until a future protocol has enough
samples for meaningful tails.
