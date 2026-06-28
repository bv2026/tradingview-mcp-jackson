import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SERVER_PATH = join(ROOT, 'src', 'server.js');
const DOCS = ['README.md', 'AGENTS.md', 'CLAUDE.md'];

const serverSource = readFileSync(SERVER_PATH, 'utf8');
const toolCount = (serverSource.match(/server\.tool\(/g) || []).length;

for (const doc of DOCS) {
  const path = join(ROOT, doc);
  let text = readFileSync(path, 'utf8');
  const updated = text.replace(
    /^(\d+)\s+tools for reading and controlling a live TradingView Desktop chart via CDP \(port 9222\)\./m,
    `${toolCount} tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).`
  );
  if (updated === text) {
    throw new Error(`Did not find tool-count line in ${doc}`);
  }
  text = updated;
  writeFileSync(path, text);
}

process.stdout.write(`Updated tool count to ${toolCount} in ${DOCS.join(', ')}\n`);
