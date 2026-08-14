"""
CT + TV data fetcher — prints combined market data as JSON to stdout.

Used by the futures-decision skill. Reads:
  - CannonEdge CT DB (snapshot, levels, pricecount commentary)
  - TradingView futures.md for today's date (or date passed as arg)

Usage:
  python scripts/ct_tv_data.py             # today
  python scripts/ct_tv_data.py 2026-07-17  # specific date
"""

from __future__ import annotations

import json
import re
import sys
import sqlite3
from datetime import date
from pathlib import Path

CT_DB = Path(r"C:\work\canontrading-scrape\data\cannonedge.db")
TV_REPORTS = Path(__file__).parent.parent / "reports"

_shared_map = json.loads((Path(__file__).parent.parent / "config" / "cannon-futures-map.json").read_text(encoding="utf-8"))
TV_TO_CT_MARKET: dict[str, str | None] = {symbol.split(":")[-1]: market for symbol, market in _shared_map.items()}

MARKET_TO_LEVEL_INSTRUMENT: dict[str, str] = {
    "EP": "ES", "ENQ": "NQ", "USA": "ZB", "BTC": "BRTI",
    "CLE": "CL", "GCE": "GC", "SIE": "SI", "NGE": "NG",
    "KCE": "KC", "SBE": "SB", "CCE": "CC", "CTE": "CT",
    "EU6": "EURO", "ZCE": "ZC", "ZSE": "ZS", "ZWA": "ZW",
}


def _week_folder(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-Wk{iso[1]:02d}"


def _date_folder(d: date) -> str:
    return d.strftime("%Y-%b-%d")


def _level_alias(name: str) -> str:
    return {
        "Resistance 1": "R1", "Resistance 2": "R2", "Resistance 3": "R3",
        "Support 1": "S1", "Support 2": "S2", "Support 3": "S3",
    }.get(name, name)


def _ct_bias(short_down, short_up, long_down, long_up):
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


def parse_tv_brief(path: Path) -> tuple[dict, str, str]:
    text = path.read_text(encoding="utf-8", errors="replace")

    macro_match = re.search(r"\*\*Macro overlays:\*\*(.*?)\*\*Theme:\*\*", text, re.DOTALL)
    macro_text = macro_match.group(1).strip() if macro_match else ""

    theme_match = re.search(r"\*\*Theme:\*\*(.*?)###", text, re.DOTALL)
    theme_text = theme_match.group(1).strip() if theme_match else ""

    symbols: dict[str, dict] = {}
    in_table = False
    col_offset = 0  # 1 if table has a leading # column
    col_idx: dict[str, int] = {}
    for line in text.splitlines():
        if "| SYMBOL |" in line:
            in_table = True
            header_parts = [p.strip() for p in line.split("|")[1:-1]]
            col_idx = {name: i for i, name in enumerate(header_parts)}
            continue
        if in_table and line.startswith("|---"):
            continue
        if in_table and line.startswith("|"):
            parts = [p.strip() for p in line.split("|")[1:-1]]
            si = col_idx.get("SYMBOL", col_idx.get("#", -1))
            # If header had #, SYMBOL is next column
            if "SYMBOL" not in col_idx and "#" in col_idx:
                si = col_idx["#"] + 1
            if si < 0 or si >= len(parts):
                continue
            raw_sym = parts[si]
            # Strip exchange prefix (new format: "CME_MINI:ES1!" → "ES1!")
            sym = raw_sym.split(":")[-1] if ":" in raw_sym else raw_sym
            bias   = parts[col_idx["BIAS"]]   if "BIAS"   in col_idx and col_idx["BIAS"]   < len(parts) else ""
            signal = parts[col_idx["SIGNAL"]] if "SIGNAL" in col_idx and col_idx["SIGNAL"] < len(parts) else ""
            watch  = parts[col_idx["WATCH"]]  if "WATCH"  in col_idx and col_idx["WATCH"]  < len(parts) else ""
            if not sym or sym == "SYMBOL" or sym == "#":
                continue
            # Try explicit "gap X" first (old compact format)
            gap_match = re.search(r"(?:TWB )?gap ([+-]?\d[\d,]*\.?\d*)", signal)
            if gap_match:
                twb_gap = float(gap_match.group(1).replace(",", ""))
            else:
                # Old format: "TWB hist/sig" e.g. "TWB -29.06/-35"
                twb_match = re.search(r"TWB ([+-]?[\d,]+\.?\d*)/([+-]?[\d,]+\.?\d*)", signal)
                # New format: "Hist +174.83 ... sig 293.58" or "Hist -326.5 ... sig -496.2"
                hist_sig_match = re.search(r"Hist\s+([+-]?[\d,]+\.?\d*)[^|]*?sig\s+([+-]?[\d,]+\.?\d*)", signal, re.IGNORECASE) if not twb_match else None
                m = twb_match or hist_sig_match
                if m:
                    try:
                        hist = float(m.group(1).replace(",", ""))
                        sig  = float(m.group(2).replace(",", ""))
                        twb_gap = round(hist - sig, 4)
                    except ValueError:
                        twb_gap = None
                else:
                    twb_gap = None

            # Fallback: SIGNAL cell has no literal numbers (qualitative-only phrasing,
            # e.g. "hist+ but decelerating hard, NW extended"). Recover a sign-only
            # approximation rather than losing the symbol entirely — see
            # ct-tv-data-format-dependency memory note. Real numbers are still required
            # by CLAUDE.md's futures formatting convention; this is a graceful-degrade path.
            twb_gap_approx = False
            if twb_gap is None:
                # Priority: explicit sig comparison > BIAS text (the brief's own gap-aware
                # classification — may carry a "(gap)" tag that CONTRADICTS raw hist sign,
                # e.g. "bearish (gap)" while SIGNAL still reads "hist+ decelerating") >
                # raw hist sign as the weakest last resort.
                bias_lower = bias.lower()
                if re.search(r"above\s+sig(?:nal)?\b", signal, re.IGNORECASE):
                    twb_gap, twb_gap_approx = 0.01, True
                elif re.search(r"below\s+sig(?:nal)?\b", signal, re.IGNORECASE):
                    twb_gap, twb_gap_approx = -0.01, True
                elif "bullish" in bias_lower:
                    twb_gap, twb_gap_approx = 0.01, True
                elif "bearish" in bias_lower:
                    twb_gap, twb_gap_approx = -0.01, True
                else:
                    hist_sign_match = re.search(r"hist\s*([+−-])", signal, re.IGNORECASE)
                    if hist_sign_match:
                        twb_gap = 0.01 if hist_sign_match.group(1) == "+" else -0.01
                        twb_gap_approx = True
            # NW parsing — handle both old hyphenated and new space-separated forms
            combined = (watch + " " + signal).lower()
            if "nw-early" in combined or "nw early" in combined:
                nw = "early"
            elif "nw-extended" in combined or "nw extended" in combined or "already nw-extended" in combined:
                nw = "extended"
            elif twb_gap is not None:
                nw = "inside"  # futures brief doesn't surface NW explicitly; default to inside
            else:
                nw = None
            # Regime — old format had explicit tags; new format: derive from bias/signal text
            regime_match = re.search(r"(TRENDING_LONG|TRENDING_SHORT|MEAN_REVERTING)", signal)
            if regime_match:
                regime = regime_match.group(1)
            else:
                bias_lower = bias.lower()
                if "bullish" in bias_lower or ("long" in bias_lower and "disagrees" not in bias_lower):
                    regime = "TRENDING_LONG"
                elif "bearish" in bias_lower or ("short" in bias_lower and "disagrees" not in bias_lower):
                    regime = "TRENDING_SHORT"
                else:
                    regime = "MEAN_REVERTING"
            symbols[sym] = {
                "bias": bias,
                "twb_gap": twb_gap,
                "twb_gap_approx": twb_gap_approx,
                "nw": nw,
                "regime": regime,
                "watch": watch,
            }
        elif in_table and not line.startswith("|"):
            in_table = False

    return symbols, macro_text, theme_text


def load_ct_data(post_date: str) -> dict:
    conn = sqlite3.connect(str(CT_DB))
    conn.row_factory = sqlite3.Row

    snap_rows = conn.execute(
        "SELECT * FROM snapshot_rows WHERE post_date=? ORDER BY row_order",
        (post_date,),
    ).fetchall()

    # Fall back to most recent available CT date if today has no data (e.g. weekend)
    if not snap_rows:
        row = conn.execute(
            "SELECT MAX(post_date) AS ld FROM snapshot_rows WHERE post_date <= ?",
            (post_date,),
        ).fetchone()
        if row and row["ld"]:
            post_date = row["ld"]
            snap_rows = conn.execute(
                "SELECT * FROM snapshot_rows WHERE post_date=? ORDER BY row_order",
                (post_date,),
            ).fetchall()

    mc_to_tv = {mc: tv for tv, mc in TV_TO_CT_MARKET.items() if mc is not None}

    def get_levels(mc: str) -> dict:
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

    markets = {}
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


def main(post_date_str: str | None = None) -> None:
    if post_date_str is None:
        post_date_str = date.today().isoformat()

    d = date.fromisoformat(post_date_str)
    tv_path = TV_REPORTS / _week_folder(d) / _date_folder(d) / "futures.md"

    if not tv_path.exists():
        print(json.dumps({"error": f"futures.md not found: {tv_path}"}))
        sys.exit(1)

    tv_symbols, macro_text, theme_text = parse_tv_brief(tv_path)
    ct = load_ct_data(post_date_str)
    markets = ct["markets"]
    mc_to_tv = ct["mc_to_tv"]

    combined = []
    for mc, m in markets.items():
        tv_sym = mc_to_tv.get(mc)
        tv = tv_symbols.get(tv_sym, {}) if tv_sym else {}
        lvl = m["levels"]
        combined.append({
            "market": mc,
            "tv_symbol": tv_sym,
            "description": m["description"],
            "ct_bias": m["bias"],
            "ct_st": m["st"],
            "ct_lt": m["lt"],
            "close": m["close"],
            "chg": m["chg"],
            "pivot": lvl.get("Pivot"),
            "r1": lvl.get("R1"),
            "r2": lvl.get("R2"),
            "s1": lvl.get("S1"),
            "s2": lvl.get("S2"),
            "commentary": m["commentary"],
            "tv_nw": tv.get("nw"),
            "tv_gap": tv.get("twb_gap"),
            "tv_gap_approx": tv.get("twb_gap_approx", False),
            "tv_bias": tv.get("bias", ""),
            "tv_regime": tv.get("regime", ""),
            "tv_watch": tv.get("watch", ""),
        })

    # Validation gate — fail loudly if TV data parsing is broken.
    # Cotton (CTE) has no TV mapping so is excluded from the check.
    tv_mapped = [m for m in combined if m["tv_symbol"] is not None]
    null_gap_count = sum(1 for m in tv_mapped if m["tv_gap"] is None)
    approx_gap_count = sum(1 for m in tv_mapped if m["tv_gap_approx"])
    if tv_mapped and null_gap_count / len(tv_mapped) > 0.5:
        sys.stderr.write(
            f"ERROR: CT/TV data pipeline failure — {null_gap_count}/{len(tv_mapped)} TV-mapped markets "
            f"have null tv_gap. futures.md format may have changed and parse_tv_brief() needs updating.\n"
            f"Do NOT save this output. Fix ct_tv_data.py before proceeding.\n"
        )
        sys.exit(2)

    sys.stdout.buffer.write(json.dumps({
        "date": post_date_str,
        "macro": macro_text,
        "theme": theme_text,
        "markets": combined,
        "_validation": {
            "tv_mapped_count": len(tv_mapped),
            "null_gap_count": null_gap_count,
            "approx_gap_count": approx_gap_count,
            "tv_symbols_parsed": len(tv_symbols),
        },
    }, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.write(b"\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
