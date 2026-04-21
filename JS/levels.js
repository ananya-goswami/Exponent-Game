/* ------------------------------------------------------------------
   levels.js — Exponent puzzle levels
   Each authored level declares only { id, base, exponent }.
   Everything the engine expects (source/target/allowedMultipliers/
   correctSequence) is DERIVED at load time so the game loop stays
   untouched.

     source            always 1 — the "seed" that exponent grows from
     target            base^exponent
     allowedMultipliers  [base] — only one base per level (Pattern A)
     correctSequence   [base, base, ...] (length = exponent)

   Pedagogy: each tap applies "× base", and the answer chip shows
   base^n with a superscript that bumps up. When n === exponent, the
   answer equals the target and the puzzle is solved.
   ------------------------------------------------------------------ */

const RAW_LEVELS = [
  // Tutorial: one tap
  { id: 1, base: 2, exponent: 1 },   // 2¹ = 2
  { id: 2, base: 2, exponent: 2 },   // 2² = 4
  { id: 3, base: 2, exponent: 3 },   // 2³ = 8
  { id: 4, base: 3, exponent: 2 },   // 3² = 9
  { id: 5, base: 2, exponent: 4 },   // 2⁴ = 16
  { id: 6, base: 5, exponent: 2 },   // 5² = 25
  { id: 7, base: 3, exponent: 3 },   // 3³ = 27
  { id: 8, base: 2, exponent: 5 },   // 2⁵ = 32
  { id: 9, base: 4, exponent: 3 },   // 4³ = 64
  { id: 10, base: 3, exponent: 4 }   // 3⁴ = 81
];

window.LEVELS = RAW_LEVELS.map((lv) => ({
  ...lv,
  source: 1,
  target: Math.pow(lv.base, lv.exponent),
  allowedMultipliers: [lv.base],
  correctSequence: Array(lv.exponent).fill(lv.base),
  maxSteps: lv.exponent + 1,         // allow one overshoot before requiring undo
  strictSequence: false,
  patternMode: "power"
}));
