import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(__dirname, '../../');
export const REPORTS_DIR = join(PROJECT_ROOT, 'reports');
export const INCOME_ETF_REPORTS_DIR = join(REPORTS_DIR, 'inc-etf');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function reportDateFromInput(value) {
  if (value == null || value === '') return new Date();
  if (value instanceof Date) return new Date(value.getTime());
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid report date: ${value}`);
  return parsed;
}

export function dateFolderName(date = new Date()) {
  const year = date.getFullYear();
  const month = MONTHS[date.getMonth()];
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ISO 8601 week: Monday-start, week 1 = the week containing the year's first Thursday.
export function isoWeekInfo(date = new Date()) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - dayNumber + 3);
  const isoYear = value.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNumber = Math.ceil(((value.getTime() - yearStart) / 86400000 + 1) / 7);
  return { isoYear, weekNumber };
}

export function weekFolderName(date = new Date()) {
  const { isoYear, weekNumber } = isoWeekInfo(date);
  return `${isoYear}-Wk${String(weekNumber).padStart(2, '0')}`;
}

export function reportDirFor(date = new Date()) {
  return join(REPORTS_DIR, weekFolderName(date), dateFolderName(date));
}

export function incomeEtfWeekDirFor(date = new Date()) {
  return join(INCOME_ETF_REPORTS_DIR, weekFolderName(date));
}

export function incomeEtfMonthlyReviewDirFor(date = new Date()) {
  return join(
    INCOME_ETF_REPORTS_DIR,
    'Mon-review',
    `${date.getFullYear()}-${MONTHS[date.getMonth()]}`,
  );
}

function safeRunFolderName(value) {
  const date = reportDateFromInput(value);
  return date.toISOString().replace(/[:.]/g, '-');
}

export function archiveIncomeEtfArtifact(filePath, generatedAt = null) {
  if (!existsSync(filePath)) return null;
  let artifactDate = generatedAt;
  if (!artifactDate && filePath.endsWith('.json')) {
    try {
      artifactDate = JSON.parse(readFileSync(filePath, 'utf8')).generated_at;
    } catch {}
  }
  if (!artifactDate) artifactDate = statSync(filePath).mtime;
  const archiveDir = join(dirname(filePath), 'runs', safeRunFolderName(artifactDate));
  mkdirSync(archiveDir, { recursive: true });
  const archivedPath = join(archiveDir, basename(filePath));
  copyFileSync(filePath, archivedPath);
  return archivedPath;
}

export function archiveIncomeEtfRun(reportDir) {
  const snapshotPath = join(reportDir, 'scan-income_etf.json');
  if (!existsSync(snapshotPath)) return null;
  let generatedAt = null;
  try {
    generatedAt = JSON.parse(readFileSync(snapshotPath, 'utf8')).generated_at;
  } catch {}
  if (!generatedAt) generatedAt = statSync(snapshotPath).mtime;
  const archiveDir = join(reportDir, 'runs', safeRunFolderName(generatedAt));
  mkdirSync(archiveDir, { recursive: true });
  for (const artifact of [
    'scan-income_etf.json',
    'income_etf-alerts.json',
    'income_etf.md',
  ]) {
    const source = join(reportDir, artifact);
    if (existsSync(source)) copyFileSync(source, join(archiveDir, artifact));
  }
  return archiveDir;
}
