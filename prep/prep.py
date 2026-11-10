"""Turn the cumulative skater exports in exports/ into the JSON files the site reads.

Usage: python3 prep/prep.py
Each export holds per-game averages for the whole season so far, so season totals are
average x games played, and one game is the difference between two consecutive exports.
"""
import glob, json, math, os, re, datetime
import openpyxl

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
EXPORTS = os.path.join(ROOT, 'exports')
OUT = os.path.join(ROOT, 'data')

# output field -> spreadsheet column
COUNTS = {
    'shifts': 'All shifts', 'g': 'Goals', 'a1': 'First assist', 'a2': 'Second assist', 'a': 'Assists', 'p': 'Points', 'pm': '+/-',
    'sc': 'Scoring chances', 'drawn': 'Penalties drawn', 'hits': 'Hits', 'shots': 'Shots', 'sog': 'Shots on goal',
    'blk': 'Blocked shots', 'slot': 'Passes to the slot', 'entries': 'Entries', 'breakouts': 'Breakouts',
    'cf': 'CORSI+', 'ca': 'CORSI-', 'ga_on': "Opponent's goals when on ice",
    'fo': 'Faceoffs', 'fow': 'Faceoffs won', 'fo_dz': 'Faceoffs in DZ', 'fow_dz': 'Faceoffs won in DZ',
    'fo_nz': 'Faceoffs in NZ', 'fow_nz': 'Faceoffs won in NZ', 'fo_oz': 'Faceoffs in OZ', 'fow_oz': 'Faceoffs won in OZ',
}
MINUTES = {'toi_t': 'Time on ice', 'pim': 'Penalty time', 'pp_min': 'Power play time', 'pk_min': 'Short-handed time'}
EXPECTED = {'xg': 'xG (Expected goals)', 'xgf': 'Team xG when on ice', 'xga': "Opponent's xG when on ice"}


def num(v):
    """Spreadsheet cell to a number. '-' is zero, 'mm:ss' is minutes, '55%' is 55."""
    if v is None or v == '-':
        return 0.0
    if isinstance(v, str):
        if re.fullmatch(r'\d+:\d+', v):
            m, s = v.split(':')
            return int(m) + int(s) / 60
        return float(v.rstrip('%'))
    return float(v)


def rnd(x):
    return int(math.floor(x + 0.5))


def mmss(minutes):
    s = rnd(minutes * 60)
    return f'{s // 60}:{s % 60:02d}'


def read_export(path):
    rows = list(openpyxl.load_workbook(path, data_only=True).active.iter_rows(values_only=True))
    out = [dict(zip(rows[0], r)) for r in rows[1:] if r[1]]
    names = [r['Player'] for r in out]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise SystemExit(f'{os.path.basename(path)}: {", ".join(sorted(dupes))} appears on more than one row. Merge the rows first.')
    return out


def totals(d):
    gp = num(d['Games played'])
    t = {'gp': rnd(gp)}
    for k, c in COUNTS.items():
        t[k] = rnd(num(d.get(c)) * gp)
    for k, c in MINUTES.items():
        t[k] = round(num(d.get(c)) * gp, 2)
    for k, c in EXPECTED.items():
        t[k] = round(num(d.get(c)) * gp, 2)
    return t


# ---- read every export, keep the latest file for each game number
snaps = {}
for path in glob.glob(os.path.join(EXPORTS, '*.xlsx')):
    m = re.search(r'(\d{2}-[A-Za-z]{3}-\d{4})', os.path.basename(path))
    date = datetime.datetime.strptime(m.group(1), '%d-%b-%Y').date() if m else datetime.date.fromtimestamp(os.path.getmtime(path))
    rows = read_export(path)
    game = max(rnd(num(r['Games played'])) for r in rows)
    if game not in snaps or date >= snaps[game]['date']:
        snaps[game] = {'date': date, 'file': os.path.basename(path), 'rows': rows}
if not snaps:
    raise SystemExit('No .xlsx files found in exports/')

# short names: surname, or first initial plus surname if two players share one
fulls = sorted({r['Player'] for s in snaps.values() for r in s['rows']})
sur = [n.split()[-1] for n in fulls]
short = {n: (n.split()[-1] if sur.count(n.split()[-1]) == 1 else f'{n[0]}. {n.split()[-1]}') for n in fulls}

# ---- per-game lines from the difference between consecutive exports
LOG_KEYS = ['toi_t', 'g', 'a', 'p', 'pm', 'shots', 'sog', 'xg', 'pim', 'drawn', 'fo', 'fow', 'hits', 'blk', 'ga_on']
prev, per_game, team_log, latest = {}, {}, [], {}
for game in sorted(snaps):
    s = snaps[game]
    lines = {}
    for r in s['rows']:
        sh, t = short[r['Player']], totals(r)
        before = prev.get(sh)
        if t['gp'] > (before['gp'] if before else 0):
            line = {k: round(t[k] - (before[k] if before else 0), 2) for k in LOG_KEYS}
            for k in LOG_KEYS:
                if k not in ('pm', 'toi_t', 'xg') and line[k] < 0:
                    line[k] = 0
            line['game'] = game
            lines[sh] = line
            per_game.setdefault(sh, []).append(line)
        prev[sh] = t
        latest[sh] = {'row': r, 'tot': t}
    sm = lambda k: round(sum(l[k] for l in lines.values()), 2)
    team_log.append({
        'game': game, 'date': s['date'].isoformat(), 'skaters': len(lines),
        'g': sm('g'), 'xg': sm('xg'), 'shots': sm('shots'), 'sog': sm('sog'), 'fo': sm('fo'), 'fow': sm('fow'),
        'pim': sm('pim'), 'drawn': sm('drawn'),
        # no skater can have been on the ice for fewer goals against than the team allowed, so this is a lower bound
        'ga_min': max([l['ga_on'] for l in lines.values()] or [0]),
    })

# ---- one record per player: latest totals plus rates
players = []
for sh, v in latest.items():
    r, t = v['row'], v['tot']
    gp = t['gp']
    toi = t['toi_t'] / gp if gp else 0
    p = dict(
        name=r['Player'], short=sh, num=int(num(r['Shirt number'])), pos=r['Position'], gp=gp,
        toi=round(toi, 2), toi_txt=mmss(toi), shifts_pg=round(t['shifts'] / gp, 1),
        g=t['g'], a=t['a'], a1=t['a1'], a2=t['a2'], p=t['p'], pm=t['pm'],
        ppg=round(t['p'] / gp, 2), p60=round(t['p'] / t['toi_t'] * 60, 2) if t['toi_t'] else 0,
        shots=t['shots'], sog=t['sog'], blk=t['blk'], hits=t['hits'],
        shpct=round(t['g'] / t['shots'] * 100, 1) if t['shots'] else 0,
        sogpct=round(t['sog'] / t['shots'] * 100) if t['shots'] else 0,
        xg=t['xg'], gxg=round(t['g'] - t['xg'], 2),
        xgf=t['xgf'], xga=t['xga'], netxg=round(t['xgf'] - t['xga'], 2), netxg_pg=round((t['xgf'] - t['xga']) / gp, 2),
        pmgap=round(t['pm'] - (t['xgf'] - t['xga']), 2),
        netxg60=round((t['xgf'] - t['xga']) / t['toi_t'] * 60, 2) if t['toi_t'] else 0,
        corsi=round(t['cf'] / (t['cf'] + t['ca']) * 100, 2) if t['cf'] + t['ca'] else None,
        sc=t['sc'], ga_on=t['ga_on'],
        entries=round(t['entries'] / gp, 1), breakouts=round(t['breakouts'] / gp, 1), slot=round(t['slot'] / gp, 2),
        shots_pg=round(t['shots'] / gp, 1), hits_pg=round(t['hits'] / gp, 2), blk_pg=round(t['blk'] / gp, 2),
        fo=t['fo'], fow=t['fow'], fopct=round(t['fow'] / t['fo'] * 100) if t['fo'] else 0,
        fo_dz=t['fo_dz'], fow_dz=t['fow_dz'], fo_nz=t['fo_nz'], fow_nz=t['fow_nz'], fo_oz=t['fo_oz'], fow_oz=t['fow_oz'],
        pim=rnd(t['pim']), drawn=t['drawn'], pp_min=rnd(t['pp_min']), pk_min=rnd(t['pk_min']),
        accpass=rnd(num(r.get('Accurate passes, %'))),
        log=[{'game': l['game'], 'toi': round(l['toi_t'], 2), 'g': l['g'], 'a': l['a'], 'p': l['p'], 'shots': l['shots'], 'sog': l['sog'], 'xg': l['xg']}
             for l in per_game.get(sh, [])],
    )
    players.append(p)
players.sort(key=lambda p: (-p['p'], -p['g'], p['name']))

os.makedirs(OUT, exist_ok=True)
json.dump(players, open(os.path.join(OUT, 'players.json'), 'w'))
json.dump({'games': team_log[-1]['game'], 'updated': team_log[-1]['date'], 'log': team_log}, open(os.path.join(OUT, 'season.json'), 'w'))
print(f'{len(players)} players, {len(team_log)} export(s), through game {team_log[-1]["game"]}')
