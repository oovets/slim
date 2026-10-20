const fs = require('fs');
const http = require('http');
const path = require('path');

const UI_HOST = '127.0.0.1';
const UI_PORT = 5173;
const UI_ORIGIN = `http://${UI_HOST}:${UI_PORT}`;
const LOGIN_HOST = '127.0.0.1';
const LOGIN_PORT = 8989;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** `GET /login?<query>` -> `302` to `<UI_ORIGIN>/?fb=1&<query>`. Other paths are 404. */
function loginLocation(rawUrl) {
  const qIndex = rawUrl.indexOf('?');
  const pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
  if (pathname !== '/login') return null;
  const query = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1);
  return `${UI_ORIGIN}/?fb=1&${query}`;
}

function safeFile(root, rawUrl) {
  const pathname = rawUrl.split('?')[0];
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (rel === '') rel = 'index.html';
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

function createUiServer(root) {
  const dir = path.resolve(root);
  return http.createServer((req, res) => {
    const file = safeFile(dir, req.url || '/');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}

function createLoginServer() {
  return http.createServer((req, res) => {
    const location = loginLocation(req.url || '/');
    if (!location) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(302, { Location: location });
    res.end();
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

module.exports = {
  UI_HOST,
  UI_PORT,
  UI_ORIGIN,
  LOGIN_HOST,
  LOGIN_PORT,
  loginLocation,
  createUiServer,
  createLoginServer,
  listen,
};
