import { useState, useEffect, useRef, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';

// ── SuperCollider example shown on first load ────────────────────────────────
const INITIAL_CODE = `// SC Web — SuperCollider Browser IDE
// Ctrl+Enter  →  evaluate all code
// Click "Stop" →  CmdPeriod (silence everything)

// Boot the server first (done automatically on startup — watch the post window)

// ── Examples ──────────────────────────────────────────────────────────────────

// Sine wave at 440 Hz
{ SinOsc.ar(440, 0, 0.2) ! 2 }.play;

// // Filtered noise
// { RLPF.ar(WhiteNoise.ar(0.3), LFNoise1.kr(1).exprange(200, 4000), 0.1) ! 2 }.play;

// // Simple pattern
// Pbind(\\instrument, \\default, \\degree, Pseq([0, 2, 4, 7], inf), \\dur, 0.25).play;
`;

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    background: '#0d0d1a',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 14px',
    background: '#16213e',
    borderBottom: '1px solid #2a2a4a',
    flexShrink: 0,
  },
  title: { fontWeight: 700, color: '#4ecca3', letterSpacing: '0.05em' },
  dot: (ok) => ({ color: ok ? '#4ecca3' : '#e94560', fontSize: 12 }),
  btn: (color, disabled) => ({
    background: 'transparent',
    border: `1px solid ${disabled ? '#444' : color}`,
    color: disabled ? '#555' : color,
    padding: '3px 12px',
    borderRadius: 3,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    transition: 'opacity .15s',
  }),
  audio: { marginLeft: 'auto', height: 28 },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  editor: { flex: 1, overflow: 'auto', minWidth: 0 },
  post: {
    width: 340, padding: '6px 8px',
    overflowY: 'auto',
    background: '#090914',
    borderLeft: '1px solid #2a2a4a',
    fontSize: 11.5,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#b0b8d0',
    flexShrink: 0,
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const [code, setCode]           = useState(INITIAL_CODE);
  const [output, setOutput]       = useState('Connecting to bridge…\n');
  const [connected, setConnected] = useState(false);
  const wsRef     = useRef(null);
  const postRef   = useRef(null);
  const reconnect = useRef(true);

  // Auto-scroll post window
  useEffect(() => {
    if (postRef.current) {
      postRef.current.scrollTop = postRef.current.scrollHeight;
    }
  }, [output]);

  // WebSocket lifecycle
  useEffect(() => {
    function connect() {
      if (!reconnect.current) return;
      const url = `ws://${window.location.host}/ws`;
      const ws  = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        append('Bridge connected.\n');
      };
      ws.onclose = () => {
        setConnected(false);
        append('\n[disconnected — retrying in 3 s…]\n');
        setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        append('[ws error]\n');
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'post')   append(msg.text);
          if (msg.type === 'status') setConnected(msg.connected);
        } catch { /* ignore */ }
      };
    }

    connect();
    return () => {
      reconnect.current = false;
      wsRef.current?.close();
    };
  }, []);

  const append = (text) => setOutput((prev) => prev + text);

  const send = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  const handleEval = useCallback(() => send('eval', { code }), [code, send]);
  const handleStop = useCallback(() => send('stop'), [send]);
  const handleClear = () => setOutput('');

  // Keyboard shortcut: Ctrl+Enter to eval
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleEval(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleEval]);

  return (
    <div style={S.root}>
      {/* ── Toolbar ── */}
      <div style={S.toolbar}>
        <span style={S.title}>SC Web</span>
        <span style={S.dot(connected)}>
          {connected ? '● connected' : '○ disconnected'}
        </span>

        <button
          style={S.btn('#4ecca3', !connected)}
          disabled={!connected}
          onClick={handleEval}
          title="Ctrl+Enter"
        >
          Eval
        </button>

        <button
          style={S.btn('#e94560', !connected)}
          disabled={!connected}
          onClick={handleStop}
        >
          Stop
        </button>

        <button
          style={S.btn('#888', false)}
          onClick={handleClear}
        >
          Clear post
        </button>

        {/* Live stream player */}
        <audio
          controls
          src="/stream"
          style={S.audio}
          title="Live stream from scsynth"
        />
      </div>

      {/* ── Editor + Post window ── */}
      <div style={S.body}>
        <div style={S.editor}>
          <CodeMirror
            value={code}
            theme={oneDark}
            height="100%"
            style={{ height: '100%' }}
            onChange={setCode}
          />
        </div>

        <div ref={postRef} style={S.post}>
          {output}
        </div>
      </div>
    </div>
  );
}
