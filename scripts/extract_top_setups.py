#!/usr/bin/env python3
"""
Extract Top Setups and Watchlist from all daily reports, grouped by week.
Symbols are deduplicated across days within each week per instrument.

Sources:
  - *-signals.json  → equity types (momentum_stocks/etf/ark, sp_ndx, r2k, thematic_stocks/etfs)
  - *.md            → futures, crypto, crypto_perps

Usage:
    python scripts/extract_top_setups.py              # last 7 days
    python scripts/extract_top_setups.py --weeks 4    # last N weeks
    python scripts/extract_top_setups.py --all        # all reports
    python scripts/extract_top_setups.py --output summary.md
    python scripts/extract_top_setups.py --json       # emit JSON instead of markdown
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

REPORTS_ROOT = Path(__file__).parent.parent / "reports"

INSTRUMENT_LABEL = {
    "futures":          "Futures",
    "crypto":           "Crypto",
    "crypto_perps":     "Crypto Perps",
    "momentum_stocks":  "Momentum Stocks",
    "momentum_etf":     "Momentum ETF",
    "momentum_ark":     "ARK",
    "sp_ndx":           "S&P / NDX",
    "r2k":              "Russell 2K",
    "thematic_stocks":  "Thematic Stocks",
    "thematic_etfs":    "Thematic ETFs",
}

INSTRUMENT_ORDER = [
    "futures", "crypto", "crypto_perps",
    "momentum_stocks", "momentum_etf", "momentum_ark",
    "sp_ndx", "r2k", "thematic_stocks", "thematic_etfs",
]

# ── MD parsers (futures / crypto / crypto_perps) ──────────────────────────────

SETUP_RE = re.compile(r"^\*{0,2}(\d)\.\s*\*{0,2}([A-Z0-9_:!.]+)\*{0,2}", re.MULTILINE)
WATCHLIST_RE = re.compile(r"\*{1,2}Watch\s*list[^:]*:\*{0,2}\s*([^\n]+)", re.IGNORECASE)
SHORT_RE = re.compile(r"### Short Candidates.*?\n(.*?)(?=\n###|\n##|\Z)", re.DOTALL | re.IGNORECASE)


def strip_exchange(sym: str) -> str:
    return sym.split(":")[-1] if ":" in sym else sym


def parse_md(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    top_m = re.search(r"### Top \d+ Setups.*?\n(.*?)(?=\n###|\n##|\Z)", text, re.DOTALL)
    top_text = top_m.group(1) if top_m else ""

    top = []
    for m in SETUP_RE.finditer(top_text):
        rank, sym = int(m.group(1)), m.group(2).strip("*").strip()
        if 1 <= rank <= 3:
            top.append(strip_exchange(sym))

    wl_m = WATCHLIST_RE.search(text)
    watch = []
    if wl_m:
        raw = wl_m.group(1).split("(")[0]
        candidates = re.findall(r"\d?[A-Z][A-Z0-9._!]{2,}", raw)
        seen: set[str] = set()
        for s in (strip_exchange(x) for x in candidates):
            if s not in seen:
                seen.add(s)
                watch.append(s)

    shorts = []
    short_m = SHORT_RE.search(text)
    if short_m and not watch:
        shorts = re.findall(r"\b([A-Z][A-Z0-9]{2,})\b", short_m.group(1))[:6]

    return {"top": top, "watch": watch + [f"short:{s}" for s in shorts]}


# ── JSON parsers (equity signal files) ────────────────────────────────────────

def parse_signals_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    top = []
    for bucket in ("ready_to_enter", "ready_confirm_rr", "trend_continuation"):
        for item in data.get(bucket, []):
            sym = item.get("symbol", "")
            if sym and sym not in top:
                top.append(sym)

    watch = []
    for item in data.get("watch", []):
        sym = item.get("symbol", "")
        if sym and sym not in watch:
            watch.append(sym)

    return {"top": top, "watch": watch}


# ── File discovery ────────────────────────────────────────────────────────────

def collect_weeks(weeks_back: int | None) -> dict:
    """Return {week_label: {instrument: {top:[...], watch:[...]}}}"""
    cutoff = datetime.now() - timedelta(weeks=weeks_back) if weeks_back else None

    # week → instrument → accumulated sets (preserving first-seen order via dict keys)
    agg: dict[str, dict[str, dict[str, dict]]] = defaultdict(
        lambda: defaultdict(lambda: {"top": {}, "watch": {}})
    )

    for week_dir in sorted(REPORTS_ROOT.glob("2026-Wk*")):
        week_label = week_dir.name  # e.g. 2026-Wk31

        for day_dir in sorted(week_dir.iterdir()):
            if not day_dir.is_dir():
                continue
            try:
                dt = datetime.strptime(day_dir.name, "%Y-%b-%d")
            except ValueError:
                continue
            if cutoff and dt < cutoff:
                continue

            # MD-based instruments
            for inst in ("futures", "crypto", "crypto_perps"):
                md = day_dir / f"{inst}.md"
                if not md.exists():
                    continue
                parsed = parse_md(md)
                bucket = agg[week_label][inst]
                for s in parsed["top"]:
                    bucket["top"].setdefault(s, 0)
                    bucket["top"][s] += 1
                for s in parsed["watch"]:
                    bucket["watch"].setdefault(s, 0)
                    bucket["watch"][s] += 1

            # JSON-based instruments
            for sig_file in sorted(day_dir.glob("*-signals.json")):
                inst = sig_file.name.replace("-signals.json", "")
                if inst not in INSTRUMENT_LABEL:
                    continue
                parsed = parse_signals_json(sig_file)
                bucket = agg[week_label][inst]
                for s in parsed["top"]:
                    bucket["top"].setdefault(s, 0)
                    bucket["top"][s] += 1
                for s in parsed["watch"]:
                    bucket["watch"].setdefault(s, 0)
                    bucket["watch"][s] += 1

    # Convert to ordered lists (most frequent first, then alpha); watch excludes top symbols
    result = {}
    for week, instruments in sorted(agg.items()):
        result[week] = {}
        for inst in INSTRUMENT_ORDER:
            if inst not in instruments:
                continue
            b = instruments[inst]
            top_syms = sorted(b["top"], key=lambda s: (-b["top"][s], s))
            top_set = set(top_syms)
            watch_syms = sorted(
                (s for s in b["watch"] if s not in top_set),
                key=lambda s: (-b["watch"][s], s),
            )
            result[week][inst] = {"top": top_syms, "watch": watch_syms}

    return result


# ── Output renderers ──────────────────────────────────────────────────────────

def render_markdown(weeks: dict) -> str:
    lines = [f"# Top Setups Summary", f"_Generated {datetime.now():%Y-%m-%d %H:%M}_\n"]

    header = "| Week | Instrument | Top Setups | Watchlist |"
    sep    = "|------|------------|------------|-----------|"

    for week, instruments in weeks.items():
        lines += [f"\n## {week}\n", header, sep]
        for inst, data in instruments.items():
            label = INSTRUMENT_LABEL.get(inst, inst)
            top_str   = ", ".join(data["top"])   or "—"
            watch_str = ", ".join(data["watch"]) or "—"
            lines.append(f"| {week} | {label} | {top_str} | {watch_str} |")

    return "\n".join(lines) + "\n"


def render_json(weeks: dict) -> str:
    return json.dumps(weeks, indent=2)


CATEGORIES = [
    ("futures", "Futures",       ["futures"]),
    ("crypto",  "Crypto",        ["crypto", "crypto_perps"]),
    ("stocks",  "Stocks",        ["momentum_stocks","momentum_ark","sp_ndx","r2k","thematic_stocks"]),
    ("etfs",    "ETFs",          ["momentum_etf","thematic_etfs"]),
]


def _merge_category(week_data: dict, members: list[str]) -> dict:
    top_seen: set[str] = set()
    watch_seen: set[str] = set()
    top: list[str] = []
    watch: list[str] = []
    for m in members:
        d = week_data.get(m)
        if not d:
            continue
        for s in d["top"]:
            if s not in top_seen:
                top_seen.add(s); top.append(s)
        for s in d["watch"]:
            if s not in top_seen and s not in watch_seen:
                watch_seen.add(s); watch.append(s)
    top.sort()
    watch.sort(key=lambda s: s.replace("short:", ""))
    return {"top": top, "watch": watch}


def _sym_tags(syms: list[str], bg: str) -> str:
    if not syms:
        return '<span style="color:#57606a">—</span>'
    parts = []
    for s in syms:
        is_short = s.startswith("short:")
        label = ("SHORT " + s[6:]) if is_short else s
        parts.append(
            f'<span style="font-family:monospace;font-size:11px;padding:2px 5px;'
            f'border-radius:3px;background:{bg};color:#1f2328;white-space:nowrap;'
            f'display:inline-block;margin:1px 2px">{label}</span>'
        )
    return "".join(parts)


def render_html(weeks: dict, generated_at: str) -> str:
    rows_html = ""
    for _key, label, members in CATEGORIES:
        # category header
        rows_html += (
            f'<tr><td colspan="3" style="background:#f6f8fa;color:#1f2328;'
            f'font-size:10px;font-weight:700;letter-spacing:.1em;'
            f'text-transform:uppercase;padding:5px 12px;border-bottom:1px solid #d0d7de;'
            f'border-top:1px solid #d0d7de">{label}</td></tr>\n'
        )
        for week in sorted(weeks.keys()):
            merged = _merge_category(weeks[week], members)
            top_html   = _sym_tags(merged["top"],   "rgba(31,35,40,.06)")
            watch_html = _sym_tags(merged["watch"], "rgba(31,35,40,.03)")
            rows_html += f"""<tr>
  <td style="white-space:nowrap;padding:8px 8px 8px 0;border-bottom:1px solid #d0d7de">
    <div style="display:flex;align-items:center">
      <div style="width:3px;min-height:24px;border-radius:0 2px 2px 0;background:#d0d7de;flex-shrink:0"></div>
      <span style="font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
        color:#1f2328;padding:0 8px 0 7px">{week}</span>
    </div>
  </td>
  <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #d0d7de">{top_html}</td>
  <td style="padding:8px 10px;vertical-align:top;border-bottom:1px solid #d0d7de">{watch_html}</td>
</tr>\n"""

    th_style = ("text-align:left;font-size:9.5px;font-weight:700;letter-spacing:.09em;"
                "text-transform:uppercase;color:#57606a;padding:0 10px 8px 10px;"
                "border-bottom:1px solid #d0d7de")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Top Setups Summary</title>
</head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#ffffff;
    color:#1f2328;font-size:13px;margin:0;padding:20px 16px 48px">
<h1 style="font-size:16px;font-weight:700;margin:0 0 4px;color:#1f2328">Top Setups Summary</h1>
<p style="font-size:11px;color:#57606a;margin:0 0 16px 0">Generated {generated_at} &nbsp;·&nbsp; deduplicated by week</p>
<div style="overflow-x:auto">
<table style="width:100%;border-collapse:collapse;min-width:520px">
  <thead><tr>
    <th style="{th_style};width:110px">Week</th>
    <th style="{th_style}">Top Setups</th>
    <th style="{th_style}">Watchlist</th>
  </tr></thead>
  <tbody>{rows_html}</tbody>
</table>
</div>
</body>
</html>"""


def save_html_report(weeks: dict) -> Path:
    """Overwrite reports/top-setups-summary.html and return the path."""
    now = datetime.now()
    out_path = REPORTS_ROOT / "top-setups-summary.html"
    html = render_html(weeks, now.strftime("%Y-%m-%d %H:%M"))
    out_path.write_text(html, encoding="utf-8")
    return out_path


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--weeks", type=int, default=None, help="Look back N weeks")
    g.add_argument("--all",   action="store_true",   help="All available reports")
    parser.add_argument("--output", help="Write markdown/json to this file")
    parser.add_argument("--json",   action="store_true", help="Emit JSON")
    parser.add_argument("--html",   action="store_true",
                        help="Save HTML report to reports/ and print the path")
    args = parser.parse_args()

    weeks_back = None if args.all else (args.weeks or 2)
    weeks = collect_weeks(weeks_back)

    if not weeks:
        print("No reports found.", file=sys.stderr)
        sys.exit(1)

    if args.html:
        path = save_html_report(weeks)
        print(str(path))
        return

    text = render_json(weeks) if args.json else render_markdown(weeks)

    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"Written to {args.output}")
    else:
        print(text)


if __name__ == "__main__":
    main()
