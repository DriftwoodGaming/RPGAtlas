/* RPGAtlas — src/shared/formula.ts
   Project Compass M3·A: the sandboxed damage-formula evaluator (decision D1,
   signed with gate amendments a+b) and the pure MZ damage pipeline. Imported
   RPG Maker formulas ("a.atk * 4 - b.def * 2") are FOREIGN bulk data, so they
   are parsed into a restricted AST and walked — never executed as code. The
   grammar is a closed whitelist: numbers, parens, + - * / %, unary minus,
   comparisons, ternary, `a.<stat>`/`b.<stat>` facade reads, `v[n]` variable
   reads, nine Math functions, and (post-2.0) tabletop dice — the `2d6` /
   `4d6kh3` literal plus `roll(count, sides)`. Everything else (assignment,
   strings, `&&`/`||`, unknown identifiers/properties) is a parse REJECT:
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

/** The read-only battler stats a formula may read off `a`/`b`. `luk` joined
 *  post-1.1 when Luck became a real Atlas param (D7 retired) — the stat list
 *  tracks the engine's param set; the grammar itself is unchanged (still D1). */
export const FORMULA_STATS = [
  "atk", "def", "mat", "mdf", "agi", "mhp", "mmp", "hp", "mp", "level", "luk",
] as const;

/** The whitelisted Math functions ([fn, min arity, max arity]). */
const MATH_FNS: Record<string, [number, number]> = {
  min: [1, 8], max: [1, 8], floor: [1, 1], ceil: [1, 1], round: [1, 1],
  abs: [1, 1], pow: [2, 2], sqrt: [1, 1], randomInt: [1, 1],
};

// ---- Tabletop dice (post-2.0) ----------------------------------------------
// D&D notation is the one bit of "formula" most newcomers already know, so it
// is grammar, not a Math function: `2d6`, `d20`, `4d6kh3` (keep the highest
// three — the classic stat roll), `2d20kh1` (advantage), `2d20kl1`
// (disadvantage). Every die is ONE draw from the injected randomInt, so seeded
// runs replay exactly and a formula WITHOUT dice consumes no draws at all
// (the draw-conservation contract — pre-dice projects stay byte-identical).
// `roll(count, sides)` is the same roll with computed operands, for the
// level-scaling case (`roll(a.level, 6)`) a literal can't express.

/** Sanity caps. A kid typing 99999d99999 gets a plain-language reject, not a
 *  frozen tab; the function form clamps instead (its operands aren't known
 *  until run time). */
export const DICE_MAX_COUNT = 100;
export const DICE_MAX_SIDES = 1000;

/** A dice literal at `src[i]`, or null. Count defaults to 1 (`d20`); the
 *  optional `kh`/`kl` tail keeps the highest/lowest N of the roll. */
function matchDice(src: string, i: number): { count: number; sides: number; keep: number; keepHigh: boolean; len: number } | string | null {
  const m = /^(\d+)?[dD](\d+)(?:[kK]([hHlL])(\d+))?/.exec(src.slice(i));
  if (!m) return null;
  // `d6x` / `2d6foo` is a typo, not a roll — say so instead of silently
  // tokenizing a stray identifier next to it.
  const after = src[i + m[0].length];
  if (after && /[A-Za-z0-9_$]/.test(after))
    return `"${m[0]}${after}" isn't a dice roll — write it like 2d6, d20 or 4d6kh3`;
  const count = m[1] == null ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const keepHigh = !m[3] || m[3].toLowerCase() === "h";
  const keep = m[4] == null ? 0 : parseInt(m[4], 10);
  if (count < 1 || count > DICE_MAX_COUNT)
    return `"${m[0]}" rolls too many dice (1–${DICE_MAX_COUNT} please)`;
  if (sides < 1 || sides > DICE_MAX_SIDES)
    return `"${m[0]}" uses a die with too many sides (1–${DICE_MAX_SIDES} please)`;
  if (m[4] != null && (keep < 1 || keep > count))
    return `"${m[0]}" can only keep 1–${count} of the ${count} dice it rolls`;
  return { count, sides, keep, keepHigh, len: m[0].length };
}

/** Roll `count` dice with `sides` faces, optionally keeping the highest or
 *  lowest `keep` of them, and sum. One randomInt draw per die, always in
 *  roll order, so the stream is identical however the dice are kept. */
function rollDice(
  count: number,
  sides: number,
  keep: number,
  keepHigh: boolean,
  randomInt: (n: number) => number,
): number {
  const n = Math.min(DICE_MAX_COUNT, Math.floor(count) || 0);
  const faces = Math.min(DICE_MAX_SIDES, Math.max(1, Math.floor(sides) || 1));
  if (n < 1) return 0;
  const rolls: number[] = [];
  for (let i = 0; i < n; i++) rolls.push(randomInt(faces) + 1);
  const k = Math.min(n, Math.floor(keep) || 0);
  if (k > 0 && k < n) {
    rolls.sort((x, y) => (keepHigh ? y - x : x - y));
    rolls.length = k;
  }
  return rolls.reduce((s, r) => s + r, 0);
}

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
  /** `2d6` / `4d6kh3` / `roll(n, sides)` — count and sides are nodes so the
   *  function form can compute them; the literal form fills them with nums. */
  | { k: "dice"; count: Node; sides: Node; keep: Node | null; keepHigh: boolean }
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

interface Tok {
  t: string;
  v?: string | number;
  /** t === "dice": the decoded literal (see matchDice). */
  dice?: { count: number; sides: number; keep: number; keepHigh: boolean };
}

const PUNCT = ["===", "!==", "<=", ">=", "==", "!=", "<", ">",
  "+", "-", "*", "/", "%", "(", ")", "[", "]", ".", ",", "?", ":"];

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    // Dice come first: `2d6` must not tokenize as the number 2 followed by an
    // identifier `d6`, and `d20` must not become a bare identifier. A stat
    // read like `a.def` is untouched — the letter after `d` isn't a digit.
    const dice = matchDice(src, i);
    if (typeof dice === "string") return dice;
    if (dice) {
      out.push({ t: "dice", dice: { count: dice.count, sides: dice.sides, keep: dice.keep, keepHigh: dice.keepHigh } });
      i += dice.len;
      continue;
    }
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
  /** How a token reads in an error message (a dice token has no literal text). */
  const label = (tok: Tok): string =>
    tok.t === "dice"
      ? `${tok.dice!.count}d${tok.dice!.sides}`
      : tok.t === "num" || tok.t === "id"
        ? String(tok.v)
        : tok.t;

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
      if (tok.t === "dice") {
        const d = tok.dice!;
        return {
          k: "dice",
          count: { k: "num", n: d.count },
          sides: { k: "num", n: d.sides },
          keep: d.keep > 0 ? { k: "num", n: d.keep } : null,
          keepHigh: d.keepHigh,
        };
      }
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
          : `unexpected "${label(tok)}" in the formula`;
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
      // `roll(count, sides)` — the dice literal with computed operands, for
      // rolls that scale ("roll(a.level, 6)"). Out-of-range operands clamp at
      // run time rather than rejecting: the author can't be asked to prove a
      // variable stays under 100.
      if (name === "roll") {
        const e = expect("(");
        if (e) return 'roll needs two values, like roll(3, 6) for "three six-sided dice"';
        const count = ternary();
        if (typeof count === "string") return count;
        const e2 = expect(",");
        if (e2) return 'roll needs the number of dice AND their sides, like roll(3, 6)';
        const sides = ternary();
        if (typeof sides === "string") return sides;
        const e3 = expect(")");
        if (e3) return e3;
        return { k: "dice", count, sides, keep: null, keepHigh: true };
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
      return `"${name}" isn't something a damage formula can use (only a, b, v, Math, roll and dice like 2d6)`;
    } finally { leave(); }
  }

  const root = ternary();
  if (typeof root === "string") return root;
  if (peek().t !== "end") return `the formula has extra "${label(peek())}" at the end`;
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
    case "dice":
      return rollDice(
        run(n.count, env),
        run(n.sides, env),
        n.keep ? run(n.keep, env) : 0,
        n.keepHigh,
        env.randomInt,
      );
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
