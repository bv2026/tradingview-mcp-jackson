import { register } from "../router.js";
import * as core from "../../core/morning.js";

register("brief", {
  description:
    "Run your morning brief — scan watchlist, read indicators, apply your rules",
  options: {
    rules: {
      type: "string",
      short: "r",
      description: "Path to rules.json (default: ./rules.json)",
    },
    type: {
      type: "string",
      short: "t",
      description:
        "Instrument type: stocks | etf | ark | crypto | crypto_perps | futures | all (default: stocks)",
    },
  },
  handler: async ({ rules, type }) =>
    core.runBrief({ rules_path: rules, instrument_type: type }),
});

register("session", {
  description: "Get or save a session brief",
  subcommands: new Map([
    [
      "get",
      {
        description:
          "Get today's saved session brief (or yesterday's if today not found)",
        options: {
          date: {
            type: "string",
            description: "Date YYYY-MM-DD (default: today)",
          },
        },
        handler: async ({ date }) => core.getSession({ date }),
      },
    ],
    [
      "save",
      {
        description: "Save a session brief to disk",
        options: {
          brief: {
            type: "string",
            short: "b",
            description: "Brief text to save (or use --file)",
          },
          file: {
            type: "string",
            short: "f",
            description: "Path to a file containing the brief text (avoids shell escaping)",
          },
          type: {
            type: "string",
            short: "t",
            description:
              "Instrument type: stocks | etf | ark | crypto | crypto_perps | futures | daily_summary (default: stocks)",
          },
          summary: {
            type: "boolean",
            description: "Save as a 4-line summary to {type}-summary.md",
          },
          date: {
            type: "string",
            description: "Date YYYY-MM-DD (default: today)",
          },
        },
        handler: async ({ brief, file, type, summary, date }) => {
          let text = brief;
          if (file) {
            const { readFileSync } = await import("node:fs");
            text = readFileSync(file, "utf8");
          }
          if (!text) throw new Error("--brief or --file is required");
          return core.saveSession({
            brief: text,
            instrument_type: type,
            is_summary: summary,
            date,
          });
        },
      },
    ],
  ]),
});
