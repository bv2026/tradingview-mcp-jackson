#!/usr/bin/env node
/**
 * Archives report week-folders older than RETENTION_WEEKS.
 * Zips each old reports/YYYY-WkNN/ folder (via PowerShell Compress-Archive)
 * and moves the .zip into reports/archive/, then deletes the original folder.
 *
 * Run manually: node scripts/archive-old-reports.mjs
 * Run without side effects: node scripts/archive-old-reports.mjs --dry-run
 */
import { readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RETENTION_WEEKS = 8;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(PROJECT_ROOT, 'reports');
const ARCHIVE_DIR = join(REPORTS_DIR, 'archive');

const WEEK_FOLDER_RE = /^(\d{4})-Wk(\d{2})$/;
const DRY_RUN = process.argv.includes('--dry-run');

function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return { isoYear, weekNum };
}

// Absolute ordinal for a (year, week) pair so we can subtract retention weeks
// without worrying about 52 vs 53-week years.
function weekOrdinal(isoYear, weekNum) {
  return isoYear * 53 + weekNum;
}

const today = new Date();
const { isoYear: curYear, weekNum: curWeek } = isoWeekInfo(today);
const cutoffOrdinal = weekOrdinal(curYear, curWeek) - RETENTION_WEEKS;

if (!existsSync(REPORTS_DIR)) {
  console.error(`No reports directory found at ${REPORTS_DIR}`);
  process.exit(1);
}

const entries = readdirSync(REPORTS_DIR, { withFileTypes: true });
let archived = 0, kept = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const match = entry.name.match(WEEK_FOLDER_RE);
  if (!match) continue; // skip "weekly", "archive", anything non-week-shaped

  const weekYear = Number(match[1]);
  const weekNum = Number(match[2]);
  const ordinal = weekOrdinal(weekYear, weekNum);

  if (ordinal >= cutoffOrdinal) {
    kept++;
    continue;
  }

  const srcDir = join(REPORTS_DIR, entry.name);
  const zipPath = join(ARCHIVE_DIR, `${entry.name}.zip`);

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Archiving ${entry.name} -> archive/${entry.name}.zip`);

  if (DRY_RUN) {
    archived++;
    continue;
  }

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ]);

  if (!existsSync(zipPath)) {
    console.error(`  FAILED to create ${zipPath} — leaving ${entry.name} in place`);
    continue;
  }

  rmSync(srcDir, { recursive: true, force: true });
  console.log(`  done`);
  archived++;
}

console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Archived ${archived} week folder(s), kept ${kept} (within ${RETENTION_WEEKS}-week retention).`);
