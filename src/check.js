'use strict';
// The checks shared by the GitHub Action and the CLI: status, response time and certificate days left.
// Node's own http/https only, so the Action runs without installing anything.

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const VERSION = '1.0.0';
const HOME = 'https://owlhound.com/?utm_source=owlhound-check&utm_medium=referral&utm_campaign=seo-h';
const USER_AGENT = `owlhound-check/${VERSION} (+https://github.com/owlhound/owlhound-check)`;
const MAX_REDIRECTS = 5;
const DAY_MS = 86400000;

/** Turn "a.com, https://b.com/x" or one URL per line into full URLs; blank lines and # comments are skipped. */
function parseUrls(text) {
  return String(text || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))
    .map((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`));
}

/** "200-399", "200,301" or "200-299,404" -> function(status) -> bool. */
function parseExpect(spec) {
  const parts = String(spec || '200-399').split(',').map((s) => s.trim()).filter(Boolean);
  const ranges = parts.map((p) => {
    const m = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(p);
    if (!m) throw new Error(`expect-status: "${p}" is not a status code or a range like 200-399`);
    return [Number(m[1]), Number(m[2] || m[1])];
  });
  return (status) => ranges.some(([lo, hi]) => status >= lo && status <= hi);
}

function errorText(err) {
  const code = err && err.code;
  const known = {
    ENOTFOUND: 'name does not resolve',
    EAI_AGAIN: 'DNS lookup failed',
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection reset',
    CERT_HAS_EXPIRED: 'certificate expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed certificate',
    SELF_SIGNED_CERT_IN_CHAIN: 'self-signed certificate in chain',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'incomplete certificate chain',
    ERR_TLS_CERT_ALTNAME_INVALID: 'certificate does not match the name',
    TIMEOUT: 'no answer in time',
  };
  return known[code] || (err && err.message) || String(err);
}

/** One request, no redirect following. Resolves {status, location, ms, cert} or rejects. */
function requestOnce(url, timeoutMs, ca) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const started = process.hrtime.bigint();
    const req = lib.request(u, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      timeout: timeoutMs,
      agent: false,
      ...(ca ? { ca } : {}),                                          // tests trust their own certificate
    }, (res) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;   // time to the response headers
      let cert = null;
      if (u.protocol === 'https:' && res.socket && typeof res.socket.getPeerCertificate === 'function') {
        const c = res.socket.getPeerCertificate();
        if (c && c.valid_to) cert = { validTo: new Date(c.valid_to) };
      }
      res.resume();                                                  // the body isn't needed; let the socket close
      res.on('error', () => {});
      resolve({ status: res.statusCode, location: res.headers.location, ms, cert });
      req.destroy();
    });
    req.on('timeout', () => { const e = new Error('timeout'); e.code = 'TIMEOUT'; req.destroy(e); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Check one URL: follows up to five redirects, then reports the final status, the first response's time
 * and the certificate days left on the last https address. Never throws.
 */
async function checkUrl(url, opts = {}) {
  const timeoutMs = (opts.timeoutSeconds || 10) * 1000;
  const now = opts.now || Date.now();
  const out = { url, finalUrl: url, status: null, ms: null, sslDays: null, error: null };
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const r = await requestOnce(current, timeoutMs, opts.ca);
      if (out.ms === null) out.ms = Math.round(r.ms);
      if (r.cert) out.sslDays = Math.floor((r.cert.validTo.getTime() - now) / DAY_MS);
      out.status = r.status;
      out.finalUrl = current;
      if (r.status >= 300 && r.status < 400 && r.location) {
        if (hop === MAX_REDIRECTS) { out.error = 'too many redirects'; break; }
        current = new URL(r.location, current).toString();
        continue;
      }
      break;
    }
  } catch (err) {
    out.error = errorText(err);
  }
  return out;
}

/** Apply the thresholds: sets ok and a plain-words reason on each result. Returns how many failed. */
function evaluate(results, rules = {}) {
  const expect = parseExpect(rules.expectStatus);
  let failed = 0;
  for (const r of results) {
    const why = [];
    if (r.error) why.push(r.error);
    else if (!expect(r.status)) why.push(`HTTP ${r.status}`);
    if (!r.error && rules.maxLatencyMs && r.ms > rules.maxLatencyMs) why.push(`slow: ${r.ms} ms, limit ${rules.maxLatencyMs} ms`);
    if (r.sslDays !== null && rules.minSslDays !== undefined && rules.minSslDays !== null && r.sslDays < rules.minSslDays) {
      why.push(`certificate: ${r.sslDays} days left, limit ${rules.minSslDays}`);
    }
    r.ok = why.length === 0;
    r.reason = why.join('; ');
    if (!r.ok) failed += 1;
  }
  return failed;
}

async function checkAll(urls, opts = {}) {
  const results = [];
  for (const url of urls) results.push(await checkUrl(url, opts));   // one at a time: polite, and the order is the input's
  return results;
}

function cell(v) {
  return String(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

/** The job summary: a Markdown table and the credit line. */
function markdownTable(results) {
  const rows = results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${cell(r.url)} | ${r.status ?? '–'} | ${r.ms ?? '–'} | ${r.sslDays ?? '–'} | ${cell(r.reason || 'OK')} |`);
  const failed = results.filter((r) => !r.ok).length;
  const head = failed ? `**${failed} of ${results.length} checks failed.**` : `**All ${results.length} checks passed.**`;
  return [
    '### OwlHound Check',
    '',
    head,
    '',
    '| | URL | Status | Response (ms) | Certificate days left | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Checked by [owlhound-check](https://github.com/owlhound/owlhound-check). For checks around the clock, alerts and history, see [OwlHound](${HOME}).`,
    '',
  ].join('\n');
}

/** The terminal table for the CLI. */
function textTable(results) {
  const head = ['', 'URL', 'STATUS', 'MS', 'CERT DAYS', 'RESULT'];
  const rows = results.map((r) => [r.ok ? 'ok' : 'FAIL', r.url, r.status ?? '-', r.ms ?? '-', r.sslDays ?? '-', r.reason || 'OK'].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cols) => cols.map((c, i) => (i === cols.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd();
  return [line(head), ...rows.map(line)].join('\n');
}

/**
 * Send results to an OwlHound account (POST /api/v1/ci-checks). A read-only API key is enough.
 * Resolves {ok, status, body}; never throws, so a reporting problem never hides the check results.
 */
function report(results, { token, api = 'https://owlhound.com/api/v1', source = 'cli', runUrl = '' } = {}) {
  const payload = JSON.stringify({
    source,
    run_url: runUrl,
    results: results.map((r) => ({ url: r.url, ok: r.ok, status: r.status, ms: r.ms, ssl_days: r.sslDays, error: r.reason || null })),
  });
  return new Promise((resolve) => {
    let target;
    try { target = new URL(`${api.replace(/\/+$/, '')}/ci-checks`); } catch (e) { resolve({ ok: false, status: 0, body: 'bad API address' }); return; }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, {
      method: 'POST',
      timeout: 15000,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': USER_AGENT, 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4000) body += d; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, body: errorText(e) }));
    req.end(payload);
  });
}

module.exports = { VERSION, HOME, USER_AGENT, parseUrls, parseExpect, checkUrl, checkAll, evaluate, markdownTable, textTable, report };
