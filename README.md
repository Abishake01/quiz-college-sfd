# ✏️ Doodle Quiz

Sketchbook-style multiplayer MCQ quiz. Admins build quiz projects, start/stop live tests, and see what everyone clicked first.

## Setup

```bash
npm install
cp .env.example .env      # paste your Neon DATABASE_URL, set ADMIN_PASSWORD
npm start                 # or: npm run dev (auto-restart)
```

Tables are created automatically on first start.

- Players: `http://localhost:3000` (or `/play/<CODE>`)
- Admin: `http://localhost:3000/admin`

Phones on the same Wi-Fi can use the LAN address printed at startup.

## How it works

- **Projects** hold MCQ questions (2–6 options). Add them one by one or **Upload CSV** (template in the upload dialog).
- **🔒 Must pick the correct answer** checkbox: the player can't reach the next page until they tap the right answer. After N wrong tries (project setting), the correct option is circled with “psst… it's this one!”.
- Unlocked questions are one-shot: a wrong tap reveals “here's the answer!” and the player moves on.
- **Wrong-answer reaction** per question: BOOM, POOF, disappear, SPLAT, NOPE shake, or random.
- **Run test / Stop test**: players enter their name first, wait in a lobby, and are pulled in live when you start. Stopping shows everyone “Pencils down!” and opens the results.
- **Results**: per question, the distribution of each person's *first* click (what they thought was right), trick-question callouts, and a scoreboard (score = right on first click). Past runs are kept; export to CSV.

## Multiplayer

Live updates use Server-Sent Events. Events are also broadcast through Postgres `LISTEN/NOTIFY`, so several server instances stay in sync. For that, use Neon's **direct** connection string (host without `-pooler`). With the pooled string it still works fine on a single server.
