# Wunder DCA Bot v.1.1 — Saved Settings
*Last captured: 2026-06-03 | Performance: +22.6%, PF 1.69, DD 12.2%*

---

## HOW TO RESTORE
1. Add "Wunder DCA Bot v.1.1" to your chart
2. Open Settings (gear icon)
3. Enter values from each section below exactly
4. Click OK

---

## SOLUSDT · 15m · Coinbase
**Result: +$226 (+22.6%) | PF 1.69 | DD 12.2% | Sharpe 0.53**

### Backtest Date Range
| Field | Value |
|---|---|
| Start | 2025-04-01 17:00 |
| Finish | 2026-06-01 16:59 |

### Risk & Money Management
| Field | Value |
|---|---|
| Capital $ | 1000 |

### Strategy Settings
| Field | Value |
|---|---|
| Use TP | ☐ OFF |
| Take Profit (%) | 3 (inactive) |
| Use SL | ☑ ON |
| Stop Loss (%) | **4** |
| Use TS | ☑ ON |
| Trailing Stop Activation (%) | **1.1** |
| Trailing Stop Execution (%) | **0.3** |
| Use MSL | ☐ OFF |

### DCA Settings
| Field | Value |
|---|---|
| Max DCA orders | **2** |
| Price deviation | **2** ← CRITICAL |
| Order size multiplier | 1 |
| Price dev. multiplier | 1 |
| DCA TP anchor | average_price |
| DCA SL anchor | entry_order |

### Core Settings
| Field | Value |
|---|---|
| Trade direction | **BOTH** |
| Entry condition type | **Price Change** |

### Trend Filter
| Field | Value |
|---|---|
| Filter indicator type | **STD+Percentile** |
| STD+Percentile filter type | **Smart Adaptive Threshold** |
| Market condition | Active market |

### STD+Percentile SAT Parameters
| Field | Value |
|---|---|
| SAT: Baseline SMA length (Lμ) | **60** |
| SAT: Width SMA length (Lw) | **60** ← keep 60, NOT 50 |
| SAT: Corridor width multiplier (k) | **2** |
| SAT: Active zone floor (u_min) | **0.8** ← keep 0.8, NOT 0.75 |
| SAT: Active zone ceiling (u_max) | **0.9** |
| SAT: Calm zone floor | 0.1 |
| SAT: Calm zone ceiling | 0.4 |
| SAT: Enable hysteresis | ☑ ON |
| SAT: Hysteresis margin (h) | **0.2** |

### Exit Settings
| Field | Value |
|---|---|
| Exit method | indicator or TP (First) |
| Exit indicator type | RSI |
| RSI exit type | Overbought/Oversold |
| RSI period | 14 |
| RSI lower limit | 20 |
| RSI upper limit | 80 |

### Entry Condition — Price Change
| Field | Value |
|---|---|
| Price Change Period | **1** |
| Price Cap (%) | **1.1** |
| Use RSI filter | ☐ OFF |

---

## BTCUSDT · 15m · Binance
**Result: +$247 (+24.7%) | PF 2.35 | DD 8.6% | Sharpe 0.78**
*Alert ID: 4849014991 | WT Bot: BTCUSDT-15M-WTBOT*

### Strategy Settings
| Field | Value |
|---|---|
| Use TP | ☐ OFF |
| Stop Loss (%) | **4** |
| TS Activation (%) | **1.2** |
| TS Execution (%) | **0.5** |

### DCA Settings
| Field | Value |
|---|---|
| Max DCA orders | **2** |
| Price deviation | **1.5** |
| Order size multiplier | **1.5** |
| Price dev. multiplier | **1.2** |

### Core Settings
| Field | Value |
|---|---|
| Trade direction | **SHORT** |
| Entry condition type | Price Change |
| Filter | STD+Percentile |

### Entry Condition — Price Change
| Field | Value |
|---|---|
| Price Change Period | **3** |
| Price Cap (%) | **1.5** |

---

## Raw Input Index Map (for automation restore)
*These are the filtered text input indices used for programmatic restore*

### SOL settings (entity wMmGrl)
```
i=4:  Capital = 1000
i=5:  TP% = 3 (inactive)
i=6:  SL% = 4
i=10: TS Activation = 1.1
i=11: TS Execution = 0.3
i=13: Max DCA = 2
i=14: Price deviation = 2  ← CRITICAL
i=15: OS mult = 1
i=16: PD mult = 1
i=26: SAT Baseline Lμ = 60
i=27: SAT Width Lw = 60
i=28: SAT Corridor k = 2
i=29: SAT Active floor = 0.8
i=30: SAT Active ceiling = 0.9
i=31: SAT Calm floor = 0.1
i=32: SAT Calm ceiling = 0.4
i=33: SAT Hysteresis = 0.2
i=36: Price Change Period = 1 (actually stored as 2 internally)
i=49: Price Cap = 1.1
```

### BTC settings (entity 7B1y0g, in_ Pine indices)
```
in_12: TP% = 1.5 (inactive)
in_13: SL% = 4
in_18: TS Execution = 0.5
in_19: Max DCA = 2
in_20: Price deviation = 1.5
in_21: OS mult = 1.5
in_22: PD mult = 1.2
in_25: Direction = SHORT
in_27: Filter = STD+Percentile
```

---

## WT Alert JSON — BTCUSDT
```json
{
  "code": "TV-STRATEGY_Binance_BTCUSDT_BTCUSDT-15M-WTBOT_15M_9b4e26294333def6dd0fa9e0",
  "alertPrice": "{{close}}",
  "alertTime": "{{timenow}}",
  "recvWindow": "60000",
  "action": "{{strategy.order.action}}",
  "pos": "{{strategy.market_position}}",
  "posSize": "{{strategy.market_position_size}}",
  "prevPos": "{{strategy.prev_market_position}}",
  "prevPosSize": "{{strategy.prev_market_position_size}}",
  "amount": "{{strategy.order.contracts}}",
  "amountIn": "base",
  "tvTicker": "{{ticker}}",
  "tvExchange": "{{exchange}}"
}
```
*Webhook URL: https://wtalerts.com/bot/trading_view_strategy*
