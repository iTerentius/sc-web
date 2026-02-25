import { useState, useEffect, useRef, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { supercollider } from './sc-language.js';

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
  // Right panel (Post / Help tabs)
  rightPanel: (helpActive) => ({
    width: helpActive ? 1020 : 340,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid #2a2a4a',
    flexShrink: 0,
    transition: 'width .15s',
  }),
  tabBar: {
    display: 'flex',
    background: '#16213e',
    borderBottom: '1px solid #2a2a4a',
    flexShrink: 0,
  },
  tab: (active) => ({
    flex: 1,
    padding: '4px 0',
    background: active ? '#090914' : 'transparent',
    border: 'none',
    color: active ? '#4ecca3' : '#666',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  }),
  post: {
    flex: 1, padding: '6px 8px',
    overflowY: 'auto',
    background: '#090914',
    fontSize: 11.5,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#b0b8d0',
    minHeight: 0,
  },
  helpFrame: {
    flex: 1,
    border: 'none',
    minHeight: 0,
    display: 'block',
    width: '100%',
  },
};

// CSS injected into the help iframe to highlight clickable code blocks.
// SC 3.14.1 SCDoc renders code examples as:
//   <div class='codeMirrorContainer'><textarea class='editor'>…</textarea></div>
const HELP_INJECT_CSS = `
  div.codeMirrorContainer {
    position: relative;
    cursor: pointer;
  }
  div.codeMirrorContainer::after {
    content: '↗ send to editor';
    position: absolute;
    top: 4px; right: 6px;
    font-size: 10px;
    color: #4ecca3;
    background: rgba(0,0,0,.6);
    padding: 1px 5px;
    border-radius: 3px;
    opacity: 0;
    transition: opacity .15s;
    pointer-events: none;
    font-family: sans-serif;
  }
  div.codeMirrorContainer:hover::after {
    opacity: 1;
  }
  div.codeMirrorContainer:hover {
    outline: 2px solid #4ecca3;
    outline-offset: 2px;
  }
`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function App() {
  const [code, setCode]           = useState(INITIAL_CODE);
  const [output, setOutput]       = useState('Connecting to bridge…\n');
  const [connected, setConnected] = useState(false);
  const [rightTab, setRightTab]   = useState('post');
  const wsRef     = useRef(null);
  const postRef   = useRef(null);
  const iframeRef = useRef(null);
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

  // Inject click-to-editor handlers into the help iframe after each navigation.
  // Same-origin iframe: we can access contentDocument directly and close over setCode.
  const handleHelpLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;

      // Inject highlight CSS
      const style = doc.createElement('style');
      style.textContent = HELP_INJECT_CSS;
      doc.head?.appendChild(style);

      // Wire every code block: click → send its text to the editor.
      // SC 3.14.1 SCDoc uses div.codeMirrorContainer > textarea.editor
      doc.querySelectorAll('div.codeMirrorContainer').forEach((container) => {
        container.addEventListener('click', () => {
          const ta = container.querySelector('textarea.editor');
          if (ta) setCode(ta.value.trim());
        });
      });
    } catch (_) {
      // Cross-origin navigation (e.g. external link opened in iframe) — ignore
    }
  }, []);

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

      {/* ── Editor + Right panel ── */}
      <div style={S.body}>
        <div style={S.editor}>
          <CodeMirror
            value={code}
            theme={oneDark}
            height="100%"
            style={{ height: '100%' }}
            extensions={supercollider}
            onChange={setCode}
          />
        </div>

        {/* Right panel: Post / Help tabs */}
        <div style={S.rightPanel(rightTab === 'help')}>
          <div style={S.tabBar}>
            <button style={S.tab(rightTab === 'post')} onClick={() => setRightTab('post')}>
              Post
            </button>
            <button style={S.tab(rightTab === 'help')} onClick={() => setRightTab('help')}>
              Help
            </button>
          </div>

          {/* Post window — always mounted, hidden when Help tab active */}
          <div
            ref={postRef}
            style={{ ...S.post, display: rightTab === 'post' ? 'block' : 'none' }}
          >
            {output}
          </div>

          {/* Help iframe — always mounted so navigation is preserved across tab switches */}
          <iframe
            ref={iframeRef}
            src="/help/"
            style={{ ...S.helpFrame, display: rightTab === 'help' ? 'block' : 'none' }}
            onLoad={handleHelpLoad}
            title="SuperCollider Help"
          />
        </div>
      </div>
    </div>
  );
}
