/* ==================================================================
   script.js — Exponent Puzzle Game
   Vanilla JS. Relies on levels.js (window.LEVELS).

   v2.1 — Replaces the old "fly chip → resize source" tap feedback with
   a bread-meets-operator animation where n copies ORBIT the ×n operator
   in a locked wheel before merging back into one bigger bread:

       1. Source bread sits where it was
       2. ×n operator pops in to its right, close enough that the bread
          looks attached to its left side
       3. n-1 additional copies fade in around the operator at equal
          angular spacing (180° apart for ×2, 120° for ×3, etc.)
       4. The whole wheel of n copies orbits around the operator center
          for one full revolution (~1.2s), copies stay axis-aligned
       5. Operator fades; copies converge back to the source slot
       6. The real source cluster is re-rendered with count × n

   The math is unchanged — each tap multiplies the visible bread by the
   level's base, so n taps build base^n. Only the visual feedback changed.
   ================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------
     Sound engine — Web Audio synth, no external assets.
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

    function toneAt(delayMs, freq, duration, opts) {
      setTimeout(() => tone(freq, duration, opts), delayMs);
    }

    return {
      isMuted() { return muted; },
      setMuted(v) { muted = !!v; },
      toggleMuted() { muted = !muted; return muted; },
      tap()    { tone(1100, 0.09, { fromFreq: 600,  type: "sine",     vol: 0.22 }); },
      // Fired the moment the orbit begins — a bright pop with sparkle.
      split()  {
        tone( 720, 0.10, { type: "triangle", vol: 0.18 });
        toneAt(40, 1180, 0.18, { type: "sine", vol: 0.10, attack: 0.01 });
      },
      bump(exp) {
        const base = 1175;
        const f = base * Math.pow(1.122, Math.max(0, exp - 1));
        tone(f,        0.18, { type: "triangle", vol: 0.17 });
        tone(f * 1.5,  0.22, { type: "sine",     vol: 0.08, attack: 0.02 });
      },
      correct() {
        const n = [523.25, 659.25, 783.99, 1046.50];
        n.forEach((f, i) => toneAt(i * 75, f, 0.28, { type: "triangle", vol: 0.2 }));
      },
      wrong() {
        tone(185, 0.55, { fromFreq: 440, type: "sawtooth", vol: 0.16, attack: 0.03 });
        toneAt(120, 165, 0.45, { fromFreq: 392, type: "sawtooth", vol: 0.12, attack: 0.03 });
      },
      undo()   { tone(380, 0.08, { fromFreq: 620, type: "sine", vol: 0.12 }); },
      click()  { tone(820, 0.05, { type: "square", vol: 0.07 }); },
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
  const CLUSTER_SIZE = 180;

  /* ---- Bread-multiply animation tuning (single source of truth) ---- */
  const ANIM = {
    // Geometry
    ORBIT_RADIUS:           145,
    OP_SIZE:                 88,
    COPY_SCALE:            0.92,

    // Phase A — operator pops in
    DUR_OP_IN:              280,
    // Phase B — additional copies fade in at orbit positions
    DUR_EMERGE:             280,
    // Phase C — orbital rotation (linear easing, full radius)
    DUR_ROTATE:            1600,    // ~33% slower than v2.1 (was 1200ms)
    REVOLUTIONS:            1.0,
    // Phase D — spiral inward: copies continue rotating while their orbit
    // radius shrinks to 0 and the orbit center drifts from operator center
    // to the source slot. Convergence point is the source slot, where
    // the new bread blooms in.
    DUR_SPIRAL:             720,
    SPIRAL_EXTRA_ROT:  Math.PI,     // additional rotation during spiral (½ revolution)
    // Phase E — new bread blooms in at source slot. Triggered partway
    // through the spiral so spiraling copies and the blooming bread
    // overlap visually.
    DUR_BREAD_FORM:         520,
    BREAD_FORM_OFFSET_PCT: 0.45,    // bread starts forming this far into the spiral
    // Phase F — operator fades out (covers the whole spiral phase)
    DUR_OP_OUT:             720,
    // Phase G — cleanup
    DUR_SETTLE:              80
  };

  // Dot layout templates — unchanged from v1.
  const CLUSTER_PATTERNS = {
    1:  [[50,50]],
    2:  [[50,32],[50,68]],
    3:  [[50,28],[32,66],[68,66]],
    4:  [[35,35],[65,35],[35,65],[65,65]],
    5:  [[50,50],[28,28],[72,28],[28,72],[72,72]],
    6:  [[33,33],[50,33],[67,33],[33,67],[50,67],[67,67]],
    7:  [[33,28],[50,28],[67,28],[50,50],[33,72],[50,72],[67,72]],
    8:  [[22,30],[42,30],[22,60],[42,60], [58,30],[78,30],[58,60],[78,60]],
    9:  [[30,30],[50,30],[70,30],[30,50],[50,50],[70,50],[30,70],[50,70],[70,70]],
    10: [[30,25],[50,25],[70,25],[30,45],[50,45],[70,45],[30,65],[50,65],[70,65],[50,85]]
  };

  const CLUSTER_EDGES = {
    1:  [],
    2:  [[0,1]],
    3:  [[0,1],[1,2],[2,0]],
    4:  [[0,1],[1,3],[3,2],[2,0]],
    5:  [[0,1],[0,2],[0,3],[0,4]],
    6:  [[0,1],[1,2],[3,4],[4,5],[0,3],[1,4],[2,5]],
    7:  [[0,1],[1,2],[1,3],[3,5],[4,5],[5,6]],
    8:  [[0,1],[1,3],[3,2],[2,0], [4,5],[5,7],[7,6],[6,4]],
    9:  [[0,1],[1,2],[2,5],[5,8],[8,7],[7,6],[6,3],[3,0],
         [4,1],[4,3],[4,5],[4,7]],
    10: [[0,1],[1,2],[2,5],[5,8],[8,9],[9,7],[7,6],[6,3],[3,0],
         [4,1],[4,3],[4,5],[4,7]]
  };

  /* ------------------------------------------------------------
     Game state
       `animating` is the lock that keeps the player from firing a
       second multiply mid-animation. All input handlers short-circuit
       on it.
     ------------------------------------------------------------ */
  const game = {
    levelIndex: 0,
    state: "loading",
    selected: [],
    currentSourceCount: 0,
    levels: window.LEVELS || [],
    animating: false
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
    flyChip:        $("flyChip"),       // kept for backwards compat — unused now
    toast:          $("toast"),
    penguinWalker:  $("penguinWalker"),
    targetLabel:    $("targetLabel"),
    winFlash:       $("winFlash"),
    levelBanner:    $("levelBanner"),
    tutorialModal:  $("tutorialModal"),
    tutorialStartBtn: $("tutorialStartBtn")
  };

  const SUPER = { 0:"⁰",1:"¹",2:"²",3:"³",4:"⁴",5:"⁵",6:"⁶",7:"⁷",8:"⁸",9:"⁹" };
  function toSuperscript(n) {
    return String(n).split("").map((d) => SUPER[d] || d).join("");
  }

  /* ------------------------------------------------------------
     Stage scaling — unchanged
     ------------------------------------------------------------ */
  const STAGE_GROUND_H = 86;
  function fitStage() {
    const sx = window.innerWidth  / STAGE_W;
    const sy = window.innerHeight / STAGE_H;
    const s = Math.min(sx, sy);
    dom.stage.style.transform = `scale(${s})`;

    const stageRenderedH = STAGE_H * s;
    const bottomLetterbox = Math.max(0, window.innerHeight - stageRenderedH);
    const groundH = STAGE_GROUND_H * s + bottomLetterbox;

    const root = document.documentElement;
    root.style.setProperty("--stage-scale", s);
    root.style.setProperty("--scene-ground-h", groundH + "px");
  }
  window.addEventListener("resize", fitStage);

  /* ------------------------------------------------------------
     Cluster rendering — unchanged
     ------------------------------------------------------------ */
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

  function computeDotScale(count) {
    if (count <= 9)  return 1;
    if (count <= 16) return 0.85;
    if (count <= 25) return 0.75;
    if (count <= 36) return 0.65;
    if (count <= 64) return 0.55;
    if (count <= 100) return 0.45;
    return 0.4;
  }

  function buildGridEdges(count) {
    const cols = Math.ceil(Math.sqrt(count));
    const edges = [];
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      if (c < cols - 1 && i + 1 < count)    edges.push([i, i + 1]);
      if (i + cols < count)                 edges.push([i, i + cols]);
    }
    return edges;
  }

  function renderCluster(container, count) {
    container.innerHTML = "";
    if (count <= 0) return;

    const dotScale = computeDotScale(count);
    const pts = buildClusterLayout(count);

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
        line.style.animationDelay = (80 + i * 20) + "ms";
        svg.appendChild(line);
      });
      container.appendChild(svg);
    }

    pts.forEach(([x, y], i) => {
      const dot = document.createElement("div");
      dot.className = "unit";
      dot.style.left = x + "%";
      dot.style.top  = y + "%";
      dot.style.transform = `translate(-50%, -50%) scale(${dotScale})`;
      dot.style.animationDelay = (i * 15) + "ms";
      dot.style.setProperty("--idx", i);
      container.appendChild(dot);
    });
  }

  /* ------------------------------------------------------------
     Level loading — unchanged
     ------------------------------------------------------------ */
  function currentLevel() { return game.levels[game.levelIndex]; }

  function loadLevel(index) {
    clearPenguinWalkEndListener();
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

  let pendingWalkEndHandler = null;
  function clearPenguinWalkEndListener() {
    if (pendingWalkEndHandler && dom.penguinWalker) {
      dom.penguinWalker.removeEventListener("animationend", pendingWalkEndHandler);
    }
    pendingWalkEndHandler = null;
  }
  function onPenguinWalkEnd(callback) {
    const el = dom.penguinWalker;
    if (!el) { callback(); return; }
    clearPenguinWalkEndListener();
    pendingWalkEndHandler = (e) => {
      if (e.animationName !== "walkCross") return;
      clearPenguinWalkEndListener();
      callback();
    };
    el.addEventListener("animationend", pendingWalkEndHandler);
  }

  function goToNextLevel() {
    if (game.state !== "levelComplete") return;
    loadLevel(game.levelIndex + 1);
  }

  function renderLevel() {
    const lv = currentLevel();
    dom.targetCluster.classList.remove("solved", "pulse");
    renderCluster(dom.sourceCluster, lv.source);
    renderCluster(dom.targetCluster, lv.target);
    renderMultipliers();
    renderAnswerBar();
    renderTargetLabel();
    renderLevelBanner();
    dom.answerBar.classList.remove("error","success","shake");
  }

  function renderTargetLabel() {
    const lv = currentLevel();
    if (!dom.targetLabel) return;
    dom.targetLabel.innerHTML = `${lv.base}<sup>${lv.exponent}</sup>`;
  }

  function renderLevelBanner() {
    const lv = currentLevel();
    if (!dom.levelBanner) return;
    const total = game.levels.length;
    dom.levelBanner.innerHTML = `Level ${game.levelIndex + 1} of ${total} — Build ${lv.base}<sup>${lv.exponent}</sup>`;
  }

  /* ------------------------------------------------------------
     Multiplier buttons
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
    if (game.animating) return;
    if (game.state !== "ready" && game.state !== "buildingAnswer") return;

    const lv = currentLevel();
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
     Add/undo multiplier
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

    audio.tap();

    if (btnEl) {
      btnEl.classList.add("selected");
      setTimeout(() => btnEl.classList.remove("selected"), 180);
    }

    renderAnswerBar();
    animateBreadMultiply(m);
  }

  function undoMultiplier() {
    if (game.animating) return;
    if (game.selected.length === 0) return;
    audio.undo();
    game.selected.pop();

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
     Answer bar render — unchanged
     ------------------------------------------------------------ */
  function renderAnswerBar() {
    dom.answerInner.innerHTML = "";

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

  /* ==================================================================
     BREAD × OPERATOR ANIMATION (orbit edition)
     ==================================================================
     n copies of the source bread orbit around a central ×n operator
     for one full revolution, then converge into one merged bread at
     the source slot. Copies stay axis-aligned during the orbit — only
     their POSITIONS rotate, like satellites.
     ================================================================== */

  // Convert a stage element to its (left, top) in stage coordinates,
  // accounting for the current stage scale.
  function stagePosOf(el) {
    const stageRect = dom.stage.getBoundingClientRect();
    const stageScale = stageRect.width / STAGE_W;
    const r = el.getBoundingClientRect();
    return {
      left: (r.left - stageRect.left) / stageScale,
      top:  (r.top  - stageRect.top)  / stageScale
    };
  }

  function animateBreadMultiply(m) {
    game.animating = true;

    // ---- Geometry (stage coords) ----
    const src = stagePosOf(dom.sourceCluster);
    const srcCx = src.left + CLUSTER_SIZE / 2;
    const srcCy = src.top  + CLUSTER_SIZE / 2;
    const orbitR = ANIM.ORBIT_RADIUS;

    // Operator center sits exactly orbitR right of source slot, so the
    // copy at angle π lines up perfectly with the source.
    const opCx = srcCx + orbitR;
    const opCy = srcCy;

    const beforeCount = game.currentSourceCount;
    const afterCount  = beforeCount * m;

    // The orbit takes over the source visually — hide the real cluster.
    dom.sourceCluster.style.visibility = "hidden";

    // ---- Operator ring ----
    const opRing = document.createElement("div");
    opRing.className = "op-ring";
    opRing.style.width  = ANIM.OP_SIZE + "px";
    opRing.style.height = ANIM.OP_SIZE + "px";
    opRing.style.left   = (opCx - ANIM.OP_SIZE / 2) + "px";
    opRing.style.top    = (opCy - ANIM.OP_SIZE / 2) + "px";
    opRing.innerHTML    = `<span>×${m}</span>`;
    opRing.style.opacity   = "0";
    opRing.style.transform = "scale(0.5)";
    dom.stage.appendChild(opRing);

    // ---- Starting angles ----
    // Copy 0 at angle π (left of operator = source slot). Remaining copies
    // are equally spaced around the operator.
    const startAngles = [];
    for (let i = 0; i < m; i++) {
      startAngles.push(Math.PI + i * (2 * Math.PI / m));
    }

    // ---- Copies, positioned at their starting orbit angles ----
    const copies = [];
    for (let i = 0; i < m; i++) {
      const c = document.createElement("div");
      c.className = "cluster cluster--copy";
      c.style.left = (opCx - CLUSTER_SIZE / 2) + "px";
      c.style.top  = (opCy - CLUSTER_SIZE / 2) + "px";
      const a = startAngles[i];
      c.style.transform = `translate(${Math.cos(a) * orbitR}px, ${Math.sin(a) * orbitR}px) scale(${ANIM.COPY_SCALE})`;
      c.style.opacity = (i === 0) ? "1" : "0";
      dom.stage.appendChild(c);
      renderCluster(c, beforeCount);
      copies.push(c);
    }

    // ---- PHASE A — operator pops in, additional copies fade in ----
    requestAnimationFrame(() => requestAnimationFrame(() => {
      opRing.style.transition =
        `opacity ${ANIM.DUR_OP_IN}ms ease, ` +
        `transform ${ANIM.DUR_OP_IN + 80}ms cubic-bezier(.3,.8,.3,1.5)`;
      opRing.style.opacity   = "1";
      opRing.style.transform = "scale(1)";

      copies.forEach((c, i) => {
        if (i === 0) return;
        c.style.transition = `opacity ${ANIM.DUR_EMERGE}ms ease`;
        c.style.transitionDelay = `${Math.max(0, ANIM.DUR_OP_IN - 80) + i * 30}ms`;
        c.style.opacity = "1";
      });
    }));

    // ---- PHASE B — orbital rotation (LINEAR easing for steady speed) ----
    const tRotate = ANIM.DUR_OP_IN + ANIM.DUR_EMERGE;
    setTimeout(() => {
      audio.split();
      copies.forEach(c => { c.style.transition = "none"; void c.offsetWidth; });

      const t0 = performance.now();
      const totalAngle = ANIM.REVOLUTIONS * 2 * Math.PI;

      const tickRotate = (now) => {
        const elapsed = now - t0;
        const p = Math.min(1, elapsed / ANIM.DUR_ROTATE);
        // Linear easing — constant angular velocity, blends naturally
        // into the spiral phase that takes over next.
        const phase = p * totalAngle;

        copies.forEach((c, i) => {
          const a = startAngles[i] + phase;
          c.style.transform =
            `translate(${Math.cos(a) * orbitR}px, ${Math.sin(a) * orbitR}px) scale(${ANIM.COPY_SCALE})`;
        });

        if (p < 1 && game.animating) requestAnimationFrame(tickRotate);
      };
      requestAnimationFrame(tickRotate);
    }, tRotate);

    // ---- PHASE D — spiral inward to source slot ----
    // Each frame, copies are positioned around an "effective orbit center"
    // that drifts from operator center → source slot, with an "effective
    // radius" that shrinks from orbitR → 0, plus continued rotation.
    // Net effect: curving inward paths converging on the source slot.
    const tSpiral = tRotate + ANIM.DUR_ROTATE;
    setTimeout(() => {
      // Operator dissolves over the entire spiral phase.
      opRing.style.transition =
        `opacity ${ANIM.DUR_OP_OUT}ms ease, ` +
        `transform ${ANIM.DUR_OP_OUT}ms ease`;
      opRing.style.opacity = "0";
      opRing.style.transform = "scale(1.4)";

      const t0 = performance.now();
      const finalPhase = ANIM.REVOLUTIONS * 2 * Math.PI;
      const extraRot = ANIM.SPIRAL_EXTRA_ROT;

      const tickSpiral = (now) => {
        const elapsed = now - t0;
        const p = Math.min(1, elapsed / ANIM.DUR_SPIRAL);
        // Ease-out cubic — starts at full angular velocity (matching the
        // end of the linear-easing rotation), decelerates as radius shrinks.
        const eased = 1 - Math.pow(1 - p, 3);

        const radiusNow = orbitR * (1 - eased);
        const phaseNow  = finalPhase + eased * extraRot;
        const driftX    = -orbitR * eased;             // orbit center drifts → source slot
        const scaleNow  = ANIM.COPY_SCALE * (1 - 0.45 * eased);
        // Opacity: full for first half, fading in second half so the
        // new bread (which forms during this phase) takes visual primacy.
        const opNow = p < 0.5 ? 1.0 : Math.max(0.25, 1.0 - (p - 0.5) * 1.5);

        copies.forEach((c, i) => {
          const a  = startAngles[i] + phaseNow;
          const dx = driftX + radiusNow * Math.cos(a);
          const dy = radiusNow * Math.sin(a);
          c.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleNow})`;
          c.style.opacity = opNow.toFixed(3);
        });

        if (p < 1 && game.animating) requestAnimationFrame(tickSpiral);
      };
      requestAnimationFrame(tickSpiral);
    }, tSpiral);

    // ---- PHASE E — new bread blooms in at source slot ----
    // Fired partway into the spiral so spiraling copies and the blooming
    // bread overlap visually. The eye reads it as "the copies became the bread".
    const tBreadForm = tSpiral + Math.floor(ANIM.DUR_SPIRAL * ANIM.BREAD_FORM_OFFSET_PCT);
    setTimeout(() => {
      game.currentSourceCount = afterCount;
      renderCluster(dom.sourceCluster, afterCount);

      // Set initial bloom-in state, then transition to full size on next frame.
      dom.sourceCluster.style.transition = "none";
      dom.sourceCluster.style.transformOrigin = "center center";
      dom.sourceCluster.style.transform = "scale(0.5)";
      dom.sourceCluster.style.opacity = "0";
      dom.sourceCluster.style.visibility = "";
      void dom.sourceCluster.offsetWidth;
      dom.sourceCluster.style.transition =
        `transform ${ANIM.DUR_BREAD_FORM}ms cubic-bezier(.2,.8,.3,1.3), ` +
        `opacity ${Math.min(280, ANIM.DUR_BREAD_FORM)}ms ease`;
      dom.sourceCluster.style.transform = "scale(1)";
      dom.sourceCluster.style.opacity = "1";

      audio.bump(game.selected.length);
    }, tBreadForm);

    // ---- PHASE G — cleanup ----
    // Wait for the slowest tail (spiral end OR bread-form end), then
    // remove temp DOM and restore the source cluster's natural styles.
    const spiralEnd = tSpiral + ANIM.DUR_SPIRAL;
    const breadEnd  = tBreadForm + ANIM.DUR_BREAD_FORM;
    const tDone = Math.max(spiralEnd, breadEnd) + ANIM.DUR_SETTLE;
    setTimeout(() => {
      copies.forEach(c => c.remove());
      opRing.remove();
      // Strip the inline styles set during the bloom-in so the natural
      // CSS rules (.cluster--source { left:150 top:150 }) take over again.
      dom.sourceCluster.style.transition = "";
      dom.sourceCluster.style.transform = "";
      dom.sourceCluster.style.transformOrigin = "";
      dom.sourceCluster.style.opacity = "";
      // Trigger the brightness flash now that the bloom is done.
      dom.sourceCluster.classList.remove("flash");
      void dom.sourceCluster.offsetWidth;
      dom.sourceCluster.classList.add("flash");
      game.animating = false;
    }, tDone);
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

    const product = game.selected.reduce((a, b) => a * b, 1);
    return lv.source * product === lv.target;
  }

  function checkAnswer() {
    if (game.state === "checking") return;
    setGameState("checking");
    const ok = evaluateAnswer();
    if (ok) onCorrect();
    else    onIncorrect();
  }

  function onCorrect() {
    setGameState("correct");

    const lv = currentLevel();
    const expansion = Array(lv.exponent).fill(lv.base).join("×");
    dom.answerInner.textContent =
      `${expansion} = ${lv.base}${toSuperscript(lv.exponent)} = ${lv.target}`;

    dom.answerBar.classList.add("success");
    setTimeout(() => dom.answerBar.classList.remove("success"), 1500);
    dom.targetCluster.classList.remove("pulse", "solved");
    void dom.targetCluster.offsetWidth;
    dom.targetCluster.classList.add("pulse", "solved");

    audio.correct();
    playPenguinWalk("walk");

    if (dom.winFlash) {
      dom.winFlash.classList.add("on");
      setTimeout(() => dom.winFlash.classList.remove("on"), 900);
    }

    setGameState("levelComplete");
    updateProgress(true);

    onPenguinWalkEnd(goToNextLevel);
  }

  function playPenguinWalk(mode) {
    const el = dom.penguinWalker;
    if (!el) return;
    el.classList.remove("walking", "retreating");
    void el.offsetWidth;
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
     Buttons / state — unchanged
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

  function updateProgress(afterCorrect) {
    const total = game.levels.length;
    const solved = game.levelIndex + (afterCorrect ? 1 : 0);
    const pct = Math.min(100, (solved / total) * 100);
    dom.progressFill.style.height = pct + "%";
    dom.progressMarker.style.bottom = pct + "%";
  }

  let toastTimer = null;
  function flashToast(msg, tone) {
    dom.toast.textContent = msg;
    dom.toast.classList.remove("good","bad");
    if (tone) dom.toast.classList.add(tone);
    dom.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 1100);
  }

  function setGameState(next) {
    game.state = next;
    updateActionButton();
    updateUndoButton();

    if (next === "gameComplete") {
      dom.completeModal.classList.add("show");
      audio.celebrate();
    }
  }

  function onActionClick() {
    if (dom.actionBtn.classList.contains("disabled")) return;
    if (game.animating) return;
    if (game.state === "levelComplete") {
      audio.click();
      goToNextLevel();
      return;
    }
    if (game.selected.length > 0) {
      checkAnswer();
    }
  }

  function showPauseModal() {
    if (game.state === "gameComplete") return;
    audio.click();
    dom.pauseModal.classList.add("show");
    setGameState("paused");
  }
  function resumeGame() {
    audio.click();
    dom.pauseModal.classList.remove("show");
    setGameState(game.selected.length > 0 ? "buildingAnswer" : "ready");
  }
  function restartLevel() {
    audio.click();
    dom.pauseModal.classList.remove("show");
    loadLevel(game.levelIndex);
  }

  function onKey(e) {
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGame);
  } else {
    initGame();
  }
})();
