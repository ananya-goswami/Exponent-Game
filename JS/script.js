/* ==================================================================
   script.js — Multiplication Puzzle Game
   Vanilla JS. Relies on levels.js (window.LEVELS).
   ================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------
     Sound engine — Web Audio synth, no external assets.
     First play lazily creates the AudioContext so browser autoplay
     policies are respected. Each helper is one short, cheerful sound.
     ------------------------------------------------------------ */
  const audio = (function () {
    let ctx = null;
    let muted = false;

    function getCtx() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    // A single enveloped tone. Optional `fromFreq` makes it a pitch slide.
    function tone(freq, duration, opts) {
      if (muted) return;
      const c = getCtx(); if (!c) return;
      const o = opts || {};
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = o.type || "sine";
      if (o.fromFreq != null) {
        osc.frequency.setValueAtTime(o.fromFreq, t0);
        osc.frequency.exponentialRampToValueAtTime(freq, t0 + duration);
      } else {
        osc.frequency.setValueAtTime(freq, t0);
      }
      const vol = o.vol != null ? o.vol : 0.18;
      const atk = o.attack != null ? o.attack : 0.005;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + atk);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }

    // Schedule a tone at a relative delay (ms) so arpeggios don't need setTimeout.
    function toneAt(delayMs, freq, duration, opts) {
      setTimeout(() => tone(freq, duration, opts), delayMs);
    }

    return {
      isMuted() { return muted; },
      setMuted(v) { muted = !!v; },
      toggleMuted() { muted = !muted; return muted; },

      // Playful rising pop on multiplier tap
      tap() {
        tone(1100, 0.09, { fromFreq: 600, type: "sine", vol: 0.22 });
      },

      // Magical "ding" when the exponent bumps up (arrives with the chip)
      bump(exp) {
        // Higher exponents ding a little higher — builds the sense of climbing
        const base = 1175;                  // D6
        const f = base * Math.pow(1.122, Math.max(0, exp - 1)); // up a semitone each step
        tone(f,        0.18, { type: "triangle", vol: 0.17 });
        tone(f * 1.5,  0.22, { type: "sine",     vol: 0.08, attack: 0.02 });
      },

      // Ascending major arpeggio on correct answer — C5, E5, G5, C6
      correct() {
        const n = [523.25, 659.25, 783.99, 1046.50];
        n.forEach((f, i) => toneAt(i * 75, f, 0.28, { type: "triangle", vol: 0.2 }));
      },

      // Funny sad-trombone descending slide on wrong answer
      wrong() {
        tone(185, 0.55, { fromFreq: 440, type: "sawtooth", vol: 0.16, attack: 0.03 });
        toneAt(120, 165, 0.45, { fromFreq: 392, type: "sawtooth", vol: 0.12, attack: 0.03 });
      },

      // Soft click on undo
      undo() {
        tone(380, 0.08, { fromFreq: 620, type: "sine", vol: 0.12 });
      },

      // Short UI click for buttons (pause, resume, next, etc.)
      click() {
        tone(820, 0.05, { type: "square", vol: 0.07 });
      },

      // Extended fanfare on full game completion
      celebrate() {
        const n = [523.25, 659.25, 783.99, 1046.50, 1318.51];
        n.forEach((f, i) => toneAt(i * 110, f, 0.36, { type: "triangle", vol: 0.22 }));
        toneAt(n.length * 110 + 40, 1568, 0.55, { type: "triangle", vol: 0.2, attack: 0.04 });
      }
    };
  })();

  /* ------------------------------------------------------------
     Configuration
     ------------------------------------------------------------ */
  const STAGE_W = 1280;
  const STAGE_H = 720;

  // Cluster container is 180x180 (see CSS). Layout coords are percentages
  // within that box so they scale uniformly.
  const CLUSTER_SIZE = 180;

  // Dot layout templates keyed by count. Each value is [x%, y%] inside the
  // cluster box. Hand-tuned for small counts so patterns read naturally.
  const CLUSTER_PATTERNS = {
    1:  [[50,50]],
    2:  [[50,32],[50,68]],
    3:  [[50,28],[32,66],[68,66]],
    4:  [[35,35],[65,35],[35,65],[65,65]],
    5:  [[50,50],[28,28],[72,28],[28,72],[72,72]],
    6:  [[33,33],[50,33],[67,33],[33,67],[50,67],[67,67]],
    7:  [[33,28],[50,28],[67,28],[50,50],[33,72],[50,72],[67,72]],
    // 2³ — two 2x2 squares side-by-side; the gap reveals "2 × 2²".
    8:  [[22,30],[42,30],[22,60],[42,60], [58,30],[78,30],[58,60],[78,60]],
    9:  [[30,30],[50,30],[70,30],[30,50],[50,50],[70,50],[30,70],[50,70],[70,70]],
    10: [[30,25],[50,25],[70,25],[30,45],[50,45],[70,45],[30,65],[50,65],[70,65],[50,85]]
  };

  // Edges (pairs of point indices) per count. Gives each number a readable
  // geometric shape — a thread through the beads — without adding clutter.
  // Edges are drawn behind the dots at low opacity.
  const CLUSTER_EDGES = {
    1:  [],
    2:  [[0,1]],
    3:  [[0,1],[1,2],[2,0]],                       // triangle
    4:  [[0,1],[1,3],[3,2],[2,0]],                 // square outline
    5:  [[0,1],[0,2],[0,3],[0,4]],                 // center spokes (quincunx)
    6:  [[0,1],[1,2],[3,4],[4,5],[0,3],[1,4],[2,5]], // 2x3 grid
    7:  [[0,1],[1,2],[1,3],[3,5],[4,5],[5,6]],     // top row, spine, bottom row
    // 2³ — two independent 2x2 squares; each outlined so the power structure reads
    8:  [[0,1],[1,3],[3,2],[2,0], [4,5],[5,7],[7,6],[6,4]],
    9:  [[0,1],[1,2],[2,5],[5,8],[8,7],[7,6],[6,3],[3,0],  // 3x3 ring
         [4,1],[4,3],[4,5],[4,7]],                 // + spokes from center
    10: [[0,1],[1,2],[2,5],[5,8],[8,9],[9,7],[7,6],[6,3],[3,0], // outer ring
         [4,1],[4,3],[4,5],[4,7]]                  // + center spokes
  };

  /* ------------------------------------------------------------
     Game state
     ------------------------------------------------------------ */
  const game = {
    levelIndex: 0,
    state: "loading",            // loading|ready|buildingAnswer|checking|correct|incorrect|levelComplete|paused|gameComplete
    selected: [],                // chosen multipliers (e.g. [2,2])
    currentSourceCount: 0,       // visual count (animates during solve)
    levels: window.LEVELS || []
  };

  /* ------------------------------------------------------------
     DOM references
     ------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const dom = {
    stage:          $("stage"),
    viewport:       $("viewport"),
    sourceCluster:  $("sourceCluster"),
    targetCluster:  $("targetCluster"),
    answerInner:    $("answerInner"),
    answerBar:      $("answerBar"),
    multipliers:    $("multipliers"),
    actionBtn:      $("actionBtn"),
    actionIcon:     $("actionIcon"),
    undoBtn:        $("undoBtn"),
    pauseBtn:       $("pauseBtn"),
    pauseModal:     $("pauseModal"),
    completeModal:  $("completeModal"),
    resumeBtn:      $("resumeBtn"),
    restartBtn:     $("restartBtn"),
    playAgainBtn:   $("playAgainBtn"),
    progressFill:   $("progressFill"),
    progressMarker: $("progressMarker"),
    flyChip:        $("flyChip"),
    toast:          $("toast"),
    penguinWalker:  $("penguinWalker"),
    targetLabel:    $("targetLabel"),
    winFlash:       $("winFlash"),
    levelBanner:    $("levelBanner"),
    tutorialModal:  $("tutorialModal"),
    tutorialStartBtn: $("tutorialStartBtn")
  };

  /* Unicode superscript glyphs for the target label (avoids font quirks
     around <sup> sizing at very small CSS sizes). */
  const SUPER = { 0:"⁰",1:"¹",2:"²",3:"³",4:"⁴",5:"⁵",6:"⁶",7:"⁷",8:"⁸",9:"⁹" };
  function toSuperscript(n) {
    return String(n).split("").map((d) => SUPER[d] || d).join("");
  }

  /* ------------------------------------------------------------
     Utility: scale fixed-size stage to fit window
     ------------------------------------------------------------ */
  function fitStage() {
    const sx = window.innerWidth  / STAGE_W;
    const sy = window.innerHeight / STAGE_H;
    const s = Math.min(sx, sy);
    dom.stage.style.transform = `scale(${s})`;
  }
  window.addEventListener("resize", fitStage);

  /* ------------------------------------------------------------
     Cluster rendering
     renderCluster(container, count, type)
       container: DOM element (cluster box)
       count: integer >= 0
       type: "source" | "target"
     ------------------------------------------------------------ */
  // Find factor pair (rows, cols) closest to a square — gives power structure
  // a clean grid read (e.g. 2⁴=16 → 4×4, 3³=27 → 3×9, 2⁵=32 → 4×8).
  function gridFactor(n) {
    let rows = 1;
    for (let r = Math.floor(Math.sqrt(n)); r >= 1; r--) {
      if (n % r === 0) { rows = r; break; }
    }
    return { rows, cols: n / rows };
  }

  function buildClusterLayout(count) {
    if (CLUSTER_PATTERNS[count]) return CLUSTER_PATTERNS[count].slice();
    const { rows, cols } = gridFactor(count);
    const pts = [];
    const stepX = 100 / (cols + 1);
    const stepY = 100 / (rows + 1);
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      pts.push([stepX * (c + 1), stepY * (r + 1)]);
    }
    return pts;
  }

  // Pick a bead scale that keeps dots inside their grid cells for dense
  // clusters (64, 81, …) while leaving small counts at their natural size.
  function computeDotScale(count) {
    if (count <= 9)  return 1;
    if (count <= 16) return 0.85;
    if (count <= 25) return 0.75;
    if (count <= 36) return 0.65;
    if (count <= 64) return 0.55;
    if (count <= 100) return 0.45;
    return 0.4;
  }

  // Compute grid-neighbor edges for auto-layout fallback (count > 10).
  // Connects each point to its right neighbor and its down neighbor.
  function buildGridEdges(count) {
    const cols = Math.ceil(Math.sqrt(count));
    const edges = [];
    for (let i = 0; i < count; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      if (c < cols - 1 && i + 1 < count)    edges.push([i, i + 1]);       // right
      if (i + cols < count)                 edges.push([i, i + cols]);    // down
    }
    return edges;
  }

  function renderCluster(container, count) {
    container.innerHTML = "";
    if (count <= 0) return;

    // Scale dots to fit dense grids (e.g. 8×8 = 64, 9×9 = 81).
    const dotScale = computeDotScale(count);

    const pts = buildClusterLayout(count);

    // --- Draw the connector "thread" (SVG) behind the dots ---
    const edges = CLUSTER_EDGES[count] || buildGridEdges(count);
    if (edges.length) {
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("class", "cluster__net");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      edges.forEach(([a, b], i) => {
        const [x1, y1] = pts[a];
        const [x2, y2] = pts[b];
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        // Lines appear just after the first few dots pop in
        line.style.animationDelay = (80 + i * 20) + "ms";
        svg.appendChild(line);
      });
      container.appendChild(svg);
    }

    // --- Draw the beads (dots) on top ---
    pts.forEach(([x, y], i) => {
      const dot = document.createElement("div");
      dot.className = "unit";
      dot.style.left = x + "%";
      dot.style.top  = y + "%";
      dot.style.transform = `translate(-50%, -50%) scale(${dotScale})`;
      dot.style.animationDelay = (i * 15) + "ms";
      // Per-bead index drives the staggered reveal on correct answers.
      dot.style.setProperty("--idx", i);
      container.appendChild(dot);
    });
  }

  /* ------------------------------------------------------------
     Level loading / rendering
     ------------------------------------------------------------ */
  function currentLevel() { return game.levels[game.levelIndex]; }

  function loadLevel(index) {
    if (index >= game.levels.length) {
      setGameState("gameComplete");
      return;
    }
    game.levelIndex = index;
    game.selected = [];
    game.currentSourceCount = currentLevel().source;
    renderLevel();
    setGameState("ready");
    updateProgress();
  }

  function renderLevel() {
    const lv = currentLevel();
    // Clear any leftover solved/pulse state from a prior level.
    dom.targetCluster.classList.remove("solved", "pulse");
    renderCluster(dom.sourceCluster, lv.source);
    renderCluster(dom.targetCluster, lv.target);
    renderMultipliers();
    renderAnswerBar();
    renderTargetLabel();
    renderLevelBanner();
    dom.answerBar.classList.remove("error","success","shake");
  }

  // Shows the level's goal equation (e.g. "2³") under the target cluster.
  function renderTargetLabel() {
    const lv = currentLevel();
    if (!dom.targetLabel) return;
    dom.targetLabel.innerHTML = `${lv.base}<sup>${lv.exponent}</sup>`;
  }

  // Top-center banner — shows current level and target equation.
  function renderLevelBanner() {
    const lv = currentLevel();
    if (!dom.levelBanner) return;
    const total = game.levels.length;
    dom.levelBanner.innerHTML = `Level ${game.levelIndex + 1} of ${total} — Build ${lv.base}<sup>${lv.exponent}</sup>`;
  }

  /* ------------------------------------------------------------
     Multiplier buttons — kid-friendly 4-choice row (×2, ×3, ×4, ×5).
     Only the level's base advances the puzzle; wrong picks shake &
     play the wrong-sound, matching the reference layout's UX.
     ------------------------------------------------------------ */
  const MULTIPLIER_CHOICES = [2, 3, 4, 5];

  function renderMultipliers() {
    dom.multipliers.innerHTML = "";
    MULTIPLIER_CHOICES.forEach((m) => {
      const b = document.createElement("button");
      b.className = "mult-btn";
      b.dataset.mult = m;
      b.innerHTML = `&times;${m}`;
      b.addEventListener("click", () => onMultiplierClick(m, b));
      dom.multipliers.appendChild(b);
    });
  }

  function onMultiplierClick(m, btnEl) {
    if (game.state !== "ready" && game.state !== "buildingAnswer") return;
    const lv = currentLevel();
    // Not the level's base → reject with shake + wrong sound, don't mutate state.
    if (!lv.allowedMultipliers.includes(m)) {
      if (btnEl) {
        btnEl.classList.remove("shake");
        void btnEl.offsetWidth;
        btnEl.classList.add("shake");
        setTimeout(() => btnEl.classList.remove("shake"), 420);
      }
      audio.wrong();
      flashToast("Try a different number", "bad");
      return;
    }
    addMultiplier(m, btnEl);
  }

  /* ------------------------------------------------------------
     Add/undo multiplier (the answer builder)
     ------------------------------------------------------------ */
  function addMultiplier(m, btnEl) {
    const lv = currentLevel();
    if (game.selected.length >= lv.maxSteps) {
      flashToast("Max steps reached", "bad");
      audio.click();
      return;
    }

    game.selected.push(m);
    setGameState("buildingAnswer");

    // Quick pop on tap, magical ding when the chip arrives on source.
    audio.tap();
    setTimeout(() => audio.bump(game.selected.length), 380);

    // Briefly mark button "selected" for press feedback.
    if (btnEl) {
      btnEl.classList.add("selected");
      setTimeout(() => btnEl.classList.remove("selected"), 180);
    }

    renderAnswerBar();

    // Fly a chip from the tapped button onto the source cluster,
    // then grow the source cluster to reflect the multiplication.
    animateChipToSource(m, btnEl, () => {
      const newCount = game.currentSourceCount * m;
      game.currentSourceCount = newCount;
      renderCluster(dom.sourceCluster, newCount);
      dom.sourceCluster.classList.remove("flash");
      // Force reflow before re-adding the class so animation restarts.
      void dom.sourceCluster.offsetWidth;
      dom.sourceCluster.classList.add("flash");
    });
  }

  function undoMultiplier() {
    if (game.selected.length === 0) return;
    audio.undo();
    game.selected.pop();

    // Recompute source visual count from scratch.
    const lv = currentLevel();
    let count = lv.source;
    game.selected.forEach((m) => (count *= m));
    game.currentSourceCount = count;
    renderCluster(dom.sourceCluster, count);

    renderAnswerBar();
    if (game.selected.length === 0) setGameState("ready");
    else setGameState("buildingAnswer");
  }

  /* ------------------------------------------------------------
     Answer bar render — single "× base^n" chip.
     Each tap increments the exponent rather than appending a chip,
     teaching that repeated multiplication collapses into exponent
     notation (2 × 2 × 2 === 2³).
     ------------------------------------------------------------ */
  function renderAnswerBar() {
    dom.answerInner.innerHTML = "";

    // Show exponent chip if user has made at least one tap.
    if (game.selected.length > 0) {
      const base = game.selected[0];
      const exp  = game.selected.length;
      const chip = document.createElement("span");
      chip.className = "chip chip--bump";
      chip.innerHTML = `× ${base}<sup>${exp}</sup>`;
      dom.answerInner.appendChild(chip);
    }
    dom.answerBar.classList.toggle("empty", game.selected.length === 0);

    updateActionButton();
    updateUndoButton();
  }

  /* ------------------------------------------------------------
     Fly-chip animation
     ------------------------------------------------------------ */
  function animateChipToSource(m, fromEl, onArrive) {
    const chip = dom.flyChip;
    chip.textContent = `× ${m}`;

    // Compute start and end positions in stage coordinates.
    const stageRect = dom.stage.getBoundingClientRect();
    const stageScale = stageRect.width / STAGE_W;

    let startX = 600, startY = 550;
    if (fromEl) {
      const r = fromEl.getBoundingClientRect();
      startX = (r.left - stageRect.left) / stageScale + r.width  / (2 * stageScale) - 20;
      startY = (r.top  - stageRect.top)  / stageScale + r.height / (2 * stageScale) - 17;
    }
    const srcRect = dom.sourceCluster.getBoundingClientRect();
    const endX = (srcRect.left - stageRect.left) / stageScale + 90 - 20;
    const endY = (srcRect.top  - stageRect.top)  / stageScale + 90 - 17;

    // Reset position (no transition), then animate on next frame.
    chip.style.transition = "none";
    chip.style.left = startX + "px";
    chip.style.top  = startY + "px";
    chip.classList.add("active");
    chip.style.transform = "scale(0.8)";

    requestAnimationFrame(() => {
      chip.style.transition = "all 380ms cubic-bezier(.3,.8,.3,1)";
      chip.style.left = endX + "px";
      chip.style.top  = endY + "px";
      chip.style.transform = "scale(1.1)";
    });

    setTimeout(() => {
      chip.classList.remove("active");
      chip.style.transform = "scale(0.4)";
      if (onArrive) onArrive();
    }, 420);
  }

  /* ------------------------------------------------------------
     Answer evaluation
     ------------------------------------------------------------ */
  function evaluateAnswer() {
    const lv = currentLevel();
    if (game.selected.length === 0) return false;

    if (lv.strictSequence) {
      if (game.selected.length !== lv.correctSequence.length) return false;
      return lv.correctSequence.every((v, i) => v === game.selected[i]);
    }

    // Non-strict: compare numeric products.
    const product = game.selected.reduce((a, b) => a * b, 1);
    return lv.source * product === lv.target;
  }

  function checkAnswer() {
    if (game.state === "checking") return;
    setGameState("checking");
    const ok = evaluateAnswer();
    if (ok) {
      onCorrect();
    } else {
      onIncorrect();
    }
  }

  function onCorrect() {
    setGameState("correct");
    dom.answerBar.classList.add("success");
    // Retrigger pulse + reveal cleanly even if classes linger from before.
    dom.targetCluster.classList.remove("pulse", "solved");
    void dom.targetCluster.offsetWidth;
    dom.targetCluster.classList.add("pulse", "solved");

    // Pedagogical feedback: show the collapsed identity (e.g. "2×2×2 = 2³ = 8").
    const lv = currentLevel();
    const expansion = Array(lv.exponent).fill(lv.base).join("×");
    flashToast(`${expansion} = ${lv.base}${toSuperscript(lv.exponent)} = ${lv.target}`, "good");

    audio.correct();
    playPenguinWalk("walk");

    // Brief warm glow overlay as positive visual feedback.
    if (dom.winFlash) {
      dom.winFlash.classList.add("on");
      setTimeout(() => dom.winFlash.classList.remove("on"), 900);
    }

    // Switch green button to "next" mode
    setGameState("levelComplete");
    updateProgress(true);
  }

  /* ------------------------------------------------------------
     Penguin reaction animation.
       mode === "walk"    — correct: completes the full path across grass
       mode === "retreat" — wrong:   walks halfway, turns, runs back
     Retriggers class cleanly so repeated calls always restart the CSS anim.
     ------------------------------------------------------------ */
  function playPenguinWalk(mode) {
    const el = dom.penguinWalker;
    if (!el) return;
    el.classList.remove("walking", "retreating");
    void el.offsetWidth;             // force reflow to restart animation
    el.classList.add(mode === "retreat" ? "retreating" : "walking");
  }

  function onIncorrect() {
    setGameState("incorrect");
    dom.answerBar.classList.remove("success");
    dom.answerBar.classList.add("error", "shake");
    flashToast("Try again", "bad");
    audio.wrong();
    playPenguinWalk("retreat");

    setTimeout(() => {
      dom.answerBar.classList.remove("shake");
    }, 500);

    // After a short pause, clear chips and reset visuals so user can retry.
    setTimeout(() => {
      game.selected = [];
      game.currentSourceCount = currentLevel().source;
      renderCluster(dom.sourceCluster, currentLevel().source);
      renderAnswerBar();
      dom.answerBar.classList.remove("error");
      setGameState("ready");
    }, 900);
  }

  /* ------------------------------------------------------------
     Action button (green) behavior
     ------------------------------------------------------------ */
  function updateActionButton() {
    dom.actionBtn.classList.remove("disabled","ready","next");
    if (game.state === "levelComplete") {
      dom.actionBtn.classList.add("next");
      dom.actionBtn.title = "Next Level";
    } else if (game.selected.length > 0) {
      dom.actionBtn.classList.add("ready");
      dom.actionBtn.title = "Submit";
    } else {
      dom.actionBtn.classList.add("disabled");
      dom.actionBtn.title = "Pick multipliers first";
    }
  }

  function updateUndoButton() {
    dom.undoBtn.classList.toggle("disabled", game.selected.length === 0);
  }

  /* ------------------------------------------------------------
     Progress
     ------------------------------------------------------------ */
  function updateProgress(afterCorrect) {
    // Use levelIndex + (1 if just finished) over total for fill height.
    const total = game.levels.length;
    const solved = game.levelIndex + (afterCorrect ? 1 : 0);
    const pct = Math.min(100, (solved / total) * 100);
    dom.progressFill.style.height = pct + "%";
    dom.progressMarker.style.bottom = pct + "%";
  }

  /* ------------------------------------------------------------
     Feedback toast
     ------------------------------------------------------------ */
  let toastTimer = null;
  function flashToast(msg, tone) {
    dom.toast.textContent = msg;
    dom.toast.classList.remove("good","bad");
    if (tone) dom.toast.classList.add(tone);
    dom.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 1100);
  }

  /* ------------------------------------------------------------
     State machine
     ------------------------------------------------------------ */
  function setGameState(next) {
    game.state = next;
    updateActionButton();
    updateUndoButton();

    if (next === "gameComplete") {
      dom.completeModal.classList.add("show");
      audio.celebrate();
    }
  }

  /* ------------------------------------------------------------
     Action button click dispatcher
     ------------------------------------------------------------ */
  function onActionClick() {
    if (dom.actionBtn.classList.contains("disabled")) return;
    if (game.state === "levelComplete") {
      audio.click();
      loadLevel(game.levelIndex + 1);
      return;
    }
    if (game.selected.length > 0) {
      checkAnswer();
    }
  }

  /* ------------------------------------------------------------
     Pause / restart
     ------------------------------------------------------------ */
  function showPauseModal() {
    if (game.state === "gameComplete") return;
    audio.click();
    dom.pauseModal.classList.add("show");
    setGameState("paused");
  }
  function resumeGame() {
    audio.click();
    dom.pauseModal.classList.remove("show");
    // Restore sensible state based on whether chips exist.
    setGameState(game.selected.length > 0 ? "buildingAnswer" : "ready");
  }
  function restartLevel() {
    audio.click();
    dom.pauseModal.classList.remove("show");
    loadLevel(game.levelIndex);
  }

  /* ------------------------------------------------------------
     Keyboard support
     ------------------------------------------------------------ */
  function onKey(e) {
    // Ignore input while the first-load tutorial overlay is up.
    if (dom.tutorialModal && dom.tutorialModal.classList.contains("show")) {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        dom.tutorialStartBtn && dom.tutorialStartBtn.click();
      }
      return;
    }
    if (game.state === "paused") {
      if (e.key === "Escape") resumeGame();
      return;
    }
    if (["2","3","4","5"].includes(e.key)) {
      const m = parseInt(e.key, 10);
      const btn = dom.multipliers.querySelector(`[data-mult="${m}"]`);
      onMultiplierClick(m, btn);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      undoMultiplier();
    } else if (e.key === "Enter") {
      onActionClick();
    } else if (e.key === "Escape") {
      showPauseModal();
    }
  }

  /* ------------------------------------------------------------
     Init
     ------------------------------------------------------------ */
  function initGame() {
    fitStage();

    dom.actionBtn.addEventListener("click", onActionClick);
    dom.undoBtn.addEventListener("click", undoMultiplier);
    dom.pauseBtn.addEventListener("click", showPauseModal);
    dom.resumeBtn.addEventListener("click", resumeGame);
    dom.restartBtn.addEventListener("click", restartLevel);
    dom.playAgainBtn.addEventListener("click", () => {
      audio.click();
      dom.completeModal.classList.remove("show");
      loadLevel(0);
    });
    window.addEventListener("keydown", onKey);

    // First-load tutorial. localStorage is wrapped in try/catch because
    // some browsers block it for file:// origins.
    let seen = false;
    try { seen = localStorage.getItem("mg.tutorialSeen") === "1"; } catch (_) {}
    if (!seen && dom.tutorialModal) {
      dom.tutorialModal.classList.add("show");
    }
    if (dom.tutorialStartBtn) {
      dom.tutorialStartBtn.addEventListener("click", () => {
        audio.click();
        dom.tutorialModal.classList.remove("show");
        try { localStorage.setItem("mg.tutorialSeen", "1"); } catch (_) {}
      });
    }

    loadLevel(0);
  }

  // Boot when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGame);
  } else {
    initGame();
  }
})();
