# Skidmore Hockey Analytics, 2026-27

Game 1: Skidmore scored 7 goals on 5.0 expected from 35 shots on goal, and no skater was on the ice for a goal against. Tang led with 3 points, and Jenkins, Tang and Troutwine had the best shot shares (92%, 90% and 89%).

Faceoffs are the open question after last year. Urban and Fogu split the draws (13 each, 38% and 69%), and the players who graduated took 52% of last season's draws. Stratton, a returner from last year, did not play. Mackenzie is the one new skater in the data.

One thing to fix at the source: the ice time in the game 1 export adds up to about 41 minutes of a 60-minute game, against about 59 last season, while shots and goals look like a full game. Some ice time was probably not logged, so per-60 numbers and ice-time comparisons are low-confidence. The site shows a warning on the Overview tab whenever the total is under 55 minutes.

The page updates itself from the data: the overview write-ups, the player cards, the charts and the comparison with last season are all generated, so nothing needs rewriting between games.

## Update after each game

1. Export the skater spreadsheet and drop it into `exports/` with the date in the file name, like `Skaters_-_Skidmore_Thoroughbreds_16-Nov-2026.xlsx`. Keep every export. Each one is the season to date, and the difference between two exports is one game.
2. Run `python3 prep/prep.py`. It needs `pip install openpyxl`.
3. Commit and push. Vercel redeploys on every push.

```
python3 prep/prep.py
git add .
git commit -m "Game 2"
git push
```

If two exports cover the same game, the one with the later date wins. If a player appears on two rows of an export, the script stops and tells you which one to merge.

## Run it locally

It is a static site with no build step.

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly will not work, because the page loads its data with `fetch`.

## Deploy

Import the repo in Vercel and leave the framework preset on "Other". No build command and no output directory are needed. The page has `noindex`, but a Vercel link is still reachable by anyone who has it.

## What is on the site

- **Overview:** totals, the four headline numbers, one "read with care" strip for the sample-size note and the ice-time check, and six generated write-ups with the top two up front.
- **Players:** a card for every skater. Clicking a player's row in any chart opens their card, and `#players/<name>` links straight to one.
- **Team:** three sections. Scoring covers points, finishing against expected goals and shots. Possession and passing covers shot share, pass accuracy, entries and breakouts. Ice time, faceoffs, penalties covers the rest, plus power-play and penalty-kill time once the export fills them in. A few views stay hidden until the team has played five games.
- **Season:** each returning player against last year, the per-game charts (from game 3) and the game log.
- **Data:** a sortable table of every stat, with a key to the columns, and the method notes.

Green means better than even and orange means worse. Grey means the gap is inside a noise band that shrinks as games are added. Each tab and section has its own URL, so the browser Back button works.

## Files

```
index.html            page layout
style.css             green and gold theme
app.js                charts, tabs and all generated text
vendor/d3.min.js      d3 v7.9.0, served from the repo so the page never depends on a CDN
exports/              one spreadsheet per game, season to date
data/players.json     built by prep.py
data/season.json      built by prep.py, with the game log
data/last-season.json last season's numbers, fixed
prep/prep.py          exports to JSON
```
