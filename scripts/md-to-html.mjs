#!/usr/bin/env node
/**
 * Converts a saved markdown report into Gmail-safe HTML. Gmail's send pipeline strips <style>
 * blocks, class attributes, and any inline style="..." containing a "background" property — so
 * this emits plain legacy HTML attributes (border/cellpadding/cellspacing/bgcolor) instead of
 * CSS for table structure and coloring, matching decision-render.mjs's verified-working pattern.
 *
 * Replaces the freehand "read the .md, hand-convert it to HTML" step that several routines
 * (decision-email-routine, income-etf-weekly-routine, income-etf-monthly-review-routine) used to
 * do per run — that step both re-derived the same conversion logic every single run (wasted
 * tokens) and was the source of the Gmail-background-CSS bug (confirmed 2026-08-15).
 *
 * Supports: # / ## / ### headers, **bold**, *italic*, "- " bullet lists, pipe tables (header +
 * |---| separator + data rows), and plain paragraphs. Table header rows get bgcolor="#f5f5f5";
 * data rows are undecorated (this converter has no concept of qualification/bias to color-code
 * by — callers needing colored rows, like the weekly decision emails, should keep using
 * decision-render.mjs, which has that domain knowledge).
 *
 * Usage:
 *   node md-to-html.mjs <mdFile> <htmlOut>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , MD_FILE, HTML_OUT] = process.argv;
if (!MD_FILE || !HTML_OUT) {
  console.error('Usage: node md-to-html.mjs <mdFile> <htmlOut>');
  process.exit(1);
}

const TABLE_OPEN = '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px">';

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// **bold** and *italic* within a single line. Escapes first so raw < > & in source text can't
// break the surrounding markup.
function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  return s;
}

function isTableRow(line) {
  return /^\|.*\|$/.test(line.trim());
}

function isSeparatorRow(line) {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function parseTableRow(line) {
  return line.trim().slice(1, -1).split('|').map(c => c.trim());
}

function alignFromSeparator(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function renderTable(lines) {
  const rows = lines.map(parseTableRow);
  const [header, sep, ...data] = rows;
  const aligns = sep.map(alignFromSeparator);
  const cellStyle = (i) => {
    const a = aligns[i] || 'left';
    return a === 'left' ? '' : ` style="text-align:${a}"`;
  };
  let out = TABLE_OPEN + '<tr bgcolor="#f5f5f5">';
  out += header.map((c, i) => `<th${cellStyle(i)}>${inline(c)}</th>`).join('');
  out += '</tr>';
  for (const row of data) {
    out += '<tr>' + row.map((c, i) => `<td${cellStyle(i)}>${inline(c)}</td>`).join('') + '</tr>';
  }
  out += '</table>';
  return out;
}

function convert(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let i = 0;
  let listBuffer = [];

  const flushList = () => {
    if (listBuffer.length) {
      html.push('<ul>' + listBuffer.map(item => `<li>${inline(item)}</li>`).join('') + '</ul>');
      listBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') { flushList(); i++; continue; }

    if (isTableRow(trimmed) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushList();
      const tableLines = [trimmed, lines[i + 1].trim()];
      i += 2;
      while (i < lines.length && isTableRow(lines[i].trim())) {
        tableLines.push(lines[i].trim());
        i++;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    if (trimmed.startsWith('### ')) { flushList(); html.push(`<h3>${inline(trimmed.slice(4))}</h3>`); i++; continue; }
    if (trimmed.startsWith('## ')) { flushList(); html.push(`<h2>${inline(trimmed.slice(3))}</h2>`); i++; continue; }
    if (trimmed.startsWith('# ')) { flushList(); html.push(`<h1>${inline(trimmed.slice(2))}</h1>`); i++; continue; }

    if (/^[-*]\s+/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^[-*]\s+/, ''));
      i++;
      continue;
    }

    if (trimmed === '---') { flushList(); html.push('<hr>'); i++; continue; }

    flushList();
    html.push(`<p>${inline(trimmed)}</p>`);
    i++;
  }
  flushList();
  return html.join('\n');
}

const markdown = readFileSync(MD_FILE, 'utf8');
const body = convert(markdown);
const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:960px;margin:0 auto;padding:16px">\n${body}\n</div>`;

writeFileSync(HTML_OUT, html);
console.log(`md-to-html: rendered ${HTML_OUT} (${html.length} bytes)`);
