"""
PostToolUse hook — fires after mcp__tradingview__session_save.

Checks if instrument_type is "futures". If so, outputs a directive
that tells Claude to invoke the futures-decision skill.

Hook receives tool info as JSON on stdin.
"""

import json
import sys


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool = data.get("tool_name", "")
    if "session_save" not in tool:
        sys.exit(0)

    inp = data.get("tool_input", {})
    instrument_type = inp.get("instrument_type", "")
    if instrument_type != "futures":
        sys.exit(0)

    # Output a directive Claude will act on
    print(
        "\n[futures-decision-hook] The futures brief was just saved. "
        "Invoke the /futures-decision skill now to generate today's trade decision email."
    )


if __name__ == "__main__":
    main()
