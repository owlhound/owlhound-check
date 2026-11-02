'use strict';
// The Action and the CLI run as the runner and a shell would run them, against the local fixture server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fixture = require('./fixture-server');

const ROOT = path.join(__dirname, '..');

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { PATH: process.env.PATH, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function runnerFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-run-'));
  const summary = path.join(dir, 'summary.md');
  const output = path.join(dir, 'output.txt');
  fs.writeFileSync(summary, '');
  fs.writeFileSync(output, '');
  return { dir, summary, output };
}

test('the Action fails the job on a 500 and writes the summary and outputs', async () => {
  const f = await fixture.start();
  const files = runnerFiles();
  try {
    const r = await run(['src/action.js'], {
      'INPUT_URLS': `${f.base}/ok\n${f.base}/fail`, 'INPUT_MIN-SSL-DAYS': '14', 'INPUT_FAIL-JOB': 'true',
      GITHUB_STEP_SUMMARY: files.summary, GITHUB_OUTPUT: files.output,
    });
    assert.strictEqual(r.code, 1, r.out + r.err);
    assert.match(r.out, /::error title=OwlHound Check::http:\/\/127\.0\.0\.1:\d+\/fail: HTTP 500/);
    const md = fs.readFileSync(files.summary, 'utf8');
    assert.match(md, /\*\*1 of 2 checks failed\.\*\*/);
    assert.ok(md.includes('https://owlhound.com/?utm_source=owlhound-check'));
    const outputs = fs.readFileSync(files.output, 'utf8');
    assert.match(outputs, /^failed<<ghadelim_[0-9a-f]+\n1\n/);
    const json = JSON.parse(/results<<(ghadelim_[0-9a-f]+)\n(.*)\n\1/.exec(outputs)[2]);
    assert.deepStrictEqual(json.map((x) => [x.ok, x.status]), [[true, 200], [false, 500]]);
  } finally { await f.close(); fs.rmSync(files.dir, { recursive: true, force: true }); }
});

test('fail-job false reports without failing; all-passing exits 0', async () => {
  const f = await fixture.start();
  const files = runnerFiles();
  try {
    const soft = await run(['src/action.js'], { INPUT_URLS: `${f.base}/fail`, 'INPUT_FAIL-JOB': 'false', GITHUB_STEP_SUMMARY: files.summary });
    assert.strictEqual(soft.code, 0);
    assert.match(soft.out, /::error /);
    const fine = await run(['src/action.js'], { INPUT_URLS: `${f.base}/ok, ${f.base}/moved` });
    assert.strictEqual(fine.code, 0, fine.out);
  } finally { await f.close(); fs.rmSync(files.dir, { recursive: true, force: true }); }
});

test('the Action masks the key and sends the results with the run address', async () => {
  const f = await fixture.start();
  try {
    const r = await run(['src/action.js'], {
      INPUT_URLS: `${f.base}/ok`, 'INPUT_OWLHOUND-TOKEN': 'ohk_secret', 'INPUT_OWLHOUND-API': `${f.base}/api/v1`,
      GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/site', GITHUB_RUN_ID: '42',
    });
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /^::add-mask::ohk_secret$/m);
    assert.match(r.out, /Results sent to OwlHound\./);
    const got = f.received.at(-1);
    assert.strictEqual(got.body.source, 'github-action');
    assert.strictEqual(got.body.run_url, 'https://github.com/acme/site/actions/runs/42');
  } finally { await f.close(); }
});

test('a bad input stops the Action before any request', async () => {
  const r = await run(['src/action.js'], { INPUT_URLS: 'https://example.invalid', 'INPUT_EXPECT-STATUS': '2xx' });
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /::error title=OwlHound Check::expect-status: "2xx" is not a status code/);
});

test('the CLI exits 1 on a failed check, 0 when all pass, 2 on a usage mistake', async () => {
  const f = await fixture.start();
  try {
    const bad = await run(['bin/owlhound.js', 'check', `${f.base}/fail`]);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.out, /FAIL\s+http:\/\/127\.0\.0\.1:\d+\/fail\s+500/);
    assert.ok(bad.out.includes('https://owlhound.com/?utm_source=owlhound-check'));
    const good = await run(['bin/owlhound.js', 'check', `${f.base}/ok`, '--json']);
    assert.strictEqual(good.code, 0);
    assert.strictEqual(JSON.parse(good.out)[0].status, 200);
    for (const args of [['check'], ['check', 'a.test', '--expect', 'x'], ['frobnicate'], ['check', 'a.test', '--report'], ['check', 'a.test', '--timeout']]) {
      const u = await run(['bin/owlhound.js', ...args]);
      assert.strictEqual(u.code, 2, `${args.join(' ')} -> ${u.code} ${u.err}`);
    }
    const help = await run(['bin/owlhound.js', '--help']);
    assert.strictEqual(help.code, 0);
    assert.match(help.out, /Usage: owlhound check <url>/);
  } finally { await f.close(); }
});
