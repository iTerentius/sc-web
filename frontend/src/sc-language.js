/**
 * SuperCollider (sclang) language mode for CodeMirror 6.
 *
 * Implements:
 *  - Syntax highlighting via StreamLanguage
 *  - Ctrl+/ line-comment toggle (reads languageData.commentTokens)
 *
 * Token → highlight tag mapping (CM6 StreamLanguage):
 *   "comment"      → tags.comment       (gray)
 *   "string"       → tags.string        (green)
 *   "atom"         → tags.atom          (symbol literals, nil/true/false/inf/pi)
 *   "keyword"      → tags.keyword       (var/arg/if/while/…)
 *   "number"       → tags.number        (orange)
 *   "typeName"     → tags.typeName      (UppercaseClasses → cyan/teal)
 *   "variableName" → tags.variableName  (lowercase identifiers)
 *   "operator"     → tags.operator
 */
import { StreamLanguage } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { toggleLineComment } from '@codemirror/commands';

// ── Token sets ────────────────────────────────────────────────────────────────

// Declaration and control-flow keywords, plus self-reference
const KEYWORDS = new Set([
  'var', 'arg', 'classvar',
  'this', 'super',
  // Control-flow methods — technically message sends, but read like keywords
  'if', 'while', 'for', 'forBy', 'loop', 'do',
  'collect', 'select', 'reject', 'detect', 'inject',
  'switch', 'case', 'try', 'protect',
  'fork', 'wait',
]);

// Atomic literals and pseudo-variables
const ATOMS = new Set([
  'nil', 'true', 'false',
  'inf', 'pi',
  'thisProcess', 'thisThread', 'currentEnvironment', 'topEnvironment',
]);

// ── StreamParser ───────────────────────────────────────────────────────────────

const scParser = {
  name: 'supercollider',

  startState: () => ({ blockDepth: 0 }),

  token(stream, state) {
    // ── Continue a multi-line block comment ──────────────────────────────────
    // SC supports nested block comments: /* /* nested */ still open */
    if (state.blockDepth > 0) {
      while (!stream.eol()) {
        if      (stream.match('/*')) { state.blockDepth++; }
        else if (stream.match('*/')) { if (--state.blockDepth === 0) break; }
        else    stream.next();
      }
      return 'comment';
    }

    if (stream.eatSpace()) return null;

    // ── Line comment ─────────────────────────────────────────────────────────
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }

    // ── Block comment (possibly nested) ──────────────────────────────────────
    if (stream.match('/*')) {
      state.blockDepth = 1;
      while (!stream.eol()) {
        if      (stream.match('/*')) { state.blockDepth++; }
        else if (stream.match('*/')) { if (--state.blockDepth === 0) break; }
        else    stream.next();
      }
      return 'comment';
    }

    const ch = stream.next();
    if (ch === null) return null;

    // ── Double-quoted string ──────────────────────────────────────────────────
    if (ch === '"') {
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\') stream.next(); // escape
        else if (c === '"') break;
      }
      return 'string';
    }

    // ── Single-quoted symbol: 'mySymbol' ─────────────────────────────────────
    if (ch === "'") {
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\') stream.next();
        else if (c === "'") break;
      }
      return 'atom';
    }

    // ── Character literal: $A ─────────────────────────────────────────────────
    if (ch === '$') { stream.next(); return 'string'; }

    // ── Backslash symbol: \mySymbol ───────────────────────────────────────────
    if (ch === '\\') { stream.eatWhile(/[\w_]/); return 'atom'; }

    // ── Number: integer, float, hex (0xFF), radix (16rFF), scientific ─────────
    if (/\d/.test(ch)) {
      if (ch === '0' && stream.eat('x')) {
        stream.eatWhile(/[0-9a-fA-F]/);
      } else {
        stream.eatWhile(/\d/);
        if (stream.eat('r')) {
          // Radix literal e.g. 2r1010, 16rFF
          stream.eatWhile(/[0-9a-zA-Z]/);
        } else {
          // Optional decimal part
          if (stream.eat('.') && /\d/.test(stream.peek())) stream.eatWhile(/\d/);
          // Optional exponent
          if (stream.eat('e') || stream.eat('E')) {
            stream.eat('+') || stream.eat('-');
            stream.eatWhile(/\d/);
          }
        }
      }
      return 'number';
    }

    // ── Identifier → keyword / atom / UppercaseClass / variable ──────────────
    if (/[a-zA-Z_]/.test(ch)) {
      stream.eatWhile(/[\w_]/);
      const word = stream.current();
      if (KEYWORDS.has(word)) return 'keyword';
      if (ATOMS.has(word))    return 'atom';
      if (/^[A-Z]/.test(ch)) return 'typeName';       // SinOsc, Pbind, …
      return 'variableName';
    }

    // ── Environment variable: ~name ───────────────────────────────────────────
    if (ch === '~' && /[a-zA-Z_]/.test(stream.peek())) {
      stream.eatWhile(/[\w_]/);
      return 'variableName';
    }

    // ── Operators ─────────────────────────────────────────────────────────────
    if (/[+\-*=<>!&|%^@?]/.test(ch)) {
      stream.eatWhile(/[+\-*=<>!&|%^@?]/);
      return 'operator';
    }

    return null;
  },

  languageData: {
    // Used by toggleLineComment (and any bracket-match / indent extensions)
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
};

// ── Exports ───────────────────────────────────────────────────────────────────

export const scLanguage = StreamLanguage.define(scParser);

// Ctrl+/ → toggle line comments on selected lines
export const scKeymap = keymap.of([
  { key: 'Ctrl-/', run: toggleLineComment, preventDefault: true },
]);

// Single array to spread into CodeMirror's `extensions` prop
export const supercollider = [scLanguage, scKeymap];
