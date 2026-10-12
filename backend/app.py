"""
Escape Room — backend
======================

A deliberately small FastAPI service. It does two real jobs, both of
which are worth pulling out of the browser and putting on a server:

1. THE VAULT PUZZLE (Chamber 03)
   The frontend used to build the two balanced groups by trial and
   error ("pick two random numbers, then hunt for three more that
   happen to add up to the same total"). Here it's generated properly
   with a subset-sum dynamic program: pick N random weights, then use
   DP to prove a balanced split exists and reconstruct one. This also
   means the split is never predictable from watching the RNG calls —
   the server decides, the client only sees the shuffled weights.

   The server also VERIFIES the player's placement. The browser never
   holds the "correct answer" — it just reports where each weight was
   dropped, and the backend recomputes the sums itself. That's the
   difference between "the UI thinks you won" and "you actually won".

2. THE LEADERBOARD
   Completion times are stored in a small SQLite database and served
   back sorted, so the win screen can show "you're currently #3".
   Nothing fancy — just real persistence instead of a JS array that
   resets on refresh.

Run it with:
    pip install -r requirements.txt
    uvicorn app:app --reload

Then open http://127.0.0.1:8000 — this app also serves the existing
frontend (index.html / game.js / styles.css) as static files, so
there's nothing else to wire up.
"""

import random
import sqlite3
import time
import uuid
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# paths / app setup
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent      # .../escape-room
DB_PATH = Path(__file__).resolve().parent / "leaderboard.db"

app = FastAPI(title="Escape Room Backend")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS scores (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id     TEXT NOT NULL,
            player_name TEXT NOT NULL,
            seconds     INTEGER NOT NULL,
            solved_at   REAL NOT NULL
        )
        """
    )
    return conn


# ---------------------------------------------------------------------------
# subset-sum DP — the actual algorithm behind Chamber 03
# ---------------------------------------------------------------------------

def find_balanced_split(values: List[int]):
    """
    Given a list of positive integers, decide whether some non-empty,
    proper subset sums to exactly half the total — and if so, return
    the indices of one such subset.

    Classic 0/1 subset-sum DP:
        dp[i][s] = True  if some subset of values[:i] sums to s
    Then backtrack through the table to recover one witness subset,
    rather than just answering yes/no.

    Returns None if no balanced split exists, otherwise a list of
    indices belonging to one side of the split (the rest form the
    other side).
    """
    total = sum(values)
    if total % 2 != 0 or len(values) < 3:
        return None
    target = total // 2
    n = len(values)

    dp = [[False] * (target + 1) for _ in range(n + 1)]
    dp[0][0] = True
    for i in range(1, n + 1):
        v = values[i - 1]
        for s in range(target + 1):
            dp[i][s] = dp[i - 1][s] or (s >= v and dp[i - 1][s - v])

    if not dp[n][target]:
        return None

    # backtrack to reconstruct one witness subset
    subset = []
    s = target
    for i in range(n, 0, -1):
        # this item was used iff we couldn't have reached s without it
        if dp[i - 1][s]:
            continue
        subset.append(i - 1)
        s -= values[i - 1]

    if not subset or len(subset) == n:
        return None  # degenerate split, try again with new weights
    return subset


def generate_vault_puzzle(max_attempts: int = 200):
    """
    Generate a set of 5-6 random weights (1-9) that DOES have a
    balanced split, using find_balanced_split as the certificate.
    Unlike a fixed "2 items vs 3 items" template, this works for any
    split shape the DP happens to find.
    """
    for _ in range(max_attempts):
        n = random.choice([5, 6])
        values = [random.randint(1, 9) for _ in range(n)]
        subset = find_balanced_split(values)
        if subset is not None:
            target = sum(values) // 2
            return values, target
    # extremely unlikely fallback, kept for safety
    return [4, 5, 3, 3, 3], 9


# in-memory store of live puzzles: puzzle_id -> {"weights": [...], "target": int}
# (kept in memory, not the DB — a puzzle is scratch state, not a permanent record)
_VAULT_PUZZLES: dict = {}


# ---------------------------------------------------------------------------
# request / response models
# ---------------------------------------------------------------------------

class VaultPuzzleOut(BaseModel):
    puzzle_id: str
    weights: List[int]


class VaultCheckIn(BaseModel):
    puzzle_id: str
    left: List[int] = Field(default_factory=list)
    right: List[int] = Field(default_factory=list)


class VaultCheckOut(BaseModel):
    correct: bool
    left_sum: int
    right_sum: int
    vault_digit: int | None = None


class ScoreIn(BaseModel):
    case_id: str
    player_name: str = "Anonymous"
    seconds: int


class ScoreOut(BaseModel):
    rank: int
    total_players: int


class LeaderboardRow(BaseModel):
    player_name: str
    case_id: str
    seconds: int


# ---------------------------------------------------------------------------
# vault endpoints
# ---------------------------------------------------------------------------

@app.post("/api/vault/new", response_model=VaultPuzzleOut)
def new_vault_puzzle():
    weights, target = generate_vault_puzzle()
    puzzle_id = uuid.uuid4().hex[:12]
    _VAULT_PUZZLES[puzzle_id] = {"weights": weights, "target": target}

    # shuffle only what we hand to the client — order shouldn't leak
    # anything about which weights belong together
    shuffled = weights[:]
    random.shuffle(shuffled)
    return VaultPuzzleOut(puzzle_id=puzzle_id, weights=shuffled)


@app.post("/api/vault/check", response_model=VaultCheckOut)
def check_vault(payload: VaultCheckIn):
    puzzle = _VAULT_PUZZLES.get(payload.puzzle_id)
    if puzzle is None:
        raise HTTPException(status_code=404, detail="Unknown or expired puzzle_id")

    left_sum = sum(payload.left)
    right_sum = sum(payload.right)

    # the server re-derives correctness from its own stored target,
    # never from anything the client claims the target is
    placed_all = sorted(payload.left + payload.right) == sorted(puzzle["weights"])
    correct = placed_all and left_sum == right_sum == puzzle["target"] and left_sum > 0

    return VaultCheckOut(
        correct=correct,
        left_sum=left_sum,
        right_sum=right_sum,
        vault_digit=(left_sum % 10) if correct else None,
    )


# ---------------------------------------------------------------------------
# leaderboard endpoints
# ---------------------------------------------------------------------------

@app.post("/api/leaderboard/submit", response_model=ScoreOut)
def submit_score(payload: ScoreIn):
    name = (payload.player_name or "Anonymous").strip()[:24] or "Anonymous"
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO scores (case_id, player_name, seconds, solved_at) VALUES (?, ?, ?, ?)",
            (payload.case_id, name, payload.seconds, time.time()),
        )
        conn.commit()
        total = conn.execute("SELECT COUNT(*) FROM scores").fetchone()[0]
        better = conn.execute(
            "SELECT COUNT(*) FROM scores WHERE seconds < ?", (payload.seconds,)
        ).fetchone()[0]
        rank = better + 1
        return ScoreOut(rank=rank, total_players=total)
    finally:
        conn.close()


@app.get("/api/leaderboard/top", response_model=List[LeaderboardRow])
def leaderboard_top(limit: int = 10):
    limit = max(1, min(limit, 50))
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT player_name, case_id, seconds FROM scores ORDER BY seconds ASC LIMIT ?",
            (limit,),
        ).fetchall()
        return [LeaderboardRow(player_name=r[0], case_id=r[1], seconds=r[2]) for r in rows]
    finally:
        conn.close()


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# static frontend (index.html / game.js / styles.css)
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=ROOT, html=True), name="frontend")
