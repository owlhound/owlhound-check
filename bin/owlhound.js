#!/usr/bin/env node
'use strict';
// owlhound check <url...>  ->  exit 0 when every check passes, 1 when one fails, 2 on a usage mistake.

const check = require('../src/check');

const HELP = `owlhound ${check.VERSION}: check a website's status, response time and certificate

Usage: owlhound check <url> [<url> ...] [options]

Options:
  --expect <codes>        Status codes that pass, such as 200-399 (the default) or 200,301
  --max-latency <ms>      Fail when the first response takes longer than this
  --min-ssl-days <days>   Fail when the certificate expires in fewer days (default 14; 0 turns it off)
  --timeout <seconds>     Give up on an address after this long (default 10)
  --json                  Print the results as JSON instead of a table
  --report                Send the results to your OwlHound account; needs OWLHOUND_TOKEN or --token
  --token <key>           An OwlHound API key (a read-only key is enough)
  -h, --help              Show this help
  -v, --version           Show the version

Exit codes: 0 all checks passed, 1 a check failed, 2 the command was wrong.

Checks around the clock, alerts and history: ${check.HOME}
`;

function usage(msg) {
  process.stderr.write(`owlhound: ${msg}\nRun "owlhound --help" for the options.\n`);
  process.exit(2);
}

function parse(argv) {
  const o = { urls: [], expect: '200-399', maxLatency: 0, minSslDays: 14, timeout: 10, json: false, report: false, token: process.env.OWLHOUND_TOKEN || '', api: process.env.OWLHOUND_API || 'https://owlhound.com/api/v1' };
  const args = [...argv];
  const value = (flag) => {
    if (!args.length || args[0].startsWith('--')) usage(`${flag} needs a value`);
    return args.shift();
  };
  const num = (flag) => {
    const v = value(flag);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) usage(`${flag}: "${v}" is not a number`);
    return n;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0); }
    if (a === '-v' || a === '--version') { process.stdout.write(`${check.VERSION}\n`); process.exit(0); }
    if (a === '--expect') o.expect = value(a);
    else if (a === '--max-latency') o.maxLatency = num(a);
    else if (a === '--min-ssl-days') o.minSslDays = num(a);
    else if (a === '--timeout') o.timeout = num(a);
    else if (a === '--json') o.json = true;
    else if (a === '--report') o.report = true;
    else if (a === '--token') o.token = value(a);
    else if (a === '--api') o.api = value(a);
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else o.urls.push(...check.parseUrls(a));
  }
  return o;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') { process.stdout.write(HELP); process.exit(argv.length ? 0 : 2); }
  if (argv[0] === '-v' || argv[0] === '--version') { process.stdout.write(`${check.VERSION}\n`); return; }
  if (argv[0] !== 'check') usage(`unknown command "${argv[0]}"; the command is "check"`);
  const o = parse(argv.slice(1));
  if (!o.urls.length) usage('give at least one address, such as owlhound check example.com');
  try { check.parseExpect(o.expect); } catch (e) { usage(e.message.replace('expect-status', '--expect')); }
  if (o.report && !o.token) usage('--report needs an API key in OWLHOUND_TOKEN or --token');

  const results = await check.checkAll(o.urls, { timeoutSeconds: o.timeout || 10 });
  const failed = check.evaluate(results, { expectStatus: o.expect, maxLatencyMs: o.maxLatency, minSslDays: o.minSslDays || null });
  if (o.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  else process.stdout.write(`${check.textTable(results)}\n\n${failed ? `${failed} of ${results.length} failed.` : 'All checks passed.'} Alerts and history: ${check.HOME}\n`);
  if (o.report) {
    const sent = await check.report(results, { token: o.token, api: o.api, source: 'cli' });
    process.stderr.write(sent.ok ? 'Results sent to OwlHound.\n' : `Results not sent to OwlHound (${sent.status || 'no answer'}): ${sent.body}\n`);
  }
  process.exitCode = failed ? 1 : 0;
}

main();
