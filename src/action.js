'use strict';
// GitHub Action entry point. Reads inputs the way the runner passes them (INPUT_<NAME> environment variables),
// writes the job summary and outputs, and exits 1 when a check fails (unless fail-job is false).

const fs = require('node:fs');
const crypto = require('node:crypto');
const check = require('./check');

function input(name, fallback = '') {
  const v = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function number(name, fallback) {
  const raw = input(name, '');
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name}: "${raw}" is not a number`);
  return n;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `ghadelim_${crypto.randomBytes(8).toString('hex')}`;
  fs.appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

async function main() {
  const urls = check.parseUrls(input('urls'));
  if (!urls.length) throw new Error('urls: give at least one address, one per line or separated by commas');
  const token = input('owlhound-token');
  if (token) console.log(`::add-mask::${token}`);
  const rules = {
    expectStatus: input('expect-status', '200-399'),
    maxLatencyMs: number('max-latency-ms', 0),
    minSslDays: number('min-ssl-days', 14) || null,              // 0 turns the certificate check off
  };
  check.parseExpect(rules.expectStatus);                       // a bad range stops here, before any request
  const results = await check.checkAll(urls, { timeoutSeconds: number('timeout-seconds', 10) || 10 });
  const failed = check.evaluate(results, rules);

  console.log(check.textTable(results));
  for (const r of results.filter((x) => !x.ok)) console.log(`::error title=OwlHound Check::${escapeData(`${r.url}: ${r.reason}`)}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, check.markdownTable(results));
  setOutput('failed', String(failed));
  setOutput('results', JSON.stringify(results.map(({ url, finalUrl, ok, status, ms, sslDays, reason }) => ({ url, final_url: finalUrl, ok, status, ms, ssl_days: sslDays, reason }))));

  if (token) {
    const { GITHUB_SERVER_URL: srv, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
    const runUrl = srv && repo && run ? `${srv}/${repo}/actions/runs/${run}` : '';
    const sent = await check.report(results, { token, api: input('owlhound-api', 'https://owlhound.com/api/v1'), source: 'github-action', runUrl });
    if (sent.ok) console.log('Results sent to OwlHound.');
    else console.log(`::warning title=OwlHound Check::${escapeData(`Results not sent to OwlHound (${sent.status || 'no answer'}): ${sent.body}`.slice(0, 300))}`);
  }
  console.log(`\nFor checks around the clock, alerts and history: ${check.HOME}`);
  if (failed && input('fail-job', 'true').toLowerCase() !== 'false') process.exitCode = 1;
}

main().catch((err) => {
  console.log(`::error title=OwlHound Check::${escapeData(err.message || String(err))}`);
  process.exitCode = 1;
});
