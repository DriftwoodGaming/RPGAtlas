/* RPGAtlas — src/shared/formula.ts
   Project Compass M3·A: the sandboxed damage-formula evaluator (decision D1,
   signed with gate amendments a+b) and the pure MZ damage pipeline. Imported
   RPG Maker formulas ("a.atk * 4 - b.def * 2") are FOREIGN bulk data, so they
   are parsed into a restricted AST and walked — never executed as code. The
   grammar is a closed whitelist: numbers, parens, + - * / %, unary minus,
   comparisons, ternary, `a.<stat>`/`b.<stat>` facade reads, `v[n]` variable
   reads, and nine Math functions. Everything else (assignment, strings,
   `&&`/`||`, unknown identifiers/properties, `a.luk` — D7) is a parse REJECT:
   the importer reports it and the engine falls back to structured power, never
   silently zero. Amendment (a): all randomness flows through an INJECTED
   `randomInt` (the engine passes the seedable `rnd`), so `?rngseed=` replays
   and the reference-vector vitest stay deterministic. Amendment (b): formulas
   over 512 chars or 32 nesting levels reject before parsing can hurt. The MZ
   pipeline helpers (`mzApplyVariance`/`mzDamageValue`/`mzHitRoll`) mirror
   Game_Action's order — element rate, crit ×3, variance, guard ÷2, round —
   with sp-params (pdr/mdr/rec/grd) fixed at 1 until M3·B. Pure module: no
   engine imports, no DOM, no ambient RNG. Copyright (C) 2026 RPGAtlas
   contributors — GPL-3.0-or-later (see LICENSE). */

// ---------------------------------------------------------------------------
// Grammar surface (decision D1 — do not widen without a new gate decision)
// ---------------------------------------------------------------------------

/** The read-only battler stats a formula may read off `a`/`b`. */
export const FORMULA_STATS = [
  "atk", "def", "mat", "mdf", "agi", "mhp", "mmp", "hp", "mp", "level",
] as const;

/** The whitelisted Math functions ([fn, min arity, max arity]). */
const MATH_FNS: Record<string, [number, number]> = {
  min: [1, 8], max: [1, 8], floor: [1, 1], ceil: [1, 1], round: [1, 1],
  abs: [1, 1], pow: [2, 2], sqrt: [1, 1], randomInt: [1, 1],
};

/** Gate amendment (b): input limits — over-limit takes the reject path. */
export const FORMULA_MAX_LENGTH = 512;
export const FORMULA_MAX_DEPTH = 32;

/** A battler facade: plain read-only numbers for the whitelisted stats. */
export type FormulaBattler = Readonly<Record<(typeof FORMULA_STATS)[number], number>>;

export interface FormulaEnv {
  a: FormulaBattler;
  b: FormulaBattler;
  /** Game-variable read — unset variables read 0 (friendlier than MZ's NaN). */
  v: (n: number) => number;
  /** Amendment (a): the ONLY randomness source (engine wires seedable rnd). */
  randomInt: (n: number) => number;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
  | { k: "num"; n: number }
  | { k: "stat"; who: "a" | "b"; stat: string }
  | { k: "var"; index: Node }
  | { k: "math"; fn: string; args: Node[] }
  | { k: "un"; node: Node } // unary minus
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "tern"; c: Node; t: Node; f: Node };

export interface CompiledFormula {
  /** The original source string (verbatim, for provenance/round-trips). */
  src: string;
  eval(env: FormulaEnv): number;
}

export type ParseResult =
  | { ok: true; formula: CompiledFormula }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface Tok { t: string; v?: string | number }

const PUNCT = ["===", "!==", "<=", ">=", "==", "!=", "<", ">",
  "+", "-", "*", "/", "%", "(", ")", "[", "]", ".", ",", "?", ":"];

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c >= "0" && c <= "9" || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) return "that number doesn't look right";
      out.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((s) => src.startsWith(s, i));
    if (!p) return `the character "${c}" isn't part of a damage formula`;
    out.push({ t: p });
    i += p.length;
  }
  out.push({ t: "end" });
  return out;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent, precedence: ternary > equality > relational >
// additive > multiplicative > unary > member/call > primary.
// ---------------------------------------------------------------------------

function parse(src: string): Node | string {
  if (typeof src !== "string" || !src.trim()) return "the formula is empty";
  if (src.length > FORMULA_MAX_LENGTH)
    return `the formula is too long (over ${FORMULA_MAX_LENGTH} characters)`;
  const toks = tokenize(src);
  if (typeof toks === "string") return toks;
  let pos = 0;
  let depth = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const expect = (t: string): string | null =>
    next().t === t ? null : `expected "${t}" in the formula`;

  function enter(): string | null {
    if (++depth > FORMULA_MAX_DEPTH)
      return `the formula nests too deep (over ${FORMULA_MAX_DEPTH} levels)`;
    return null;
  }
  const leave = () => void depth--;

  function ternary(): Node | string {
    const err = enter();
    if (err) return err;
    try {
      const c = equality();
      if (typeof c === "string") return c;
      if (peek().t !== "?") return c;
      next();
      const t = ternary();
      if (typeof t === "string") return t;
      const e = expect(":");
      if (e) return e;
      const f = ternary();
      if (typeof f === "string") return f;
      return { k: "tern", c, t, f };
    } finally { leave(); }
  }

  function binLevel(ops: string[], sub: () => Node | string): Node | string {
    let l = sub();
    if (typeof l === "string") return l;
    while (ops.includes(peek().t)) {
      const op = next().t;
      const r = sub();
      if (typeof r === "string") return r;
      l = { k: "bin", op, l, r };
    }
    return l;
  }

  const equality = () => binLevel(["==", "!=", "===", "!=="], relational);
  const relational = () => binLevel(["<", "<=", ">", ">="], additive);
  const additive = () => binLevel(["+", "-"], multiplicative);
  const multiplicative = () => binLevel(["*", "/", "%"], unary);

  function unary(): Node | string {
    if (peek().t === "-") {
      next();
      const err = enter();
      if (err) return err;
      try {
        const n = unary();
        if (typeof n === "string") return n;
        return { k: "un", node: n };
      } finally { leave(); }
    }
    return primary();
  }

  function primary(): Node | string {
    const err = enter();
    if (err) return err;
    try {
      const tok = next();
      if (tok.t === "num") return { k: "num", n: tok.v as number };
      if (tok.t === "(") {
        const inner = ternary();
        if (typeof inner === "string") return inner;
        const e = expect(")");
        if (e) return e;
        return inner;
      }
      if (tok.t !== "id")
        return tok.t === "end"
          ? "the formula ends too soon"
          : `unexpected "${tok.t}" in the formula`;
      const name = tok.v as string;
      if (name === "a" || name === "b") {
        const e = expect(".");
        if (e) return `"${name}" needs a stat after it, like ${name}.atk`;
        const prop = next();
        if (prop.t !== "id" || !(FORMULA_STATS as readonly string[]).includes(prop.v as string))
          return `"${name}.${prop.t === "id" ? prop.v : "?"}" isn't a stat a formula can read (try ${FORMULA_STATS.join("/")})`;
        return { k: "stat", who: name, stat: prop.v as string };
      }
      if (name === "v") {
        const e = expect("[");
        if (e) return '"v" needs a variable number, like v[3]';
        const idx = ternary();
        if (typeof idx === "string") return idx;
        const e2 = expect("]");
        if (e2) return e2;
        return { k: "var", index: idx };
      }
      if (name === "Math") {
        const e = expect(".");
        if (e) return '"Math" needs a function after it, like Math.floor(…)';
        const fn = next();
        if (fn.t !== "id" || !MATH_FNS[fn.v as string])
          return `"Math.${fn.t === "id" ? fn.v : "?"}" isn't one of the allowed Math functions (${Object.keys(MATH_FNS).join("/")})`;
        const e2 = expect("(");
        if (e2) return `Math.${fn.v} needs parentheses, like Math.${fn.v}(…)`;
        const args: Node[] = [];
        if (peek().t !== ")") {
          for (;;) {
            const arg = ternary();
            if (typeof arg === "string") return arg;
            args.push(arg);
            if (peek().t !== ",") break;
            next();
          }
        }
        const e3 = expect(")");
        if (e3) return e3;
        const [lo, hi] = MATH_FNS[fn.v as string];
        if (args.length < lo || args.length > hi)
          return `Math.${fn.v} takes ${lo === hi ? lo : lo + "–" + hi} value${hi > 1 ? "s" : ""}`;
        return { k: "math", fn: fn.v as string, args };
      }
      return `"${name}" isn't something a damage formula can use (only a, b, v and Math)`;
    } finally { leave(); }
  }

  const root = ternary();
  if (typeof root === "string") return root;
  if (peek().t !== "end") return `the formula has extra "${peek().t}" at the end`;
  return root;
}

// ---------------------------------------------------------------------------
// Evaluator — a plain AST walk; every leaf is a number by construction.
// ---------------------------------------------------------------------------

function run(n: Node, env: FormulaEnv): number {
  switch (n.k) {
    case "num": return n.n;
    case "stat": return Number(env[n.who][n.stat as (typeof FORMULA_STATS)[number]]) || 0;
    case "var": return Number(env.v(run(n.index, env))) || 0;
    case "un": return -run(n.node, env);
    case "tern": return run(n.c, env) ? run(n.t, env) : run(n.f, env);
    case "math": {
      const args = n.args.map((x) => run(x, env));
      if (n.fn === "randomInt") return env.randomInt(Math.max(0, Math.floor(args[0])));
      return (Math as unknown as Record<string, (...xs: number[]) => number>)[n.fn](...args);
    }
    case "bin": {
      const l = run(n.l, env), r = run(n.r, env);
      switch (n.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return l / r;
        case "%": return l % r;
        case "<": return l < r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        case "==": case "===": return l === r ? 1 : 0;
        default: return l !== r ? 1 : 0; // "!=" / "!=="
      }
    }
  }
}

/** Parse a formula string. `ok:false` carries a plain-language reason the
 *  import report can show a kid ("never silently zero", D1). */
export function parseFormula(src: string): ParseResult {
  const root = parse(src);
  if (typeof root === "string") return { ok: false, error: root };
  return {
    ok: true,
    formula: {
      src,
      eval(env: FormulaEnv): number {
        // MZ boundary semantics: Math.max(eval, 0), NaN → 0 — plus ±Infinity
        // → 0 (kid-friendlier than MZ's infinite hit from a divide-by-zero).
        // The sign for heals/drains is applied by the caller.
        const value = run(root, env);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
      },
    },
  };
}

// Compile cache — formulas are few and repeat every battle turn.
const cache = new Map<string, CompiledFormula | null>();

/** Cached compile: a usable formula or null (reject / empty / "0" noise).
 *  Runtime callers treat null as "fall back to structured power". */
export function getFormula(src: unknown): CompiledFormula | null {
  if (typeof src !== "string" || !src.trim() || src.trim() === "0") return null;
  let hit = cache.get(src);
  if (hit === undefined) {
    if (cache.size > 256) cache.clear();
    const res = parseFormula(src);
    hit = res.ok ? res.formula : null;
    cache.set(src, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// The MZ damage pipeline (Game_Action order) — pure, RNG injected.
// ---------------------------------------------------------------------------

/** MZ Game_Action.applyVariance, verbatim math. `randomInt(n)` → [0, n). */
export function mzApplyVariance(
  damage: number,
  variancePct: number,
  randomInt: (n: number) => number,
): number {
  const amp = Math.floor(Math.max((Math.abs(damage) * variancePct) / 100, 0));
  const v = randomInt(amp + 1) + randomInt(amp + 1) - amp;
  return damage >= 0 ? damage + v : damage - v;
}

export interface MzDamageArgs {
  /** evalDamageFormula result — already ≥ 0 (heal sign handled by caller). */
  base: number;
  /** Target-side element multiplier (1 = neutral). */
  elementRate: number;
  /** Crit already ROLLED by the caller; true applies MZ's ×3. */
  critical: boolean;
  /** damage.variance percent (0–100). */
  variance: number;
  /** Target is guarding → MZ applyGuard ÷ (2 × grd). */
  guarding: boolean;
  randomInt: (n: number) => number;
  /** M3·B sp-params (optional — absent keeps the M3·A behavior exactly):
   *  target pdr/mdr for damage or rec for heals, applied after the element
   *  rate like MZ makeDamageValue. */
  dmgRate?: number;
  /** Target grd (guardEffect rate) — deepens the guard divisor (M3·B). */
  grd?: number;
}

/** MZ Game_Action.makeDamageValue:
 *  base × elementRate × (pdr/mdr/rec) → crit ×3 → variance → guard ÷(2·grd) →
 *  round. Can legitimately return 0 (MZ shows a 0-damage hit). */
export function mzDamageValue(args: MzDamageArgs): number {
  let value = args.base * args.elementRate;
  if (args.dmgRate != null) value *= args.dmgRate;
  if (args.critical) value *= 3;
  value = mzApplyVariance(value, args.variance, args.randomInt);
  if (value > 0 && args.guarding) value /= 2 * Math.max(0.01, args.grd == null ? 1 : args.grd);
  return Math.round(value);
}

export interface MzHitArgs {
  /** Attacker hit% (MZ-additive trait sum), or null = no hit traits at all —
   *  the Atlas-native case: never misses, and NO draw is consumed. */
  hitPct: number | null;
  /** Defender evade% — ≤ 0 consumes no draw (Atlas-native case). */
  evadePct: number;
  /** Uniform [0,1) from the seedable stream. */
  rndf: () => number;
}

/** MZ Game_Action.apply's to-hit sequence (miss roll, then evade roll) with
 *  draw conservation: a roll only happens when the chance is real, so native
 *  projects' seeded RNG streams are byte-identical to pre-M3·A. */
export function mzHitRoll(args: MzHitArgs): "hit" | "miss" | "evade" {
  if (args.hitPct != null && args.rndf() >= args.hitPct / 100) return "miss";
  if (args.evadePct > 0 && args.rndf() < args.evadePct / 100) return "evade";
  return "hit";
}
