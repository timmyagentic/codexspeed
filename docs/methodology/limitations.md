# Interpretation and limitations

CodexSpeed measures one public synthetic task, machine, network path, account
channel, service tier, catalog snapshot, and time window. It does not measure
answer quality and must not be read as a universal model ranking.

## Sample validity

A measured sample is valid only when it completes on the requested model,
produces exactly one final agent message, emits no command/file/MCP/web/tool
event, has ordered visible timings, has a matching final token-usage snapshot,
contains at least 400 estimated visible tokens, and passes the fixed structural
validator. Stable failure reasons include failed turn, timeout, protocol error,
reroute, tool event, message count, missing timings, missing token usage, token
invariant, too short, and validator failure.

All invalid attempts remain in the immutable run. They count toward reliability
but not speed distributions. The MVP does not retry automatically; another
attempt requires a new explicit invocation and artifact.

## Measurement boundaries

- Visible-token count is `outputTokens - reasoningOutputTokens`; it is an
  estimate based on App Server accounting.
- Visible stream TPS uses first and last text chunks, so chunking and transport
  cadence affect it. It is explicitly labeled estimated. It excludes the wait
  for first visible text and the completion tail; visible E2E TPS includes both.
- Sequential execution prevents local trial competition but cannot remove
  remote load, routing, network, thermal, or account-state variability.
- Ultra reasoning is excluded because its subagent behavior is not a comparable
  single-agent reasoning-effort setting. Optional fast tiers are excluded from
  the default service-tier comparison.
- Smoke runs prove a narrow integration path. A series run covers every
  comparable cell only within its exact requested model family. Only a full run
  covers every discovered comparable cell. Series and full runs both use one
  warm-up per model and three measured rounds.
- The ordinary guided test measures one selected model/effort cell with one
  warm-up and, by default, three measured rounds. It characterizes that device,
  network, account path, and test window; it is not a catalog-wide ranking.
- Runner Verified proves only the configured publisher-key signature. It is not
  quality certification or OpenAI endorsement.

Published artifacts intentionally omit prompt/response/reasoning text, local
paths, account identifiers, credentials, arbitrary environment maps, raw App
Server transcripts, and free-form exception text. This privacy boundary also
means a visitor cannot reconstruct every transport-level event from the public
artifact.

Local result JSON uses the same strict artifact shape, but remains on the
runner's device unless the user moves it elsewhere. Opening it on the local-test
page uses the browser's file API and does not upload the chosen contents. Only
the maintainer's separate signed `publish` command can create a public run.
