'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 4000;
const STARTUP_SCD = '/home/scuser/sc/startup.scd';
const EVAL_DIR = os.tmpdir();
const HELP_DIR = '/usr/local/share/SuperCollider/Help';

// ── MIME types for help file serving ─────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
};

// ── HTTP server (serves /help; WebSocket is attached to same server) ──────────
const server = http.createServer((req, res) => {
  if (!req.url.startsWith('/help')) {
    res.writeHead(404); res.end('Not found'); return;
  }

  let rel = req.url.slice('/help'.length) || '/';
  if (rel === '/') {
    // Try the standard SCDoc entry points in order
    for (const name of ['Help.html', 'index.html']) {
      const p = path.join(HELP_DIR, name);
      if (fs.existsSync(p)) { rel = '/' + name; break; }
    }
  }

  // Prevent directory traversal
  const filePath = path.resolve(HELP_DIR, rel.replace(/^\/+/, ''));
  if (!filePath.startsWith(HELP_DIR + path.sep) && filePath !== HELP_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg);
  }
}

// Strip sclang REPL prompt, internal bridge commands, and normalize line endings.
function sanitize(str) {
  return str
    .replace(/^sc3>\s*/gm, '')                          // sclang REPL prompt
    .replace(/^load\("\/tmp\/sc_eval_[^"]*"\);\n?/gm, '') // hide internal load() calls
    .replace(/^load\("\/[^"]*startup\.scd"\);\n?/gm, '')  // hide startup load
    .replace(/^CmdPeriod\.run;\n?/gm, '')               // hide stop command echo
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

let evalCounter = 0;

// Write code to a temp .scd file and trigger it via sclang's stdin load().
function evalCode(code) {
  const file = path.join(EVAL_DIR, `sc_eval_${Date.now()}_${evalCounter++}.scd`);
  fs.writeFileSync(file, `(\n${code.trimEnd()}\n)\n`);
  const cmd = `load(${JSON.stringify(file)});\n`;
  console.log(`[bridge] eval → ${cmd.trim()}`);
  sclangProc.stdin.write(cmd);
  setTimeout(() => { try { fs.unlinkSync(file); } catch (_) {} }, 15000);
}

// ── sclang process ───────────────────────────────────────────────────────────

const { spawn } = require('child_process');
let sclangProc = null;
let sclangAlive = false;
let startupSent = false;

function startSclang() {
  console.log('[bridge] Spawning sclang...');
  startupSent = false;

  // Run sclang with NO script argument so it stays in REPL mode and reads
  // stdin. We send the startup code via stdin after the class library compiles.
  // stdbuf -oL: force line-buffered stdout so eval results flush immediately.
  // Without it, piped stdout uses full 4-8 KB buffering → results sit in
  // sclang's C-library buffer for up to 30 seconds before appearing.
  sclangProc = spawn('stdbuf', ['-oL', 'sclang'], {
    cwd: '/home/scuser',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PULSE_RUNTIME_PATH: process.env.PULSE_RUNTIME_PATH || '/tmp/pulse-runtime',
    },
  });

  function handleOutput(stream, data) {
    const raw = data.toString();

    // After "compile done", send the startup .scd via load() so the server
    // boots. sclang reads stdin in REPL mode only when no script arg is given.
    if (!startupSent && raw.includes('compile done')) {
      startupSent = true;
      console.log('[bridge] Class library compiled — sending startup.scd');
      sclangProc.stdin.write(`load(${JSON.stringify(STARTUP_SCD)});\n`);
    }

    // Once the server confirms it's up, mark sclang as alive.
    if (!sclangAlive && raw.includes('=== SuperCollider server booted ===')) {
      sclangAlive = true;
      console.log('[bridge] Server booted — accepting evals');
      broadcast({ type: 'status', connected: true });
    }

    const text = sanitize(raw);
    if (text) {
      process.stdout.write(text);
      broadcast({ type: 'post', text });
    }
  }

  sclangProc.stdout.on('data', (d) => handleOutput('stdout', d));
  sclangProc.stderr.on('data', (d) => handleOutput('stderr', d));

  sclangProc.on('exit', (exitCode, signal) => {
    sclangAlive = false;
    const msg = `\n[sclang exited: code=${exitCode} signal=${signal}] restarting in 3 s…\n`;
    console.warn(msg);
    broadcast({ type: 'post', text: msg });
    broadcast({ type: 'status', connected: false });
    sclangProc = null;
    setTimeout(startSclang, 3000);
  });
}

// ── WebSocket server ─────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const ip = req.socket.remoteAddress;
  console.log(`[bridge] Client connected from ${ip} (${clients.size} total)`);

  ws.send(JSON.stringify({ type: 'status', connected: sclangAlive }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'eval') {
        if (!sclangAlive) {
          ws.send(JSON.stringify({ type: 'post', text: '[bridge] sclang not ready\n' }));
          return;
        }
        evalCode(msg.code);
      }

      if (msg.type === 'stop') {
        if (sclangAlive) {
          sclangProc.stdin.write('CmdPeriod.run;\n');
        }
      }
    } catch (e) {
      console.error('[bridge] Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[bridge] Client disconnected (${clients.size} total)`);
  });
});

startSclang();
server.listen(PORT, () => {
  console.log(`[bridge] Listening on ws://0.0.0.0:${PORT} (HTTP /help also served)`);
});
