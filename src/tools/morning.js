import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/morning.js";

export function registerMorningTools(server) {
  server.tool(
    "morning_brief",
    "Scan your watchlist, read all indicator values, and return structured data for a session brief. Reads rules.json for your bias criteria and watchlist. Claude applies the rules to generate your daily bias. Use the category parameter to scan a specific watchlist (crypto, stocks, futures) instead of the default flat watchlist.",
    {
      rules_path: z
        .string()
        .optional()
        .describe(
          "Optional path to rules.json. Defaults to rules.json in the project root.",
        ),
      category: z
        .string()
        .optional()
        .describe(
          "Watchlist category to scan: 'crypto', 'stocks', or 'futures'. If omitted, scans the default flat watchlist (core symbols only — faster, avoids timeouts). Use a category to scan all symbols in that group.",
        ),
    },
    async ({ rules_path, category } = {}) => {
      try {
        return jsonResult(await core.runBrief({ rules_path, category }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "session_save",
    "Save today's morning brief to ~/.tradingview-mcp/sessions/YYYY-MM-DD.json for future reference.",
    {
      brief: z
        .string()
        .describe(
          "The brief text to save (output from morning_brief after Claude applies the rules).",
        ),
      date: z
        .string()
        .optional()
        .describe("Date string YYYY-MM-DD. Defaults to today."),
    },
    async ({ brief, date } = {}) => {
      try {
        return jsonResult(core.saveSession({ brief, date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "session_get",
    "Retrieve a saved session brief. Returns today's if available, otherwise yesterday's.",
    {
      date: z
        .string()
        .optional()
        .describe("Date string YYYY-MM-DD. Defaults to today."),
    },
    async ({ date } = {}) => {
      try {
        return jsonResult(core.getSession({ date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
