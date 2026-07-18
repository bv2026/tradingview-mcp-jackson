# Skill: futures-routine

Runs the full TradingView futures morning brief.
Triggered automatically by the cron job at 10:30 AM EST on weekdays.
Can also be invoked manually with `/futures-routine`.

After the brief is written and session_save completes, the PostToolUse hook
fires automatically and invokes the futures-decision skill → Gmail draft.

---

## Step 1 — Run the futures morning brief

Call `morning_brief instrument_type="futures"`.

The tool returns scan data and an embedded instruction. Follow that instruction
exactly: write the full formatted futures brief, then call `session_save
instrument_type="futures"` with the complete brief text.

Do not wait for the user to confirm before calling session_save — the embedded
instruction already authorizes it.

---

## Done

The session_save call triggers the PostToolUse hook which runs the
futures-decision skill and creates the Gmail draft automatically.
