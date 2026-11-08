'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { parseHttpUrl, normalizeDomain, buildProbeUrls, countValidLines, probeUrl,
  checkSingleFile, escapeCsvCell, csvInputs, MAX_RESPONSE_BYTES } = require('../assets/js/scan-core.js');

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test('normalizes domains without allowing URL authority injection', () => {
  assert.equal(normalizeDomain(' "https://WWW.Example.com/path?q=1" '), 'example.com');
  assert.equal(normalizeDomain('https://example.com?query=1'), 'example.com');
  assert.equal(normalizeDomain('https://user:pass@example.com'), '');
  assert.equal(normalizeDomain('example.com:8080/path'), '');
  assert.equal(normalizeDomain('example.com<script>'), '');
  assert.equal(normalizeDomain('bad_domain.example'), '');
  assert.equal(normalizeDomain('https://пример.рф/'), 'xn--e1afmkfd.xn--p1ai');
  assert.equal(parseHttpUrl('javascript:alert(1)'), null);
  assert.equal(parseHttpUrl('ftp://example.com'), null);
  assert.equal(parseHttpUrl('https://user:password@example.com/ads.txt'), null);
  assert.equal(parseHttpUrl('example.com:8080/ads.txt').href, 'https://example.com:8080/ads.txt');
});

test('counts only complete records with an exact relationship type', () => {
  const input = '\ufeffexample.com, publisher, DIRECT # comment\r\nexample.org, id, reseller, cert\r\n' +
    ', id, DIRECT\nexample.com, , DIRECT\nexample.com, id, DIRE-CT\n# comment\nmanagerdomain=example.com';
  assert.equal(countValidLines(input), 2);
});

test('imports quoted CSV fields and preserves exact URLs', () => {
  assert.deepEqual(csvInputs('\ufeffFile URL,Status\r\n"https://example.com/a,b?q=1",Valid\r\n' +
    '"https://example.com/a,b?q=1",Valid\r\n"https://domain.example/path",Error\r\n'),
  ['https://example.com/a,b?q=1', 'https://domain.example/path']);
  assert.deepEqual(csvInputs('https://domain.example/file;Valid\nexample.org;Error'),
    ['https://domain.example/file', 'example.org']);
});

test('quotes CSV delimiters and neutralizes spreadsheet formulas', () => {
  assert.equal(escapeCsvCell('=HYPERLINK("https://evil")'), '"\'=HYPERLINK(""https://evil"")"');
  assert.equal(escapeCsvCell('  @SUM(A1)'), "'  @SUM(A1)");
  assert.equal(escapeCsvCell('a,b\rc'), '"a,b\rc"');
  assert.equal(escapeCsvCell('https://example.com/a'), 'https://example.com/a');
});

test('probe omits credentials, rejects HTML, and counts valid lines', async () => {
  let options;
  global.fetch = async (_url, init) => { options = init; return new Response('example.com, id, DIRECT\n'); };
  assert.deepEqual(await probeUrl('https://example.com/ads.txt'),
    { status: 'Valid', lines: 1, url: 'https://example.com/ads.txt' });
  assert.equal(options.credentials, 'omit');
  global.fetch = async () => new Response('<!DOCTYPE html><html>error</html>');
  assert.equal(await probeUrl('https://example.com/ads.txt'), null);
  global.fetch = async () => new Response('# comment');
  assert.equal((await probeUrl('https://example.com/ads.txt')).status, 'Empty File');
});

test('probe bounds declared and streamed response sizes', async () => {
  global.fetch = async () => new Response('small', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } });
  assert.equal(await probeUrl('https://example.com/ads.txt'), null);
  global.fetch = async () => new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1));
  assert.equal(await probeUrl('https://example.com/ads.txt'), null);
});

test('fallbacks retain their order after errors and HTML', async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    if (urls.length === 1) throw new Error('network error');
    if (urls.length === 2) return new Response('<html>not found</html>');
    return new Response('example.com,id,RESELLER');
  };
  const result = await checkSingleFile('example.com', 'ads.txt');
  assert.deepEqual(urls, buildProbeUrls('example.com', 'ads.txt').slice(0, 3));
  assert.equal(result.url, 'http://www.example.com/ads.txt');
  assert.equal(result.lines, 1);
});
