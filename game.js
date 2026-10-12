/* ============================================================
   ESCAPE ROOM — game engine
   Every chamber is procedurally generated, then verified
   solvable BEFORE it is ever shown to the player:
     Room 1  maze          -> randomized DFS carve, BFS reachability check
     Room 2  signal panel  -> random 4-digit sequence, played back, then repeated
     Room 3  vault         -> item dependency graph, DFS cycle check + topological order
     Room 4  final lock    -> code derived deterministically from rooms 1-3
   ============================================================ */

const ROOMS = [
  { id: 1, label: "The Maze" },
  { id: 2, label: "The Signal Panel" },
  { id: 3, label: "The Vault" },
  { id: 4, label: "The Final Lock" },
];

const state = {
  current: 1,
  completed: { 1: false, 2: false, 3: false, 4: false },
  startTime: Date.now(),
  maze: null,
  signal: null,
  vault: null,
  artifacts: { mazeDigit: null, cipherDigits: null, vaultDigit: null },
  finalCode: null,
};

const rnd = (n) => Math.floor(Math.random() * n);
const choice = (arr) => arr[rnd(arr.length)];

/* ============================================================
   ROOM 1 — THE MAZE
   Randomized DFS carve (a spanning tree of the grid, so full
   connectivity is guaranteed) + BFS check as a correctness proof.
   ============================================================ */

const MAZE_W = 9, MAZE_H = 7, CELL = 42;

function generateMaze() {
  const cells = [];
  for (let y = 0; y < MAZE_H; y++) {
    const row = [];
    for (let x = 0; x < MAZE_W; x++) {
      row.push({ x, y, walls: { N: true, E: true, S: true, W: true }, visited: false });
    }
    cells.push(row);
  }
  const at = (x, y) => (x >= 0 && x < MAZE_W && y >= 0 && y < MAZE_H ? cells[y][x] : null);

  const stack = [];
  let current = at(0, 0);
  current.visited = true;
  stack.push(current);

  const DIRS = [
    { dx: 0, dy: -1, wall: "N", opp: "S" },
    { dx: 1, dy: 0, wall: "E", opp: "W" },
    { dx: 0, dy: 1, wall: "S", opp: "N" },
    { dx: -1, dy: 0, wall: "W", opp: "E" },
  ];

  while (stack.length) {
    current = stack[stack.length - 1];
    const options = [];
    for (const d of DIRS) {
      const n = at(current.x + d.dx, current.y + d.dy);
      if (n && !n.visited) options.push({ n, d });
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const { n, d } = choice(options);
    current.walls[d.wall] = false;
    n.walls[d.opp] = false;
    n.visited = true;
    stack.push(n);
  }

  const entry = { x: 0, y: 0 };
  const exit = { x: MAZE_W - 1, y: MAZE_H - 1 };
  let key;
  do {
    key = { x: rnd(MAZE_W), y: rnd(MAZE_H) };
  } while ((key.x === entry.x && key.y === entry.y) || (key.x === exit.x && key.y === exit.y));

  return { cells, entry, exit, key };
}

function mazeReachable(maze, from, to) {
  const seen = new Set();
  const q = [from];
  seen.add(`${from.x},${from.y}`);
  const DIRS = [
    { dx: 0, dy: -1, wall: "N" },
    { dx: 1, dy: 0, wall: "E" },
    { dx: 0, dy: 1, wall: "S" },
    { dx: -1, dy: 0, wall: "W" },
  ];
  while (q.length) {
    const c = q.shift();
    if (c.x === to.x && c.y === to.y) return true;
    const cell = maze.cells[c.y][c.x];
    for (const d of DIRS) {
      if (cell.walls[d.wall]) continue;
      const nx = c.x + d.dx, ny = c.y + d.dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= MAZE_W || ny < 0 || ny >= MAZE_H || seen.has(key)) continue;
      seen.add(key);
      q.push({ x: nx, y: ny });
    }
  }
  return false;
}

function buildMaze() {
  let maze, ok, attempts = 0;
  do {
    maze = generateMaze();
    ok = mazeReachable(maze, maze.entry, maze.key) && mazeReachable(maze, maze.key, maze.exit);
    attempts++;
  } while (!ok && attempts < 10);
  return maze;
}

function renderMaze() {
  const m = state.maze || (state.maze = buildMaze());
  m.player = m.player || { x: m.entry.x, y: m.entry.y };
  m.hasKey = m.hasKey || false;

  panel.innerHTML = `
    <div class="room-eyebrow">Chamber 01</div>
    <h2 class="room-title">The Maze</h2>
    <p class="room-flavor">Nine feet of dark corridor between you and a brass key. Find it, then find the door. Arrow keys, WASD, or the pad below.</p>
    <div class="maze-wrap">
      <canvas id="mazeCanvas" width="${MAZE_W * CELL}" height="${MAZE_H * CELL}"></canvas>
      <div class="maze-side">
        <div class="maze-status-row"><span class="dot ${m.hasKey ? "on" : ""}" id="keyDot"></span> Key recovered</div>
        <div class="dpad">
          <button class="u" data-dx="0" data-dy="-1">&#9650;</button>
          <button class="l" data-dx="-1" data-dy="0">&#9664;</button>
          <button class="r" data-dx="1" data-dy="0">&#9654;</button>
          <button class="d" data-dx="0" data-dy="1">&#9660;</button>
        </div>
        <div id="mazeFeedback"></div>
      </div>
    </div>
  `;

  const canvas = document.getElementById("mazeCanvas");
  const ctx = canvas.getContext("2d");

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#6b6048";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (let y = 0; y < MAZE_H; y++) {
      for (let x = 0; x < MAZE_W; x++) {
        const c = m.cells[y][x];
        const px = x * CELL, py = y * CELL;
        ctx.beginPath();
        if (c.walls.N) { ctx.moveTo(px, py); ctx.lineTo(px + CELL, py); }
        if (c.walls.E) { ctx.moveTo(px + CELL, py); ctx.lineTo(px + CELL, py + CELL); }
        if (c.walls.S) { ctx.moveTo(px, py + CELL); ctx.lineTo(px + CELL, py + CELL); }
        if (c.walls.W) { ctx.moveTo(px, py); ctx.lineTo(px, py + CELL); }
        ctx.stroke();
      }
    }
    // exit
    ctx.fillStyle = "rgba(63,122,52,.20)";
    ctx.fillRect(m.exit.x * CELL + 4, m.exit.y * CELL + 4, CELL - 8, CELL - 8);
    // key
    if (!m.hasKey) {
      ctx.font = "20px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#8A6A34";
      ctx.fillText("\u26AD", m.key.x * CELL + CELL / 2, m.key.y * CELL + CELL / 2);
    }
    // player
    ctx.beginPath();
    ctx.fillStyle = "#B23A32";
    ctx.arc(m.player.x * CELL + CELL / 2, m.player.y * CELL + CELL / 2, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  function tryMove(dx, dy) {
    const cell = m.cells[m.player.y][m.player.x];
    const map = { "0,-1": "N", "1,0": "E", "0,1": "S", "-1,0": "W" };
    const wall = map[`${dx},${dy}`];
    if (cell.walls[wall]) return;
    m.player = { x: m.player.x + dx, y: m.player.y + dy };

    if (!m.hasKey && m.player.x === m.key.x && m.player.y === m.key.y) {
      m.hasKey = true;
      document.getElementById("keyDot").classList.add("on");
      feedback("mazeFeedback", "ok", "Key recovered. Now reach the lit doorway.");
    }
    if (m.hasKey && m.player.x === m.exit.x && m.player.y === m.exit.y) {
      state.artifacts.mazeDigit = (m.key.x * MAZE_H + m.key.y) % 10;
      completeRoom(1, "The corridor goes quiet behind you.");
    }
    draw();
  }

  draw();
  document.querySelectorAll(".dpad button").forEach((b) => {
    b.addEventListener("click", () => tryMove(+b.dataset.dx, +b.dataset.dy));
  });
  window.onkeydown = (e) => {
    if (state.current !== 1) return;
    const map = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
    if (map[e.key]) { e.preventDefault(); tryMove(...map[e.key]); }
  };
}

/* ============================================================
   ROOM 2 — THE CIPHER LOCK
   Random 4-digit code, shifted with a Caesar-style digit cipher.
   Round-trip decode is checked against the plaintext before the
   puzzle is ever shown (catches any off-by-one in the shift math).
   ============================================================ */

/* ============================================================
   ROOM 2 — THE SIGNAL PANEL
   A random 4-digit sequence is generated up front (so it's fixed
   and fair), played back to the player as a light sequence, then
   the player must reproduce it in the same order on the keypad.
   No arithmetic — just watch, then repeat.
   ============================================================ */

function generateSignal() {
  const sequence = Array.from({ length: 4 }, () => rnd(10));
  return { sequence };
}

function buildSignal() {
  return generateSignal();
}

function renderSignal() {
  const s = state.signal || (state.signal = buildSignal());
  s.entered = s.entered || [];

  panel.innerHTML = `
    <div class="room-eyebrow">Chamber 02</div>
    <h2 class="room-title">The Signal Panel</h2>
    <p class="room-flavor">Four lights flash across the panel, one number at a time. Watch the sequence, then tap the same four numbers back in the same order.</p>
    <div class="signal-lights" id="signalLights"></div>
    <button class="btn ghost" id="replaySignal">Replay sequence</button>
    <div class="keypad" id="signalKeypad"></div>
    <div id="signalFeedback"></div>
  `;

  drawSignalLights(s);
  drawKeypad(s);
  document.getElementById("replaySignal").addEventListener("click", () => playSequence(s));

  if (!s.played) {
    s.played = true;
    setTimeout(() => playSequence(s), 500);
  } else if (!s.playing) {
    setKeypadEnabled(true);
  }
}

function drawSignalLights(s) {
  const mount = document.getElementById("signalLights");
  if (!mount) return;
  mount.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const el = document.createElement("div");
    const hasEntry = s.entered[i] !== undefined;
    el.className = "signal-light" + (hasEntry ? " filled" : "");
    el.id = `signalLight${i}`;
    el.textContent = hasEntry ? s.entered[i] : "";
    mount.appendChild(el);
  }
}

function playSequence(s) {
  if (s.playing) return;
  s.playing = true;
  s.entered = [];
  drawSignalLights(s);
  setKeypadEnabled(false);
  const fb = document.getElementById("signalFeedback");
  if (fb) fb.innerHTML = "";

  let i = 0;
  const step = () => {
    for (let j = 0; j < 4; j++) {
      const el = document.getElementById(`signalLight${j}`);
      if (el) { el.classList.remove("lit"); el.textContent = ""; }
    }
    if (i >= s.sequence.length) {
      s.playing = false;
      setKeypadEnabled(true);
      return;
    }
    const el = document.getElementById(`signalLight${i}`);
    if (el) { el.textContent = s.sequence[i]; el.classList.add("lit"); }
    i++;
    setTimeout(() => {
      if (el) { el.classList.remove("lit"); el.textContent = ""; }
      setTimeout(step, 220);
    }, 550);
  };
  step();
}

function setKeypadEnabled(enabled) {
  document.querySelectorAll("#signalKeypad button").forEach((b) => (b.disabled = !enabled));
}

function drawKeypad(s) {
  const mount = document.getElementById("signalKeypad");
  if (!mount) return;
  mount.innerHTML = "";
  for (let d = 0; d <= 9; d++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = d;
    b.disabled = true;
    b.addEventListener("click", () => {
      if (s.playing) return;
      s.entered.push(d);
      drawSignalLights(s);
      if (s.entered.length === s.sequence.length) {
        const ok = s.entered.every((v, idx) => v === s.sequence[idx]);
        if (ok) {
          state.artifacts.cipherDigits = s.sequence.join("");
          completeRoom(2, "The panel goes dark, satisfied.");
        } else {
          feedback("signalFeedback", "bad", "Not quite that order. Watch again.");
          setTimeout(() => playSequence(s), 700);
        }
      }
    });
    mount.appendChild(b);
  }
}

/* Reusable tumbler-dial widget: `count` digit reels the player can spin */
function renderTumblers(mountId, valueArr, onChange) {
  const mount = document.getElementById(mountId);
  mount.innerHTML = "";
  valueArr.forEach((val, i) => {
    const t = document.createElement("div");
    t.className = "tumbler";
    t.innerHTML = `
      <button data-i="${i}" data-d="1">&#9650;</button>
      <div class="tumbler-digit">${val}</div>
      <button data-i="${i}" data-d="-1">&#9660;</button>
    `;
    mount.appendChild(t);
  });
  mount.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      const i = +b.dataset.i, d = +b.dataset.d;
      valueArr[i] = (valueArr[i] + d + 10) % 10;
      mount.children[i].querySelector(".tumbler-digit").textContent = valueArr[i];
      onChange(valueArr);
    });
  });
}

/* ============================================================
   ROOM 3 — THE VAULT SCALE
   The puzzle itself now lives on the backend: it generates the
   weights with a subset-sum dynamic program (see backend/app.py),
   and the player's placement is verified there too — the browser
   never holds the answer, it only reports where each weight sits.
   ============================================================ */

const API_BASE = ""; // same-origin: the backend also serves this frontend

async function buildVaultFromBackend() {
  const res = await fetch(`${API_BASE}/api/vault/new`, { method: "POST" });
  if (!res.ok) throw new Error("vault/new failed");
  const { puzzle_id, weights } = await res.json();
  return {
    puzzleId: puzzle_id,
    blocks: weights.map((v, i) => ({ id: i, value: v, loc: "tray" })),
  };
}

async function renderVault() {
  if (!state.vault) {
    panel.innerHTML = `
      <div class="room-eyebrow">Chamber 03</div>
      <h2 class="room-title">The Vault</h2>
      <p class="room-flavor">Requesting a fresh scale puzzle from the backend…</p>
    `;
    try {
      state.vault = await buildVaultFromBackend();
    } catch (err) {
      panel.innerHTML += `<div class="feedback bad">Couldn't reach the backend at ${API_BASE || location.origin}. Is <code>uvicorn app:app</code> running?</div>`;
      return;
    }
    if (state.current !== 3) return; // player navigated away while we waited
  }
  const v = state.vault;

  panel.innerHTML = `
    <div class="room-eyebrow">Chamber 03</div>
    <h2 class="room-title">The Vault</h2>
    <p class="room-flavor">The door won't budge until this old scale sits level. Tap a weight to cycle it between the tray and the two pans — place every weight so both sides read the same number. This scale (and the checking of it) is generated by the Python backend, not the browser.</p>
    <svg class="scale-svg" viewBox="0 0 340 190" id="scaleSvg" aria-hidden="true">
      <line x1="170" y1="8" x2="170" y2="122" stroke="var(--brass-dim)" stroke-width="6" stroke-linecap="round"></line>
      <polygon points="148,178 192,178 170,122" fill="var(--brass-dim)"></polygon>
      <g id="beamGroup">
        <line x1="40" y1="60" x2="300" y2="60" stroke="var(--brass)" stroke-width="6" stroke-linecap="round"></line>
        <g transform="translate(40,60)">
          <line x1="0" y1="0" x2="0" y2="42" stroke="var(--brass-dim)" stroke-width="2"></line>
          <rect x="-48" y="42" width="96" height="46" rx="10" fill="var(--panel-2)" stroke="var(--hairline)"></rect>
          <text x="0" y="71" text-anchor="middle" font-family="var(--mono)" font-size="22" font-weight="700" fill="var(--ink)" id="leftSumText">0</text>
        </g>
        <g transform="translate(300,60)">
          <line x1="0" y1="0" x2="0" y2="42" stroke="var(--brass-dim)" stroke-width="2"></line>
          <rect x="-48" y="42" width="96" height="46" rx="10" fill="var(--panel-2)" stroke="var(--hairline)"></rect>
          <text x="0" y="71" text-anchor="middle" font-family="var(--mono)" font-size="22" font-weight="700" fill="var(--ink)" id="rightSumText">0</text>
        </g>
      </g>
    </svg>
    <div class="weight-row">
      <div class="weight-row-label">Tray</div>
      <div class="weight-chips" id="trayChips"></div>
    </div>
    <div class="weight-row">
      <div class="weight-row-label">Left pan</div>
      <div class="weight-chips" id="leftChips"></div>
    </div>
    <div class="weight-row">
      <div class="weight-row-label">Right pan</div>
      <div class="weight-chips" id="rightChips"></div>
    </div>
    <div id="vaultFeedback"></div>
  `;

  drawVault(v);
}

function drawVault(v) {
  const tray = document.getElementById("trayChips");
  const leftMount = document.getElementById("leftChips");
  const rightMount = document.getElementById("rightChips");
  if (!tray || !leftMount || !rightMount) return;
  tray.innerHTML = ""; leftMount.innerHTML = ""; rightMount.innerHTML = "";

  v.blocks.forEach((b) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "weight-chip";
    chip.textContent = b.value;
    chip.addEventListener("click", () => {
      b.loc = b.loc === "tray" ? "left" : b.loc === "left" ? "right" : "tray";
      drawVault(v);
      checkVault(v);
    });
    if (b.loc === "tray") tray.appendChild(chip);
    else if (b.loc === "left") leftMount.appendChild(chip);
    else rightMount.appendChild(chip);
  });

  const sumLeft = v.blocks.filter((b) => b.loc === "left").reduce((s, b) => s + b.value, 0);
  const sumRight = v.blocks.filter((b) => b.loc === "right").reduce((s, b) => s + b.value, 0);
  const leftText = document.getElementById("leftSumText");
  const rightText = document.getElementById("rightSumText");
  if (leftText) leftText.textContent = sumLeft;
  if (rightText) rightText.textContent = sumRight;

  const diff = sumLeft - sumRight;
  const tilt = Math.max(-16, Math.min(16, diff * 2.2));
  const beam = document.getElementById("beamGroup");
  if (beam) beam.setAttribute("transform", `rotate(${tilt} 170 60)`);
}

async function checkVault(v) {
  const allPlaced = v.blocks.every((b) => b.loc !== "tray");
  if (!allPlaced) return;

  const left = v.blocks.filter((b) => b.loc === "left").map((b) => b.value);
  const right = v.blocks.filter((b) => b.loc === "right").map((b) => b.value);

  let result;
  try {
    const res = await fetch(`${API_BASE}/api/vault/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ puzzle_id: v.puzzleId, left, right }),
    });
    result = await res.json();
  } catch (err) {
    feedback("vaultFeedback", "bad", "Couldn't reach the backend to check the scale.");
    return;
  }

  if (result.correct) {
    state.artifacts.vaultDigit = result.vault_digit;
    completeRoom(3, "The scale settles level. Somewhere below, a bolt slides free.");
  } else {
    feedback("vaultFeedback", "bad", `Not balanced yet — left ${result.left_sum}, right ${result.right_sum}.`);
  }
}


/* ============================================================
   ROOM 4 — THE FINAL LOCK
   Not independently generated — the code is derived from what
   happened in rooms 1-3, so a correct escape proves every earlier
   room was actually solved (not just clicked through).
   ============================================================ */

function computeFinalCode() {
  const { mazeDigit, cipherDigits, vaultDigit } = state.artifacts;
  return `${mazeDigit}${cipherDigits}${vaultDigit}`;
}

function renderFinal() {
  state.finalCode = state.finalCode || computeFinalCode();
  const guess = state.finalGuess || (state.finalGuess = Array(6).fill(0));

  const { mazeDigit, cipherDigits, vaultDigit } = state.artifacts;

  panel.innerHTML = `
    <div class="room-eyebrow">Chamber 04</div>
    <h2 class="room-title">The Final Lock</h2>
    <p class="room-flavor">Six tumblers, one for each digit below, left to right in this order: maze mark, cipher code, vault seal.</p>
    <div class="evidence-box">
      <div class="evidence-card">
        <div class="evidence-label">Maze mark</div>
        <div class="evidence-value">${mazeDigit}</div>
      </div>
      <div class="evidence-card">
        <div class="evidence-label">Cipher code</div>
        <div class="evidence-value">${cipherDigits}</div>
      </div>
      <div class="evidence-card">
        <div class="evidence-label">Vault seal</div>
        <div class="evidence-value">${vaultDigit}</div>
      </div>
    </div>
    <div class="tumbler-row" id="finalTumblers"></div>
    <button class="btn" id="finalSubmit">Pull the door</button>
    <div id="finalFeedback"></div>
  `;

  renderTumblers("finalTumblers", guess, () => {});

  document.getElementById("finalSubmit").addEventListener("click", () => {
    if (guess.join("") === state.finalCode) {
      completeRoom(4, "");
      renderWin();
    } else {
      feedback("finalFeedback", "bad", "The tumblers hold. Something's out of order.");
    }
  });
}

function renderWin() {
  const seconds = Math.round((Date.now() - state.startTime) / 1000);
  const caseId = document.getElementById("caseId").textContent;

  panel.innerHTML = `
    <div class="win">
      <div class="room-eyebrow">Case closed</div>
      <h2 class="room-title">You're out.</h2>
      <div class="win-code">${state.finalCode}</div>
      <p class="room-flavor" style="margin:0 auto;">Escaped in ${seconds}s. Every chamber you cleared was generated for this run only — start a new case and none of it repeats.</p>
      <div class="leaderboard-submit">
        <input type="text" id="playerName" class="text-input" placeholder="Name for the case file" maxlength="24" />
        <button class="btn" id="submitScore">Log this time</button>
      </div>
      <div id="leaderboardFeedback"></div>
      <div id="leaderboardBox" class="evidence-box" style="justify-content:center; margin-top:18px;"></div>
      <button class="btn ghost" id="again" style="margin-top:18px;">Start a new case</button>
    </div>
  `;

  document.getElementById("again").addEventListener("click", resetGame);

  document.getElementById("submitScore").addEventListener("click", async () => {
    const name = document.getElementById("playerName").value.trim() || "Anonymous";
    const btn = document.getElementById("submitScore");
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, player_name: name, seconds }),
      });
      const { rank, total_players } = await res.json();
      feedback("leaderboardFeedback", "ok", `Logged — you're #${rank} of ${total_players} recorded escapes.`);
      loadLeaderboard();
    } catch (err) {
      feedback("leaderboardFeedback", "bad", "Couldn't reach the backend to log this time.");
    } finally {
      btn.disabled = false;
    }
  });

  loadLeaderboard();
}

async function loadLeaderboard() {
  const box = document.getElementById("leaderboardBox");
  if (!box) return;
  let rows;
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard/top?limit=5`);
    rows = await res.json();
  } catch (err) {
    return; // leaderboard is a nice-to-have, fail quietly
  }
  if (!document.getElementById("leaderboardBox")) return; // view changed while fetching
  if (!rows.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = rows
    .map(
      (r, i) => `
      <div class="evidence-card">
        <div class="evidence-label">#${i + 1} · ${r.player_name}</div>
        <div class="evidence-value" style="font-size:16px;">${r.seconds}s</div>
      </div>`
    )
    .join("");
}

/* ============================================================
   shared plumbing
   ============================================================ */

function feedback(mountId, kind, text) {
  document.getElementById(mountId).innerHTML = `<div class="feedback ${kind}">${text}</div>`;
}

function completeRoom(id, line) {
  state.completed[id] = true;
  renderRail();
  if (id < 4) {
    setTimeout(() => {
      state.current = id + 1;
      renderAll();
    }, 550);
    feedback(
      id === 1 ? "mazeFeedback" : id === 2 ? "signalFeedback" : "vaultFeedback",
      "ok",
      line
    );
  }
}

function lockIcon(open) {
  return open
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 7.3-2.2"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
}

function renderRail() {
  const rail = document.getElementById("rail");
  rail.innerHTML = `<div class="rail-title">Chambers</div>`;
  ROOMS.forEach((r, i) => {
    const unlocked = i === 0 || state.completed[ROOMS[i - 1].id];
    const done = state.completed[r.id];
    const active = state.current === r.id;
    const item = document.createElement("div");
    item.className = `rail-item ${unlocked ? "unlocked" : ""} ${active ? "active" : ""} ${done ? "done" : ""}`;
    item.innerHTML = `<span class="rail-lock">${lockIcon(done)}</span><span class="rail-label">${r.label}</span>`;
    if (unlocked) item.addEventListener("click", () => { state.current = r.id; renderAll(); });
    rail.appendChild(item);
    if (i < ROOMS.length - 1) {
      const conn = document.createElement("div");
      conn.className = "rail-connector";
      rail.appendChild(conn);
    }
  });
}

let panel; // resolved to the #panel element once the DOM is ready

function renderAll() {
  renderRail();
  if (state.current === 1) renderMaze();
  else if (state.current === 2) renderSignal();
  else if (state.current === 3) renderVault();
  else if (state.current === 4) renderFinal();
}

function resetGame() {
  state.current = 1;
  state.completed = { 1: false, 2: false, 3: false, 4: false };
  state.startTime = Date.now();
  state.maze = null;
  state.signal = null;
  state.vault = null;
  state.finalGuess = null;
  state.finalCode = null;
  state.artifacts = { mazeDigit: null, cipherDigits: null, vaultDigit: null };
  document.getElementById("caseId").textContent = "#" + String(1000 + rnd(9000));
  renderAll();
}

document.addEventListener("DOMContentLoaded", () => {
  panel = document.getElementById("panel");
  document.getElementById("caseId").textContent = "#" + String(1000 + rnd(9000));
  renderAll();
});
