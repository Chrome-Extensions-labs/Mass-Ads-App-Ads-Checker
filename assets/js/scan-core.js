'use strict';

const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function parseHttpUrl(raw, defaultProtocol = true) {
  const value = String(raw).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, a, b) => a ?? b);
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : defaultProtocol ? `https://${value}` : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeDomain(raw) {
  const url = parseHttpUrl(raw);
  if (!url || url.port || url.hostname.startsWith('[')) return '';
  const host = url.hostname.replace(/^www\./i, '').replace(/\.$/, '').toLowerCase();
  if (host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
  return host;
}

function buildProbeUrls(domain, fileType) {
  return [`https://www.${domain}/${fileType}`, `https://${domain}/${fileType}`,
    `http://www.${domain}/${fileType}`, `http://${domain}/${fileType}`];
}

function countValidLines(content) {
  let count = 0;
  for (const line of content.replace(/\uFEFF/g, '').split(/\r\n|\n|\r/)) {
    const parts = line.split('#', 1)[0].split(',').map(part => part.trim());
    if (parts.length >= 3 && parts[0] && parts[1] && /^(DIRECT|RESELLER)$/i.test(parts[2])) count++;
  }
  return count;
}

async function readResponseText(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Response too large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function probeUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (response.status !== 200) {
      if (response.body) await response.body.cancel().catch(() => {});
      return null;
    }
    const text = await readResponseText(response);
    if (/<html\b|<!doctype\b/i.test(text)) return null;
    const lines = countValidLines(text);
    return { status: lines ? 'Valid' : 'Empty File', lines, url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function checkSingleFile(domain, fileType) {
  for (const url of buildProbeUrls(domain, fileType)) {
    const result = await probeUrl(url);
    if (result) return result;
  }
  return { status: 'Error', lines: 0, url: '-' };
}

function escapeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvFirstColumn(content) {
  const rows = [];
  let cell = '';
  let quoted = false;
  let firstColumn = true;
  const text = String(content).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { if (firstColumn) cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else if (firstColumn) cell += ch;
    } else if (ch === '"' && (firstColumn ? !cell.trim() : true)) {
      quoted = true;
    } else if (ch === ',' || ch === ';') {
      firstColumn = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows.push(cell.trim());
      cell = '';
      firstColumn = true;
    } else if (firstColumn) cell += ch;
  }
  if (cell || !firstColumn) rows.push(cell.trim());
  return rows.filter(Boolean);
}

function csvInputs(content) {
  const values = parseCsvFirstColumn(content);
  if (values.length && /^(domain|url|site|website|file url)$/i.test(values[0])) values.shift();
  return [...new Set(values)];
}

if (typeof module !== 'undefined') {
  module.exports = { parseHttpUrl, normalizeDomain, buildProbeUrls, countValidLines, probeUrl, checkSingleFile, escapeCsvCell, parseCsvFirstColumn, csvInputs, MAX_RESPONSE_BYTES };
}
