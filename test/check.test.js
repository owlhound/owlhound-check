'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const check = require('../src/check');
const fixture = require('./fixture-server');

test('parseUrls takes lines, commas, bare domains and skips comments', () => {
  assert.deepStrictEqual(check.parseUrls('example.com, https://a.test/x\n# note\n\nhttp://b.test'),
    ['https://example.com', 'https://a.test/x', 'http://b.test']);
});

test('parseExpect understands codes and ranges and rejects nonsense', () => {
  const ok = check.parseExpect('200-299,404');
  assert.ok(ok(200) && ok(299) && ok(404));
  assert.ok(!ok(301) && !ok(500));
  assert.throws(() => check.parseExpect('2xx'), /not a status code/);
});

test('a 500 fails, a 200 passes, a redirect is followed, a loop stops', async () => {
  const f = await fixture.start();
  try {
    const urls = ['/ok', '/fail', '/moved', '/loop'].map((p) => f.base + p);
    const results = await check.checkAll(urls, { timeoutSeconds: 5 });
    const failed = check.evaluate(results, { expectStatus: '200-399', minSslDays: 14 });
    assert.strictEqual(failed, 2);
    const [ok, fail, moved, loop] = results;
    assert.ok(ok.ok && ok.status === 200 && ok.ms >= 0 && ok.sslDays === null);
    assert.ok(!fail.ok && fail.reason === 'HTTP 500');
    assert.ok(moved.ok && moved.status === 200 && moved.finalUrl.endsWith('/ok'));
    assert.ok(!loop.ok && loop.reason === 'too many redirects');
  } finally { await f.close(); }
});

test('the latency limit and the timeout both fail a check', async () => {
  const f = await fixture.start();
  try {
    const [slow] = await check.checkAll([`${f.base}/slow`], { timeoutSeconds: 5 });
    assert.strictEqual(check.evaluate([slow], { maxLatencyMs: 100 }), 1);
    assert.match(slow.reason, /^slow: \d+ ms, limit 100 ms$/);
    const [late] = await check.checkAll([`${f.base}/slow`], { timeoutSeconds: 0.1 });
    check.evaluate([late], {});
    assert.strictEqual(late.reason, 'no answer in time');
  } finally { await f.close(); }
});

test('an unreachable address fails with a plain reason', async () => {
  const f = await fixture.start();
  const base = f.base;
  await f.close();                                  // nothing listens there now
  const [r] = await check.checkAll([`${base}/ok`], { timeoutSeconds: 2 });
  check.evaluate([r], {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'connection refused');
});

test('certificate days left are read, and a short-lived certificate fails', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'),
      '-days', '5', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  } catch (e) { t.skip('openssl is not installed'); return; }
  const cert = fs.readFileSync(path.join(dir, 'c.pem'));
  const f = await fixture.start({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert });
  try {
    const [r] = await check.checkAll([`${f.base}/ok`], { timeoutSeconds: 5, ca: cert });
    assert.ok(r.sslDays === 4 || r.sslDays === 5, `days left: ${r.sslDays}`);
    assert.strictEqual(check.evaluate([r], { minSslDays: 14 }), 1);
    assert.match(r.reason, /^certificate: [45] days left, limit 14$/);
    assert.strictEqual(check.evaluate([r], { minSslDays: null }), 0);
    const [untrusted] = await check.checkAll([`${f.base}/ok`], { timeoutSeconds: 5 });
    check.evaluate([untrusted], {});
    assert.strictEqual(untrusted.reason, 'self-signed certificate');
  } finally { await f.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the summary table carries the results and the OwlHound link', () => {
  const results = [{ url: 'https://a.test', ok: true, status: 200, ms: 120, sslDays: 80, reason: '' },
    { url: 'https://b.test/x|y', ok: false, status: 500, ms: 40, sslDays: 80, reason: 'HTTP 500' }];
  const md = check.markdownTable(results);
  assert.match(md, /\*\*1 of 2 checks failed\.\*\*/);
  assert.match(md, /\| ❌ \| https:\/\/b\.test\/x\\\|y \| 500 \| 40 \| 80 \| HTTP 500 \|/);
  assert.ok(md.includes('https://owlhound.com/?utm_source=owlhound-check'));
  assert.match(check.textTable(results), /FAIL\s+https:\/\/b\.test/);
});

test('report posts every result with the key and never throws', async () => {
  const f = await fixture.start();
  try {
    const results = [{ url: 'https://a.test', ok: false, status: 500, ms: 40, sslDays: null, reason: 'HTTP 500' }];
    const sent = await check.report(results, { token: 'ohk_test', api: `${f.base}/api/v1`, source: 'cli' });
    assert.ok(sent.ok);
    const got = f.received.at(-1);
    assert.strictEqual(got.auth, 'Bearer ohk_test');
    assert.deepStrictEqual(got.body.results, [{ url: 'https://a.test', ok: false, status: 500, ms: 40, ssl_days: null, error: 'HTTP 500' }]);
    const nowhere = await check.report(results, { token: 'x', api: `${f.base}/nothing/here` });
    assert.strictEqual(nowhere.ok, false);
  } finally { await f.close(); }
});
