'use strict';
// A local server for the tests: /ok 200, /fail 500, /slow answers after 300 ms, /moved redirects to /ok, /loop redirects forever.

const http = require('node:http');
const https = require('node:https');

function handler(req, res) {
  const path = req.url.split('?')[0];
  if (path === '/ok') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('fine'); return; }
  if (path === '/fail') { res.writeHead(500); res.end('broken'); return; }
  if (path === '/slow') { setTimeout(() => { res.writeHead(200); res.end('late'); }, 300); return; }
  if (path === '/moved') { res.writeHead(301, { location: '/ok' }); res.end(); return; }
  if (path === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
  if (path === '/api/v1/ci-checks' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      handler.received.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"stored": 1}');
    });
    return;
  }
  res.writeHead(404); res.end();
}
handler.received = [];

function start(tls, port = 0) {
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const base = `${tls ? 'https' : 'http'}://${tls ? 'localhost' : '127.0.0.1'}:${server.address().port}`;
      resolve({ server, base, received: handler.received, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start };

if (require.main === module) {                 // `node test/fixture-server.js 8765` for the workflow test
  start(null, Number(process.argv[2] || 0)).then(({ base }) => console.log(`fixture server on ${base}`));
}
