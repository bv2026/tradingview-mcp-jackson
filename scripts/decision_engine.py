"""
Decision Engine — CT + TV → Trade Decision Email

Combines CannonEdge CT evening brief (snapshot, levels, commentary) with
the TradingView futures morning brief to produce a ranked trade decision email.

Rule: CT direction is always primary. TV NW position is timing only.
CT UP = long candidates. CT DOWN = short candidates. TV never overrides CT.

Usage:
  python scripts/decision_engine.py             # today's date
  python scripts/decision_engine.py 2026-07-17  # specific date
"""

from __future__ import annotations

import re
import sys
import sqlite3
from datetime import date
from pathlib import Path
from typing import Optional

# ── Paths ─────────────────────────────────────────────────────────────────────
CT_DB = Path(r"C:\work\canontrading-scrape\data\cannonedge.db")
TV_REPORTS = Path(__file__).parent.parent / "reports"

# ── Direct TV symbol → CT market_code mapping ────────────────────────────────
# CT uses its own codes (EP, ENQ, CLE…); TV uses bare contract symbols (ES1!, CL1!…).
# None means the symbol exists in TV but has no corresponding CT snapshot market.
TV_TO_CT_MARKET: dict[str, str | None] = {
    "ES1!":  "EP",
    "NQ1!":  "ENQ",
    "YM1!":  None,    # Dow mini — not in CT snapshot
    "RTY1!": None,    # Russell 2000 — not in CT snapshot
    "CL1!":  "CLE",
    "NG1!":  "NGE",
    "BZ1!":  None,    # Brent — not in CT snapshot
    "GC1!":  "GCE",
    "SI1!":  "SIE",
    "HG1!":  "CPE",   # Copper — in CT snapshot; no level data but bias tracked
    "6E1!":  "EU6",
    "6B1!":  None,    # GBP — not in CT snapshot
    "6J1!":  None,    # JPY — not in CT snapshot
    "DX1!":  None,    # DXY — context only, not traded directly
    "ZB1!":  "USA",
    "ZN1!":  None,    # 10yr — not in CT snapshot
    "BTC1!": "BTC",
    "ETH1!": None,    # ETH CME — not in CT snapshot
    "ZC1!":  "ZCE",
    "ZW1!":  "ZWA",
    "ZS1!":  "ZSE",
    "LE1!":  "GLE",
    "HE1!":  "HE",
    "GF1!":  None,    # Feeder Cattle — not in CT snapshot
    "VX1!":  None,    # VIX futures — context only
    "KC1!":  "KCE",
    "SB1!":  "SBE",
    "CC1!":  "CCE",
}

# ── CT market_code → levels instrument (mirrors canontrading-scrape/playbook.py) ──
MARKET_TO_LEVEL_INSTRUMENT: dict[str, str] = {
    "EP":  "ES",
    "ENQ": "NQ",
    "USA": "ZB",
    "BTC": "BRTI",
    "CLE": "CL",
    "GCE": "GC",
    "SIE": "SI",
    "NGE": "NG",
    "KCE": "KC",
    "SBE": "SB",
    "CCE": "CC",
    "CTE": "CT",
    "EU6": "EURO",
    "ZCE": "ZC",
    "ZSE": "ZS",
    "ZWA": "ZW",
}

# ── Date / path helpers ───────────────────────────────────────────────────────

def _week_folder(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-Wk{iso[1]:02d}"


def _date_folder(d: date) -> str:
    return d.strftime("%Y-%b-%d")


def find_tv_brief(d: date) -> Optional[Path]:
    p = TV_REPORTS / _week_folder(d) / _date_folder(d) / "futures.md"
    return p if p.exists() else None


def output_path(d: date) -> Path:
    return TV_REPORTS / _week_folder(d) / _date_folder(d) / "decision.html"


# ── TV brief parser ───────────────────────────────────────────────────────────

def parse_tv_brief(path: Path) -> tuple[dict[str, dict], str, str]:
    """Parse futures.md. Returns (symbol_data, macro_text, theme_text)."""
    text = path.read_text(encoding="utf-8", errors="replace")

    macro_match = re.search(r"\*\*Macro overlays:\*\*(.*?)\*\*Theme:\*\*", text, re.DOTALL)
    macro_text = macro_match.group(1).strip() if macro_match else ""

    theme_match = re.search(r"\*\*Theme:\*\*(.*?)###", text, re.DOTALL)
    theme_text = theme_match.group(1).strip() if theme_match else ""

    symbols: dict[str, dict] = {}
    in_table = False
    for line in text.splitlines():
        if "| SYMBOL |" in line:
            in_table = True
            continue
        if in_table and line.startswith("|---"):
            continue
        if in_table and line.startswith("|"):
            parts = [p.strip() for p in line.split("|")[1:-1]]
            if len(parts) < 4:
                continue
            sym, bias, signal, watch = parts[0], parts[1], parts[2], parts[3]
            if not sym or sym == "SYMBOL":
                continue

            gap_match = re.search(r"TWB gap ([+-]?\d+\.?\d*)", signal)
            twb_gap = float(gap_match.group(1)) if gap_match else None

            if "NW-early" in watch:
                nw = "early"
            elif "NW-extended" in watch or "Already NW-extended" in watch:
                nw = "extended"
            else:
                nw = "inside"

            regime_match = re.search(r"(TRENDING_LONG|TRENDING_SHORT|MEAN_REVERTING)", signal)
            regime = regime_match.group(1) if regime_match else ""

            symbols[sym] = {
                "bias": bias,
                "twb_gap": twb_gap,
                "nw": nw,
                "regime": regime,
                "watch": watch,
            }
        elif in_table and not line.startswith("|"):
            in_table = False

    return symbols, macro_text, theme_text


# ── CT data loader ────────────────────────────────────────────────────────────

def _level_alias(name: str) -> str:
    return {
        "Resistance 1": "R1", "Resistance 2": "R2", "Resistance 3": "R3",
        "Support 1": "S1", "Support 2": "S2", "Support 3": "S3",
    }.get(name, name)


def _ct_bias(short_down: str, short_up: str, long_down: str, long_up: str) -> tuple[str, str]:
    """Returns (bias, st_arrow, lt_arrow). Mirrors playbook._trend logic."""
    short = "UP" if short_up == "UP" else ("DOWN" if short_down == "DOWN" else "")
    long_ = "UP" if long_up == "UP" else ("DOWN" if long_down == "DOWN" else "")
    st = "▲" if short == "UP" else ("▼" if short == "DOWN" else "—")
    lt = "▲" if long_ == "UP" else ("▼" if long_ == "DOWN" else "—")
    if short and short == long_:
        bias = short
    elif long_ == "UP":
        bias = "UP"
    elif long_ == "DOWN":
        bias = "DOWN"
    elif short == "UP":
        bias = "UP"
    elif short == "DOWN":
        bias = "DOWN"
    else:
        bias = "NEUTRAL"
    return bias, st, lt


def load_ct_data(post_date: str) -> dict:
    conn = sqlite3.connect(str(CT_DB))
    conn.row_factory = sqlite3.Row

    snap_rows = conn.execute(
        "SELECT * FROM snapshot_rows WHERE post_date=? ORDER BY row_order",
        (post_date,),
    ).fetchall()

    # Build CT market_code → TV symbol lookup from the static mapping
    mc_to_tv: dict[str, str] = {mc: tv for tv, mc in TV_TO_CT_MARKET.items() if mc is not None}

    def get_levels(mc: str) -> dict[str, float]:
        instrument = MARKET_TO_LEVEL_INSTRUMENT.get(mc)
        if not instrument:
            return {}
        row = conn.execute(
            """SELECT MAX(dlt.levels_date) AS ld FROM daily_level_tables dlt
               JOIN daily_level_rows dlr ON dlr.daily_level_table_id = dlt.id
               WHERE dlt.levels_date <= ? AND dlr.instrument = ?""",
            (post_date, instrument),
        ).fetchone()
        if not row or not row["ld"]:
            return {}
        rows = conn.execute(
            """SELECT dlr.level_name, dlr.value FROM daily_level_tables dlt
               JOIN daily_level_rows dlr ON dlr.daily_level_table_id = dlt.id
               WHERE dlt.levels_date = ? AND dlr.instrument = ?""",
            (row["ld"], instrument),
        ).fetchall()
        return {_level_alias(r["level_name"]): r["value"] for r in rows if r["value"] is not None}

    # pricecount commentary only — other note types are noisy
    commentary: dict[str, str] = {}
    for r in conn.execute(
        """SELECT cin.market_code, cin.body_text
           FROM commentary_instrument_notes cin
           JOIN post_commentary pc ON pc.id = cin.post_commentary_id
           WHERE pc.post_date = ? AND cin.note_type = 'pricecount'
             AND cin.market_code IS NOT NULL""",
        (post_date,),
    ).fetchall():
        commentary[r["market_code"]] = r["body_text"] or ""

    markets: dict[str, dict] = {}
    for r in snap_rows:
        mc = r["market_code"]
        bias, st, lt = _ct_bias(r["short_down"], r["short_up"], r["long_down"], r["long_up"])
        markets[mc] = {
            "description": r["description"] or mc,
            "close": r["close"],
            "chg": r["today_change_pct"],
            "bias": bias,
            "st": st,
            "lt": lt,
            "levels": get_levels(mc),
            "commentary": commentary.get(mc, ""),
        }

    conn.close()
    return {"markets": markets, "mc_to_tv": mc_to_tv}



# ── LLM call ──────────────────────────────────────────────────────────────────

def _load_api_key() -> str | None:
    """Try ANTHROPIC_API_KEY env var, then .env file in repo root."""
    import os
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def call_llm(prompt: str) -> str:
    api_key = _load_api_key()
    if not api_key:
        return (
            "<p style='color:#b00'><strong>LLM output unavailable</strong> — "
            "set ANTHROPIC_API_KEY in your environment or a .env file at the repo root.</p>"
        )
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
    except Exception as exc:
        return f"<p style='color:red'>[LLM error: {exc}]</p>"


# ── Prompt builder ─────────────────────────────────────────────────────────────

def build_prompt(
    post_date: str,
    macro_text: str,
    theme_text: str,
    combined: list[dict],
) -> str:
    lines = [
        f"You are a futures trading decision engine. Date: {post_date}.",
        "",
        "PRIMARY RULE: CannonEdge (CT) direction is always authoritative — it is a proven system.",
        "CT ST/LT arrows determine trade direction. UP = long candidates only. DOWN = short candidates only.",
        "TradingView (TV) data is supplementary timing context only. TV never overrides CT direction.",
        "",
        "## Macro Context (TradingView brief)",
        macro_text,
        "",
        "## Market Theme (TradingView brief)",
        theme_text,
        "",
        "## Combined Market Data",
        "For each market: CT snapshot arrows and levels (authoritative) + TV NW band position and TWB gap (timing).",
        "CT Bias = direction from ST/LT arrows. Pivot/T1/T2 = CannonEdge daily levels.",
        "TV NW = Nadaraya-Watson band position (early=fresh near band, extended=ran past band, inside=between bands).",
        "TV TWB Gap = TradingView TWB Histogram minus Signal (positive=bullish momentum, negative=bearish).",
        "TV Watch = TradingView analyst note for timing.",
        "",
        "| Market | Description | CT Bias | CT ST | CT LT | CT Close | Pivot | T1 | T2 | TV NW | TV TWB Gap | TV Watch |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]

    for d in combined:
        lvl = d["ct_levels"]
        pivot = str(lvl.get("Pivot", "—"))
        t1 = f"R1 {lvl['R1']}" if d["ct_bias"] == "UP" and lvl.get("R1") else \
             (f"S1 {lvl['S1']}" if d["ct_bias"] == "DOWN" and lvl.get("S1") else "—")
        t2 = f"R2 {lvl['R2']}" if d["ct_bias"] == "UP" and lvl.get("R2") else \
             (f"S2 {lvl['S2']}" if d["ct_bias"] == "DOWN" and lvl.get("S2") else "—")
        gap_str = f"{d['tv_gap']:+.2f}" if d["tv_gap"] is not None else "—"
        watch = (d["tv_watch"] or "no TV data")[:120]
        lines.append(
            f"| {d['market']} | {d['description'][:22]} | {d['ct_bias']} | {d['ct_st']} | {d['ct_lt']}"
            f" | {d['close'] or '—'} | {pivot} | {t1} | {t2}"
            f" | {d['tv_nw'] or '—'} | {gap_str} | {watch} |"
        )

    commentary_entries = [(d["market"], d["commentary"]) for d in combined if d["commentary"]]
    if commentary_entries:
        lines += ["", "## CannonEdge Market Commentary"]
        for mc, text in commentary_entries:
            lines.append(f"{mc}: {text[:500]}")

    lines += [
        "",
        "## Your Task",
        "Using CT as the authoritative system and TV as timing context, reason across all markets and produce:",
        "",
        "1. Top Setups (markets to act on today) — for each: direction, entry zone vs CT pivot, stop, T1, T2, R:R estimate, reasoning.",
        "2. Watch List (CT direction is clear but TV timing not ready) — for each: what needs to happen before entry.",
        "3. Overall Read — macro theme, sector alignment, key risk.",
        "",
        "Output as clean HTML with inline styles only (no markdown). Green (#2d7a2d) for longs, red (#c0392b) for shorts.",
        "Use <h3> headings, tables for Top Setups, <ul> for Watch List.",
    ]

    return "\n".join(lines)


# ── HTML email renderer ────────────────────────────────────────────────────────

_S = "font-family:Arial,Helvetica,sans-serif;color:#222;max-width:800px"
_TH = "border:1px solid #ccc;padding:4px 8px;text-align:left;background:#f5f5f5"
_TD = "border:1px solid #ccc;padding:4px 8px"
_TDR = "border:1px solid #ccc;padding:4px 8px;text-align:right"
_TDC = "border:1px solid #ccc;padding:4px 8px;text-align:center"
_TABLE = "border-collapse:collapse;width:100%;margin:8px 0;font-size:13px"
_H2 = "margin:16px 0 6px"
_H3 = "margin:12px 0 6px"


def _arrow_span(arrow: str) -> str:
    color = "green" if arrow == "▲" else ("#c0392b" if arrow == "▼" else "#888")
    return f'<span style="color:{color}">{arrow}</span>'


def _dec_badge(dec: str) -> str:
    color = {"ENTER": "#2d7a2d", "WAIT": "#b8860b", "SKIP": "#888", "NO_TV": "#aaa"}.get(dec, "#888")
    return f'<strong style="color:{color}">{dec}</strong>'


def render_email(post_date: str, combined: list[dict], llm_output: str) -> str:
    parts: list[str] = [f'<div style="{_S}">']
    parts.append(f'<h1 style="margin:16px 0 6px">Decision Brief — {post_date}</h1>')
    parts.append(f'<p style="margin:6px 0;font-size:12px;color:#666">CT primary · TV timing</p>')

    # LLM-generated trade decisions
    parts.append(f'<h2 style="{_H2}">Trade Decisions</h2>')
    parts.append(llm_output)

    # Combined data table — raw inputs, no pre-classification
    parts.append(f'<h2 style="{_H2}">Combined Data</h2>')
    parts.append(f'<table style="{_TABLE}"><thead><tr>')
    for col in ("Market", "CT Bias", "ST", "LT", "Close", "Pivot", "T1", "TV NW", "TV Gap", "TV Watch"):
        parts.append(f'<th style="{_TH}">{col}</th>')
    parts.append("</tr></thead><tbody>")
    for d in combined:
        lvl = d["ct_levels"]
        pivot = str(lvl.get("Pivot", "—"))
        t1 = f"R1 {lvl['R1']}" if d["ct_bias"] == "UP" and lvl.get("R1") else \
             (f"S1 {lvl['S1']}" if d["ct_bias"] == "DOWN" and lvl.get("S1") else "—")
        gap_str = f"{d['tv_gap']:+.2f}" if d["tv_gap"] is not None else "—"
        watch = (d["tv_watch"] or "")[:80]
        parts.append(
            f"<tr>"
            f'<td style="{_TD}">{d["market"]}</td>'
            f'<td style="{_TD}">{d["ct_bias"]}</td>'
            f'<td style="{_TDC}">{_arrow_span(d["ct_st"])}</td>'
            f'<td style="{_TDC}">{_arrow_span(d["ct_lt"])}</td>'
            f'<td style="{_TDR}">{d["close"] or "—"}</td>'
            f'<td style="{_TDR}">{pivot}</td>'
            f'<td style="{_TD}">{t1}</td>'
            f'<td style="{_TD}">{d["tv_nw"] or "—"}</td>'
            f'<td style="{_TDR}">{gap_str}</td>'
            f'<td style="{_TD};font-size:11px">{watch}</td>'
            f"</tr>"
        )
    parts.append("</tbody></table>")

    # CT Snapshot (mirrors existing email format)
    parts.append(f'<h2 style="{_H2}">CT Snapshot</h2>')
    parts.append(f'<table style="{_TABLE}"><thead><tr>')
    for col in ("Market", "Description", "Close", "Chg%", "ST", "LT"):
        parts.append(f'<th style="{_TH}">{col}</th>')
    parts.append("</tr></thead><tbody>")
    for d in combined:
        chg = f"{d['chg']:+.2f}%" if d["chg"] is not None else "—"
        parts.append(
            f"<tr>"
            f'<td style="{_TD}">{d["market"]}</td>'
            f'<td style="{_TD}">{d["description"]}</td>'
            f'<td style="{_TDR}">{d["close"] or "—"}</td>'
            f'<td style="{_TDR}">{chg}</td>'
            f'<td style="{_TDC}">{_arrow_span(d["ct_st"])}</td>'
            f'<td style="{_TDC}">{_arrow_span(d["ct_lt"])}</td>'
            f"</tr>"
        )
    parts.append("</tbody></table>")

    parts.append('<hr style="margin:16px 0;border:none;border-top:1px solid #ccc">')
    parts.append(
        f'<p style="margin:6px 0;font-size:12px;color:#666">'
        f"<em>Decision Brief for {post_date} — CannonEdge CT (primary) + TradingView TV (timing).</em>"
        f"</p>"
    )
    parts.append("</div>")
    return "".join(parts)


# ── Main ───────────────────────────────────────────────────────────────────────

def main(post_date_str: str | None = None) -> None:
    if post_date_str is None:
        post_date_str = date.today().isoformat()

    d = date.fromisoformat(post_date_str)

    tv_path = find_tv_brief(d)
    if tv_path is None:
        print(f"ERROR: No TV futures brief found for {post_date_str}")
        print(f"  Expected: {TV_REPORTS / _week_folder(d) / _date_folder(d) / 'futures.md'}")
        sys.exit(1)

    print(f"TV brief:  {tv_path}")

    tv_symbols, macro_text, theme_text = parse_tv_brief(tv_path)
    print(f"TV symbols parsed: {len(tv_symbols)}")

    ct_data = load_ct_data(post_date_str)
    markets = ct_data["markets"]
    mc_to_tv = ct_data["mc_to_tv"]
    print(f"CT markets loaded: {len(markets)}")

    # Combine CT + TV per market — raw data only, LLM decides
    combined: list[dict] = []
    for mc, m in markets.items():
        tv_sym = mc_to_tv.get(mc)
        tv = tv_symbols.get(tv_sym, {}) if tv_sym else {}
        combined.append({
            "market": mc,
            "description": m["description"],
            "ct_bias": m["bias"],
            "ct_st": m["st"],
            "ct_lt": m["lt"],
            "close": m["close"],
            "chg": m["chg"],
            "ct_levels": m["levels"],
            "commentary": m["commentary"],
            "tv_sym": tv_sym,
            "tv_nw": tv.get("nw"),
            "tv_gap": tv.get("twb_gap"),
            "tv_watch": tv.get("watch", ""),
        })
    print(f"Combined rows: {len(combined)} ({sum(1 for r in combined if r['tv_sym'])} with TV data)")

    prompt = build_prompt(post_date_str, macro_text, theme_text, combined)

    # Save prompt so user can run it manually when no API key is available
    prompt_path = output_path(d).with_name("decision_prompt.txt")
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text(prompt, encoding="utf-8")
    print(f"Prompt saved: {prompt_path}")

    print("Calling LLM...")
    llm_output = call_llm(prompt)

    html = render_email(post_date_str, combined, llm_output)

    out = output_path(d)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"Written: {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
