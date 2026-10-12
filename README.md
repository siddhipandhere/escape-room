# Escape Room — with a Python backend

Everything ran in the browser before. Now Chamber 03 (the vault scale)
and the leaderboard are handled by a small FastAPI service in
`backend/app.py`. Rooms 1, 2, and 4 are unchanged and still run
client-side in `game.js`.

## What the backend actually does

- **Vault puzzle generation** — instead of the old JS trial-and-error
  loop ("guess two numbers, then hunt for three more that happen to
  match"), the backend generates weights and proves a balanced split
  exists with a **0/1 subset-sum dynamic program**, reconstructing one
  witness split by backtracking through the DP table. See
  `find_balanced_split()` in `backend/app.py`.
- **Server-side verification** — the browser never holds the "correct"
  split. It only reports which weight sits where, and the backend
  recomputes the sums against the puzzle it generated. The frontend
  literally cannot know the answer without solving it, which wasn't
  true in the pure-JS version.
- **A persistent leaderboard** — completion times are stored in a
  small SQLite database (`backend/leaderboard.db`, created
  automatically) and served back sorted, so the win screen can show
  your rank across runs instead of resetting on every page refresh.

## Running it

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload
```

Then open **http://127.0.0.1:8000** — the backend also serves
`index.html`, `game.js`, and `styles.css` directly, so there's nothing
else to configure and no separate frontend server needed.

## Files

```
escape-room/
├── index.html          # unchanged
├── game.js             # rooms 1/2/4 unchanged; room 3 + win screen now call the API
├── styles.css           # unchanged, plus a couple of small additions for the leaderboard
└── backend/
    ├── app.py           # FastAPI app: subset-sum DP + SQLite leaderboard
    ├── requirements.txt
    └── leaderboard.db   # created on first run
```

## API surface

| Method | Path                     | Purpose                                   |
|--------|--------------------------|--------------------------------------------|
| POST   | `/api/vault/new`         | generate a new vault puzzle                |
| POST   | `/api/vault/check`       | verify a placement against that puzzle     |
| POST   | `/api/leaderboard/submit`| record a completion time                   |
| GET    | `/api/leaderboard/top`   | fetch the fastest recorded times           |
| GET    | `/api/health`            | liveness check                             |
