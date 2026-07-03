import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOOLS_DIR = join(ROOT, 'src', 'tools');
const DOCS = ['README.md', 'AGENTS.md', 'CLAUDE.md'];

// Tools are registered inside src/tools/*.js (via register*Tools(server) calls
// from server.js), not in server.js itself — count across the whole directory.
const toolFiles = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.js'));
const toolCount = toolFiles.reduce((sum, f) => {
  const source = readFileSync(join(TOOLS_DIR, f), 'utf8');
  return sum + (source.match(/\bserver\.tool\(/g) || []).length;
}, 0);

// Each doc mentions the tool count in its own wording — try every known
// pattern per doc and require at least one match.
const PATTERNS = [
  { re: /^(\d+)\s+tools for reading and controlling a live TradingView Desktop chart via CDP \(port 9222\)\./m,
    replace: (n) => `${n} tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).` },
  { re: /## Tool Reference \(\d+ MCP tools\)/,
    replace: (n) => `## Tool Reference (${n} MCP tools)` },
  { re: /\*\*\d+ MCP tools\*\* total/,
    replace: (n) => `**${n} MCP tools** total` },
];

for (const doc of DOCS) {
  const path = join(ROOT, doc);
  let text = readFileSync(path, 'utf8');
  let matched = false;
  for (const { re, replace } of PATTERNS) {
    if (re.test(text)) {
      text = text.replace(re, replace(toolCount));
      matched = true;
    }
  }
  if (!matched) {
    throw new Error(`Did not find any tool-count pattern in ${doc}`);
  }
  writeFileSync(path, text);
}

process.stdout.write(`Updated tool count to ${toolCount} in ${DOCS.join(', ')}\n`);
