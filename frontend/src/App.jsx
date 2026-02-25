import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { supercollider } from './sc-language.js';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

// ── SuperCollider example shown on first load ────────────────────────────────
const INITIAL_CODE = `// SC Web — SuperCollider Browser IDE
// Ctrl+Enter / Ctrl+e  →  evaluate current ( ) block, or selection
// Ctrl+/               →  toggle line comment(s)
// Ctrl+.               →  CmdPeriod (silence everything)

// Place the cursor anywhere inside a ( ) block and press Ctrl+Enter.

// ── Sine wave ──────────────────────────────────────────────────────────────────
(
{ SinOsc.ar(440, 0, 0.2) ! 2 }.play;
)

// ── Filtered noise ─────────────────────────────────────────────────────────────
// (
// { RLPF.ar(WhiteNoise.ar(0.3), LFNoise1.kr(1).exprange(200, 4000), 0.1) ! 2 }.play;
// )

// ── Simple pattern ─────────────────────────────────────────────────────────────
// (
// Pbind(\\instrument, \\default, \\degree, Pseq([0, 2, 4, 7], inf), \\dur, 0.25).play;
// )
`;

// ── Block finder ──────────────────────────────────────────────────────────────
// Scans forward from the document start to build a stack of open ( positions.
// If cursor is inside a block: stack[0] is the outermost enclosing (.
// If cursor is between blocks: scan forward from cursor for the next (.
// Falls back to the current line only when there is no ( anywhere near.
function findBlockToEval(text, pos) {
  const stack = [];
  for (let i = 0; i < pos; i++) {
    if      (text[i] === '(') stack.push(i);
    else if (text[i] === ')') stack.pop();
  }

  const start = stack.length > 0 ? stack[0] : text.indexOf('(', pos);

  if (start === -1) {
    // No ( anywhere — fall back to the current line
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd   = text.indexOf('\n', pos);
    const to        = lineEnd === -1 ? text.length : lineEnd;
    return { code: text.slice(lineStart, to).trim(), from: lineStart, to };
  }

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if      (text[i] === '(') depth++;
    else if (text[i] === ')') {
      if (--depth === 0) {
        return { code: text.slice(start + 1, i).trim(), from: start, to: i + 1 };
      }
    }
  }
  return { code: text.slice(start + 1).trim(), from: start, to: text.length };
}

// ── Eval flash ────────────────────────────────────────────────────────────────
const flashEffect = StateEffect.define();
const flashField  = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        deco = e.value != null
          ? Decoration.set([Decoration.mark({ class: 'cm-eval-flash' }).range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const flashTheme = EditorView.baseTheme({
  '.cm-eval-flash': { backgroundColor: 'rgba(78, 204, 163, 0.2)' },
});

// ── Mobile detection ──────────────────────────────────────────────────────────
function useMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return mobile;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100%', // inherits from #root which is sized via CSS (100dvh w/ 100vh fallback)
    background: '#0d0d1a',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 14px',
    background: '#16213e',
    borderBottom: '1px solid #2a2a4a',
    flexShrink: 0,
    flexWrap: 'wrap',
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
  btnToggle: (active) => ({
    background: active ? 'rgba(78,204,163,0.15)' : 'transparent',
    border: `1px solid ${active ? '#4ecca3' : '#444'}`,
    color: active ? '#4ecca3' : '#666',
    padding: '3px 10px',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  }),
  audio: { marginLeft: 'auto', height: 28 },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  editor: { flex: 1, overflow: 'auto', minWidth: 0 },
  postPanel: {
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid #2a2a4a',
    flexShrink: 0,
  },
  helpPanel: {
    width: 680,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid #2a2a4a',
    flexShrink: 0,
  },
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
  // ── Mobile-only ─────────────────────────────────────────────────────────────
  mobilePanel: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  mobileBar: {
    display: 'flex',
    background: '#16213e',
    borderTop: '1px solid #2a2a4a',
    flexShrink: 0,
    paddingBottom: 'env(safe-area-inset-bottom)', // clears iPhone home indicator
  },
  mobileNavBtn: (active) => ({
    flex: 1,
    padding: '12px 0 10px',
    background: 'transparent',
    border: 'none',
    borderTop: `2px solid ${active ? '#4ecca3' : 'transparent'}`,
    color: active ? '#4ecca3' : '#555',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  }),
  mobileEval: {
    flex: 1.4,
    padding: '12px 0 10px',
    background: 'rgba(78,204,163,0.12)',
    border: 'none',
    borderTop: '2px solid #4ecca3',
    color: '#4ecca3',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 700,
  },
  mobileStop: (disabled) => ({
    flex: 1.4,
    padding: '12px 0 10px',
    background: disabled ? 'transparent' : 'rgba(233,69,96,0.12)',
    border: 'none',
    borderTop: `2px solid ${disabled ? '#333' : '#e94560'}`,
    color: disabled ? '#444' : '#e94560',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 700,
  }),
};

// CSS injected into the help iframe to highlight clickable code blocks.
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
  const [showPost, setShowPost]   = useState(true);
  const [showHelp, setShowHelp]   = useState(false);
  const [mobileTab, setMobileTab] = useState('editor');
  const mobile     = useMobile();
  const wsRef      = useRef(null);
  const postRef    = useRef(null);
  const iframeRef  = useRef(null);
  const editorRef  = useRef(null);
  const audioRef   = useRef(null);
  const reconnect  = useRef(true);

  // Auto-scroll post window
  useEffect(() => {
    if (postRef.current) {
      postRef.current.scrollTop = postRef.current.scrollHeight;
    }
  }, [output]);

  // ── Live-edge nudge ──────────────────────────────────────────────────────────
  useEffect(() => {
    let lastSeek = 0;
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused || !audio.buffered.length) return;
      const buf      = audio.buffered;
      const liveEdge = buf.end(buf.length - 1);
      const now      = Date.now();
      if (liveEdge - audio.currentTime > 6 && now - lastSeek > 8000) {
        lastSeek = now;
        audio.muted = true;
        audio.currentTime = liveEdge - 2;
        setTimeout(() => { audio.muted = false; }, 500);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // WebSocket lifecycle
  useEffect(() => {
    function connect() {
      if (!reconnect.current) return;
      const url = `ws://${window.location.host}/ws`;
      const ws  = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen  = () => { setConnected(true);  append('Bridge connected.\n'); };
      ws.onclose = () => {
        setConnected(false);
        append('\n[disconnected — retrying in 3 s…]\n');
        setTimeout(connect, 3000);
      };
      ws.onerror   = () => { append('[ws error]\n'); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'post')   append(msg.text);
          if (msg.type === 'status') setConnected(msg.connected);
        } catch { /* ignore */ }
      };
    }
    connect();
    return () => { reconnect.current = false; wsRef.current?.close(); };
  }, []);

  const append = (text) => setOutput((prev) => prev + text);

  const send = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  // ── Eval ──────────────────────────────────────────────────────────────────────
  const handleEval = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    let from, to, code;
    if (sel.empty) {
      ({ from, to, code } = findBlockToEval(view.state.doc.toString(), sel.head));
    } else {
      from = sel.from; to = sel.to;
      code = view.state.doc.sliceString(from, to);
    }
    if (!code.trim()) return;
    send('eval', { code });
    view.dispatch({ effects: flashEffect.of({ from, to }) });
    setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 300);
  }, [send]);

  const handleStop  = useCallback(() => send('stop'), [send]);
  const handleClear = () => setOutput('');

  // On mobile, tapping Eval switches to the Post tab so output is visible
  const handleMobileEval = useCallback(() => {
    handleEval();
    setMobileTab('post');
  }, [handleEval]);

  const scExecKeymap = useMemo(() => keymap.of([
    { key: 'Ctrl-Enter', run: () => { handleEval(); return true; }, preventDefault: true },
    { key: 'Ctrl-e',     run: () => { handleEval(); return true; }, preventDefault: true },
    { key: 'Ctrl-.',     run: () => { handleStop(); return true; }, preventDefault: true },
  ]), [handleEval, handleStop]);

  // ── Help iframe injection ─────────────────────────────────────────────────────
  // We need to inject click handlers whenever the iframe's document is accessible.
  // On iOS, contentDocument is null while the iframe is hidden (display:none), so
  // onLoad alone isn't enough — we also re-inject when the help panel becomes visible.
  //
  // A ref-based callback is used so click handlers always see the current `mobile`
  // value without needing to be re-attached when it changes.
  const onHelpCodeClick = useRef(null);
  onHelpCodeClick.current = (code) => {
    setCode(code);
    if (mobile) setMobileTab('editor');
  };

  const injectHelpHandlers = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc?.body) return;

      // Inject highlight CSS (once per document)
      if (!doc.getElementById('sc-web-help-css')) {
        const style = doc.createElement('style');
        style.id = 'sc-web-help-css';
        style.textContent = HELP_INJECT_CSS;
        doc.head?.appendChild(style);
      }

      // Attach one delegated listener per document (idempotent via flag)
      if (!doc.body.dataset.scWired) {
        doc.body.dataset.scWired = '1';
        doc.addEventListener('click', (e) => {
          const container = e.target.closest('div.codeMirrorContainer');
          if (!container) return;
          const ta = container.querySelector('textarea.editor');
          if (ta) onHelpCodeClick.current(ta.value.trim());
        });
      }
    } catch (_) { /* cross-origin navigation — ignore */ }
  }, []);

  // Fire on iframe page load and whenever the help panel becomes visible
  const handleHelpLoad = useCallback(() => {
    injectHelpHandlers();
  }, [injectHelpHandlers]);

  // ── Derived visibility ────────────────────────────────────────────────────────
  const editorVisible = !mobile || mobileTab === 'editor';
  const postVisible   = mobile ? mobileTab === 'post' : showPost;
  const helpVisible   = mobile ? mobileTab === 'help' : showHelp;

  useEffect(() => {
    if (helpVisible) injectHelpHandlers();
  }, [helpVisible, injectHelpHandlers]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      {/* ── Toolbar ── */}
      <div style={S.toolbar}>
        <span style={S.title}>SC Web</span>
        <span style={S.dot(connected)}>
          {connected ? '● connected' : '○ disconnected'}
        </span>

        {/* Eval / Stop — desktop only; mobile uses the bottom bar */}
        {!mobile && <>
          <button
            style={S.btn('#4ecca3', !connected)}
            disabled={!connected}
            onClick={handleEval}
            title="Ctrl+Enter — eval current block or selection"
          >Eval</button>
          <button
            style={S.btn('#e94560', !connected)}
            disabled={!connected}
            onClick={handleStop}
            title="Ctrl+. — CmdPeriod (silence all)"
          >Stop</button>
        </>}

        <button style={S.btn('#888', false)} onClick={handleClear}>Clear post</button>

        {/* Post / Help toggles — desktop only */}
        {!mobile && <>
          <button style={S.btnToggle(showPost)} onClick={() => setShowPost(v => !v)}>Post</button>
          <button style={S.btnToggle(showHelp)} onClick={() => setShowHelp(v => !v)}>Help</button>
        </>}

        <audio
          ref={audioRef}
          controls
          src="/stream"
          style={S.audio}
          title="Live stream from scsynth"
        />
      </div>

      {/* ── Body ── */}
      <div style={S.body}>

        {/* Editor */}
        <div style={{ ...S.editor, display: editorVisible ? 'flex' : 'none', flexDirection: 'column' }}>
          <CodeMirror
            value={code}
            theme={oneDark}
            height="100%"
            style={{ height: '100%' }}
            extensions={[supercollider, scExecKeymap, flashField, flashTheme]}
            onCreateEditor={(view) => { editorRef.current = view; }}
            onChange={setCode}
          />
        </div>

        {/* Post panel */}
        <div style={{
          ...(mobile ? S.mobilePanel : S.postPanel),
          display: postVisible ? 'flex' : 'none',
        }}>
          <div ref={postRef} style={S.post}>{output}</div>
        </div>

        {/* Help panel */}
        <div style={{
          ...(mobile ? S.mobilePanel : S.helpPanel),
          display: helpVisible ? 'flex' : 'none',
        }}>
          <iframe
            ref={iframeRef}
            src="/help/"
            style={S.helpFrame}
            onLoad={handleHelpLoad}
            title="SuperCollider Help"
          />
        </div>

      </div>

      {/* ── Mobile bottom bar ── */}
      {mobile && (
        <div style={S.mobileBar}>
          <button style={S.mobileNavBtn(mobileTab === 'editor')} onClick={() => setMobileTab('editor')}>
            Editor
          </button>
          <button style={S.mobileNavBtn(mobileTab === 'post')} onClick={() => setMobileTab('post')}>
            Post
          </button>
          <button style={S.mobileNavBtn(mobileTab === 'help')} onClick={() => setMobileTab('help')}>
            Help
          </button>
          <button
            style={S.mobileEval}
            disabled={!connected}
            onClick={handleMobileEval}
          >
            Eval ▶
          </button>
          <button
            style={S.mobileStop(!connected)}
            disabled={!connected}
            onClick={handleStop}
          >
            ■ Stop
          </button>
        </div>
      )}
    </div>
  );
}
