"""Turn the skater exports in exports/ into the JSON files the site reads.

Usage: python3 prep/prep.py
An export holds per-game averages, so totals are average x games played. Most exports cover
the season so far, and one game is the difference between two consecutive exports. An export
that covers only some games says so in its file name, like ..._18-Nov-2026_games-2-3.xlsx.
Some exports leave out columns (xG, shot attempts, passing...). Those stats are then summed
only over the games that have them, and season.json lists which games each one covers.
A season-to-date file that overlaps a range file keeps the range's games split out; any stat the
range file left out then comes from the season-to-date file for those games too. Retired exports
go in exports/superseded/, which this script ignores.
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
# stats that some exports leave out: family -> (fields, the column that shows the family is there)
FAMILIES = {
    'xg': (['xg', 'xgf', 'xga'], 'xG (Expected goals)'),
    'corsi': (['cf', 'ca'], 'CORSI+'),
    'entries': (['entries', 'breakouts'], 'Entries'),
    'pp': (['pp_min', 'pk_min'], 'Power play time'),
    'ga_on': (['ga_on'], "Opponent's goals when on ice"),
    'pass': ([], 'Accurate passes, %'),
}


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


# ---- read every export. Season-to-date files keep the latest per game count; range files are kept as they are.
snaps, ranges = {}, []
for path in glob.glob(os.path.join(EXPORTS, '*.xlsx')):
    base = os.path.basename(path)
    m = re.search(r'(\d{2}-[A-Za-z]{3}-\d{4})', base)
    date = datetime.datetime.strptime(m.group(1), '%d-%b-%Y').date() if m else datetime.date.fromtimestamp(os.path.getmtime(path))
    rows = read_export(path)
    has = {f for f, (_, col) in FAMILIES.items() if col in rows[0]}
    rg = re.search(r'games?-(\d+)(?:-(\d+))?', base)
    if rg:
        a, b = int(rg.group(1)), int(rg.group(2) or rg.group(1))
        n = max(rnd(num(r['Games played'])) for r in rows)
        if n != b - a + 1:
            raise SystemExit(f'{base}: the name says games {a}-{b}, but the most games played in it is {n}.')
        ranges.append({'first': a, 'last': b, 'date': date, 'file': base, 'rows': rows, 'has': has})
        continue
    game = max(rnd(num(r['Games played'])) for r in rows)
    if game not in snaps or date >= snaps[game]['date']:
        snaps[game] = {'date': date, 'file': base, 'rows': rows, 'has': has}
if not snaps and not ranges:
    raise SystemExit('No .xlsx files found in exports/')

# short names: surname, or first initial plus surname if two players share one
fulls = sorted({r['Player'] for s in list(snaps.values()) + ranges for r in s['rows']})
sur = [n.split()[-1] for n in fulls]
short = {n: (n.split()[-1] if sur.count(n.split()[-1]) == 1 else f'{n[0]}. {n.split()[-1]}') for n in fulls}

# ---- pieces: blocks of games with each player's totals in them
FIELDS = ['gp'] + list(COUNTS) + list(MINUTES) + list(EXPECTED)
pieces, range_pieces = [], []
for rg in ranges:
    tot = {}
    for r in rg['rows']:
        t = totals(r)
        if t['gp']:
            t['pass'] = num(r.get('Accurate passes, %')) if 'pass' in rg['has'] else None
            tot[short[r['Player']]] = t
    range_pieces.append({'first': rg['first'], 'last': rg['last'], 'date': rg['date'], 'tot': tot, 'has': rg['has'], 'cum': False, 'rows': rg['rows']})
prev, prev_n = {}, 0
for game in sorted(snaps):
    s = snaps[game]
    # range files between the previous season-to-date file and this one are their own pieces, so take them off this one
    took = [q for q in range_pieces if q['first'] > prev_n and q['last'] <= game]
    for q in took:
        for sh, t in q['tot'].items():
            before = prev.get(sh)
            prev[sh] = {k: (before[k] if before else 0) + t[k] for k in FIELDS}
    left = sorted(set(range(prev_n + 1, game + 1)) - {g for q in took for g in range(q['first'], q['last'] + 1)})
    if not left or left[-1] - left[0] + 1 != len(left):
        raise SystemExit(f'{s["file"]}: the range files inside it must leave one unbroken block of games, not {left or "none"}.')
    # players in a range file that lacks a stat this file has: keep them even with no games here, to carry that stat
    lacking = {sh for q in took if s['has'] - q['has'] for sh in q['tot']}
    tot = {}
    for r in s['rows']:
        sh, t = short[r['Player']], totals(r)
        before = prev.get(sh)
        if t['gp'] > (before['gp'] if before else 0) or sh in lacking:
            d = {k: round(t[k] - (before[k] if before else 0), 2) for k in FIELDS}
            for k in COUNTS:
                if k not in ('pm',) and d[k] < 0:
                    d[k] = 0
            d['pass'] = num(r.get('Accurate passes, %')) if 'pass' in s['has'] else None
            tot[sh] = d
        prev[sh] = t
    has = s['has'] & (snaps[prev_n]['has'] if prev_n in snaps else s['has'])
    # a family missing from a range taken off is still in this piece's numbers, which then cover the range's games too
    absorb = {f: [q for q in took if f not in q['has']] for f in has}
    pieces.append({'first': left[0], 'last': left[-1], 'date': s['date'], 'tot': tot, 'has': has, 'cum': True, 'rows': s['rows'],
                   'absorb': {f: qs for f, qs in absorb.items() if qs}})
    prev_n = game
pieces += range_pieces
pieces.sort(key=lambda p: p['first'])
nxt = 1
for p in pieces:
    if p['first'] != nxt:
        raise SystemExit(f'Exports do not line up: expected one starting at game {nxt}, found games {p["first"]}-{p["last"]}. '
                         'Check the games-N-M part of the range file names.')
    nxt = p['last'] + 1

# ---- team log: one line per piece (a range file is one line covering several games)
team_log = []
for p in pieces:
    lines = p['tot']
    sm = lambda k: round(sum(l[k] for l in lines.values()), 2)
    team_log.append({
        'game': p['last'], 'first': p['first'], 'date': p['date'].isoformat(), 'skaters': sum(1 for l in lines.values() if l['gp']),
        'g': sm('g'), 'xg': sm('xg') if 'xg' in p['has'] and 'xg' not in p.get('absorb', {}) else None, 'shots': sm('shots'), 'sog': sm('sog'), 'fo': sm('fo'), 'fow': sm('fow'),
        'pim': sm('pim'), 'drawn': sm('drawn'), 'toi': round(sm('toi_t') / (5 * (p['last'] - p['first'] + 1)), 1),
        # no skater can have been on the ice for fewer goals against than the team allowed, so this is a lower bound
        'ga_min': max([l['ga_on'] for l in lines.values()] or [0]) if 'ga_on' in p['has'] and 'ga_on' not in p.get('absorb', {}) else None,
    })
spans = lambda p, f: [p] + p.get('absorb', {}).get(f, []) if f in p['has'] else []
cover = {f: sorted(g for p in pieces for q in spans(p, f) for g in range(q['first'], q['last'] + 1)) for f in FAMILIES}

# ---- each player's season: counts over every piece, family stats only over the pieces that have them
latest, per_game = {}, {}
for p in pieces:
    for r in p['rows']:
        if short[r['Player']] in p['tot']:
            latest[short[r['Player']]] = {'row': r}
    for sh, d in p['tot'].items():
        per_game.setdefault(sh, []).append(dict(d, game=p['last'], first=p['first']))
for sh, v in latest.items():
    ps = [(p, p['tot'][sh]) for p in pieces if sh in p['tot']]
    t = {k: round(sum(d[k] for _, d in ps), 2) for k in FIELDS}
    for k in list(COUNTS) + ['gp']:
        t[k] = rnd(t[k])
    for f in FAMILIES:
        inn = [q['tot'][sh] for p, _ in ps for q in spans(p, f) if sh in q['tot']]
        t['gp_' + f] = rnd(sum(d['gp'] for d in inn))
        for k in ('g', 'pm', 'toi_t'):
            t[k + '_' + f] = round(sum(d[k] for d in inn), 2)
    # shortcut: pass % is a games-weighted average of each piece's figure, exact only when every piece is one file's own games
    pw = [(d['pass'], sum(q['tot'][sh]['gp'] for q in spans(p, 'pass') if sh in q['tot'])) for p, d in ps if d.get('pass') is not None]
    t['pass'] = sum(a * w for a, w in pw) / sum(w for _, w in pw) if pw and sum(w for _, w in pw) else None
    v['tot'] = t

# ---- one record per player: season totals plus rates
players = []
for sh, v in latest.items():
    r, t = v['row'], v['tot']
    gp = t['gp']
    toi = t['toi_t'] / gp if gp else 0
    gx, gc, ge = t['gp_xg'], t['gp_corsi'], t['gp_entries']
    xgnet = t['xgf'] - t['xga']
    p = dict(
        name=r['Player'], short=sh, num=int(num(r['Shirt number'])), pos=r['Position'], gp=gp,
        toi=round(toi, 2), toi_txt=mmss(toi), shifts_pg=round(t['shifts'] / gp, 1),
        g=t['g'], a=t['a'], a1=t['a1'], a2=t['a2'], p=t['p'], pm=t['pm'],
        ppg=round(t['p'] / gp, 2), p60=round(t['p'] / t['toi_t'] * 60, 2) if t['toi_t'] else 0,
        shots=t['shots'], sog=t['sog'], blk=t['blk'], hits=t['hits'],
        shpct=round(t['g'] / t['shots'] * 100, 1) if t['shots'] else 0,
        sogpct=round(t['sog'] / t['shots'] * 100) if t['shots'] else 0,
        # xG stats only over the games that have xG, against the goals and plus-minus from those same games
        gp_xg=gx, xg=t['xg'] if gx else None, g_xg=rnd(t['g_xg']), gxg=round(t['g_xg'] - t['xg'], 2) if gx else None,
        xgf=t['xgf'] if gx else None, xga=t['xga'] if gx else None, netxg=round(xgnet, 2) if gx else None,
        netxg_pg=round(xgnet / gx, 2) if gx else None, pmgap=round(t['pm_xg'] - xgnet, 2) if gx else None,
        netxg60=round(xgnet / t['toi_t_xg'] * 60, 2) if gx and t['toi_t_xg'] else None,
        gp_corsi=gc, corsi=round(t['cf'] / (t['cf'] + t['ca']) * 100, 2) if t['cf'] + t['ca'] else None,
        sc=t['sc'], ga_on=t['ga_on'] if t['gp_ga_on'] else None,
        gp_entries=ge, entries=round(t['entries'] / ge, 1) if ge else None, breakouts=round(t['breakouts'] / ge, 1) if ge else None,
        slot=round(t['slot'] / gp, 2),
        shots_pg=round(t['shots'] / gp, 1), hits_pg=round(t['hits'] / gp, 2), blk_pg=round(t['blk'] / gp, 2),
        fo=t['fo'], fow=t['fow'], fopct=round(t['fow'] / t['fo'] * 100) if t['fo'] else 0,
        fo_dz=t['fo_dz'], fow_dz=t['fow_dz'], fo_nz=t['fo_nz'], fow_nz=t['fow_nz'], fo_oz=t['fo_oz'], fow_oz=t['fow_oz'],
        pim=rnd(t['pim']), drawn=t['drawn'], pp_min=rnd(t['pp_min']), pk_min=rnd(t['pk_min']),
        gp_pass=t['gp_pass'], accpass=rnd(t['pass']) if t['pass'] is not None else None,
        log=[{'game': l['game'], 'first': l['first'], 'toi': round(l['toi_t'], 2), 'g': l['g'], 'a': l['a'], 'p': l['p'], 'shots': l['shots'], 'sog': l['sog']}
             for l in per_game.get(sh, []) if l['gp']],
    )
    players.append(p)
players.sort(key=lambda p: (-p['p'], -p['g'], p['name']))

os.makedirs(OUT, exist_ok=True)
json.dump(players, open(os.path.join(OUT, 'players.json'), 'w'))
json.dump({'games': team_log[-1]['game'], 'updated': team_log[-1]['date'], 'log': team_log, 'cover': cover}, open(os.path.join(OUT, 'season.json'), 'w'))
print(f'{len(players)} players, {len(team_log)} export(s), through game {team_log[-1]["game"]}')
short_of = {f: c for f, c in cover.items() if len(c) < team_log[-1]['game']}
if short_of:
    print('Only some games have: ' + ', '.join(f'{f} (games {", ".join(map(str, c)) or "none"})' for f, c in short_of.items()))
