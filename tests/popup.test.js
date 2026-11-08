'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createApp(fetch) {
  class Element {
    constructor(tag = 'div') {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.style = {};
      this.value = '';
      this.classList = { toggle() {} };
    }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    setAttribute(name, value) { this[name] = value; }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    set innerHTML(value) { assert.equal(value, ''); this.children = []; }
    click() { return this.listeners.click?.({ target: this }); }
    change() { return this.listeners.change?.({ target: this }); }
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const body = new Element('tbody');
  const document = {
    body: new Element('body'),
    getElementById: get,
    querySelector: () => body,
    createElement: tag => new Element(tag),
    addEventListener: (_name, handler) => handler()
  };
  const storage = new Map();
  const context = vm.createContext({ document, fetch, URL, TextDecoder, AbortController, Blob, setTimeout, clearTimeout,
    setInterval, clearInterval, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    FileReader: class {
      readAsText(file) { this.onload({ target: { result: file.content } }); }
    } });
  vm.runInContext(fs.readFileSync('assets/js/scan-core.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('assets/js/popup.js', 'utf8'), context);
  return { get, body };
}

test('standard scan renders untrusted input as text and exports results', async () => {
  const app = createApp(async () => new Response('example.com,id,DIRECT'));
  app.get('domainList').value = '<img src=x onerror=alert(1)>\nexample.com';
  app.get('fileTypeSelect').value = 'ads.txt';
  await app.get('checkBtn').click();
  assert.equal(app.body.children.length, 2);
  const fallback = app.body.children[0].children[0].children[0];
  assert.equal(fallback.tag, 'span');
  assert.equal(fallback.textContent, '<img src=x onerror=alert(1)>');
  const link = app.body.children[1].children[0].children[0];
  assert.equal(link.tag, 'a');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(app.get('downloadBtn').style.display, 'inline-flex');
  assert.match(app.get('progressMeta').innerText, /2 \/ 2.*Completed/);
});

test('worker queue fills free slots and stop prevents new checks', async () => {
  const requests = [];
  const app = createApp(url => new Promise(resolve => requests.push({ url, resolve })));
  app.get('standardConcurrencyInput').value = '2';
  app.get('standardConcurrencyInput').change();
  app.get('domainList').value = 'one.example\ntwo.example\nthree.example\nfour.example';
  app.get('fileTypeSelect').value = 'url';
  const running = app.get('checkBtn').click();
  assert.equal(requests.length, 2);
  requests[1].resolve(new Response('example.com,id,DIRECT'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 3);
  app.get('stopBtn').click();
  requests[0].resolve(new Response('example.com,id,DIRECT'));
  requests[2].resolve(new Response('example.com,id,DIRECT'));
  await running;
  assert.equal(requests.length, 3);
  assert.match(app.get('progressMeta').innerText, /3 \/ 4.*Stopped by user/);
  assert.equal(app.get('checkBtn').style.display, 'block');
});

test('bulk mode imports exact URLs from CSV', async () => {
  const urls = [];
  const app = createApp(async url => { urls.push(url); return new Response('example.com,id,DIRECT'); });
  app.get('bulkModeBtn').click();
  app.get('bulkInputTypeSelect').value = 'csv';
  app.get('bulkInputTypeSelect').change();
  app.get('bulkFileInput').files = [{ content: 'URL,Status\n"https://example.com/path?q=1,2",Valid' }];
  app.get('bulkFileInput').change();
  app.get('bulkFileTypeSelect').value = 'url';
  await app.get('bulkCheckBtn').click();
  assert.deepEqual(urls, ['https://example.com/path?q=1,2']);
  assert.equal(app.get('bulkDownloadBtn').style.display, 'inline-flex');
  assert.match(app.get('bulkFileStatus').innerText, /Completed/);
});
