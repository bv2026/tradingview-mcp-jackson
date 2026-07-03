#!/usr/bin/env node
/**
 * One-time migration: moves existing reports/YYYY-Mon-DD/ folders into the
 * new reports/YYYY-WkNN/YYYY-Mon-DD/ structure. Safe to re-run — folders
 * already migrated (or that don't match the flat day-folder pattern) are
 * skipped.
 */
import { readdirSync, statSync, mkdirSync, renameSync, readdirSync as readdir2 } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(PROJECT_ROOT, 'reports');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_FOLDER_RE = /^(\d{4})-([A-Za-z]{3})-(\d{2})$/;

function isoWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return { isoYear, weekNum };
}

function weekFolderName(date) {
  const { isoYear, weekNum } = isoWeekInfo(date);
  return `${isoYear}-Wk${String(weekNum).padStart(2, '0')}`;
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdir2(dir, { withFileTypes: true })) {
    if (entry.isFile()) n++;
    else if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
  }
  return n;
}

const entries = readdirSync(REPORTS_DIR, { withFileTypes: true });
let migrated = 0, skipped = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const match = entry.name.match(DAY_FOLDER_RE);
  if (!match) {
    console.log(`SKIP  ${entry.name}  (doesn't match YYYY-Mon-DD, e.g. "weekly", "archive")`);
    skipped++;
    continue;
  }
  const [, yearStr, monStr, dayStr] = match;
  const monthIdx = MONTHS.findIndex(m => m.toLowerCase() === monStr.toLowerCase());
  if (monthIdx === -1) {
    console.log(`SKIP  ${entry.name}  (unrecognized month "${monStr}")`);
    skipped++;
    continue;
  }
  const date = new Date(Number(yearStr), monthIdx, Number(dayStr));
  const week = weekFolderName(date);
  const srcDir = join(REPORTS_DIR, entry.name);
  const weekDir = join(REPORTS_DIR, week);
  const destDir = join(weekDir, entry.name);

  const srcCount = countFiles(srcDir);
  mkdirSync(weekDir, { recursive: true });
  renameSync(srcDir, destDir);
  const destCount = countFiles(destDir);

  if (srcCount !== destCount) {
    console.error(`MISMATCH ${entry.name}: source had ${srcCount} files, dest has ${destCount} — INVESTIGATE`);
  } else {
    console.log(`OK    ${entry.name}  ->  ${week}/${entry.name}  (${destCount} files)`);
  }
  migrated++;
}

console.log(`\nMigrated ${migrated} folder(s), skipped ${skipped}.`);
