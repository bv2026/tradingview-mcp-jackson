# Logging + metrics (unattended/full-run only)

This protocol exists because the scheduled task runs unattended in a fresh session with no visible
transcript afterward — the log file is the only record of how far a run got. Apply it in full for
a full 7-type unattended-style run. For a small live re-run of one or two types while talking to
the user, skip this and just tell the user what happened.

Append (never overwrite) one line per event to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/_run-log.txt`,
each line ISO-timestamped:

- Start: `START weekly-decision-routine`, plus `T0=$(date +%s)` in the same Bash call.
- After the scan-file check: which of the requested types were present/missing; `T1=$(date +%s)`,
  `TIMING step1_verify $((T1-T0))s`.
- After reading scan+strategy JSON: `T2=$(date +%s)`, `TIMING step2_read_data $((T2-T1))s`, and
  `TOKENS-APPROX step2_input ~$((BYTES/4)) tokens ($BYTES bytes)` (`BYTES` = combined `wc -c` of
  everything just read — a data-volume proxy, not exact token usage).
- After each `decision-classify.mjs` call: `CLASSIFY <type> ok (N passers, ...)` or the error.
  After the last one: `T4=$(date +%s)`, `TIMING step4_classify $((T4-T2))s`.
- After each `decision-render.mjs` call: `RENDER <type> ok` or the error. After the last one:
  `T5=$(date +%s)`, `TIMING step5_render $((T5-T4))s`, plus the output-side
  `TOKENS-APPROX step5_output` line (bytes of rendered HTML).
- Before the first send: `STEP 6 START — sending N emails`.
- Right after EACH `send_message` call succeeds (not batched at the end):
  `EMAIL <n>/N <type> sent — id <message id>`. Write this immediately, before the next send, so a
  truncated run still shows exactly which emails went out.
- After the last send: `T6=$(date +%s)`, `TIMING step6_email $((T6-T5))s`.
- At the very end: `DONE — N/{requested} emails sent`, `TEND=$(date +%s)`,
  `TIMING total $((TEND-T0))s`.

Use a plain `Write`/append call — do not pipe through `grep`/`sed` for in-place edits to this file
(an rtk/grep shell hook has been observed clobbering it with its own diagnostic output instead of
the intended filtered content — rewrite cleanly via `Write` if you need to fix a bad line).

None of this — timings, byte counts, token estimates — goes in the emails. Local log only.
