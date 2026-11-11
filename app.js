(function () {
  const root = document.getElementById('app');
  const $ = (s, el) => (el || root).querySelector(s);
  const $$ = (s, el) => [...(el || root).querySelectorAll(s)];

  function fail(msg) {
    $('#th-error-msg').textContent = msg;
    $('#th-error').hidden = false;
    $$('.th-pane').forEach((p) => { p.hidden = true; });
    $('#th-status').textContent = 'Could not load the data';
  }
  $('#th-retry').addEventListener('click', () => location.reload());
  if (!window.d3) { fail('The chart library (vendor/d3.min.js) did not load. Check the connection and try again.'); return; }

  /* data colors: good / bad against an even line, noise for gaps too small to mean much */
  const C = { g: '#235240', bad: '#d0742a', badText: '#a65a1e', n: '#b4bdb8', s2: '#8ea2ab', s3: '#e3c873', gold: '#ab8d3b' };

  let P = [], S = { games: 1, updated: '', log: [] }, LAST = {}, G = 1, minGP = 1, tracked = 60, PB = 0;
  const f0 = d3.format('d'), f1 = d3.format('.1f'), f2 = d3.format('.2f');
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + (f || f1)(Math.abs(v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b = (v) => '<b>' + esc(v) + '</b>';
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const count = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const byDesc = (f) => (a, c) => c[f] - a[f] || a.name.localeCompare(c.name);
  const iceOK = () => tracked >= 55;
  /* green above the even line, orange below, grey inside the noise band */
  const tone = (v, base, band) => (Math.abs(v - (base || 0)) < (band || 0) ? C.n : v > (base || 0) ? C.g : C.bad);
  const DEC = { ppg: 2, p60: 2, shpct: 1, xg: 2, gxg: 2, netxg: 2, corsi: 1, entries: 1, breakouts: 1, slot: 2 };
  const show = (f, v) => (v == null ? '–' : typeof v === 'number' && DEC[f] != null ? v.toFixed(DEC[f]) : String(v));
  const fmtDate = (iso) => d3.timeFormat('%B %-d, %Y')(new Date(iso + 'T12:00:00'));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const message = (el, text) => { const d = document.createElement('div'); d.className = 'th-early'; d.textContent = text; el.replaceChildren(d); };
  const gate = (sel, need, why) => { if (G >= need) return false; message($(sel), `This chart appears once the team has played ${need} games. ${why || `With ${count(G, 'game')}, it would mostly show noise.`}`); return true; };

  /* ---------- chart helpers ---------- */
  function mkSvg(el, summary) {
    el.replaceChildren();
    const prev = el.previousElementSibling;
    const card = el.closest('.th-card');
    const h = prev && prev.matches('h5') ? prev : card && card.querySelector('.th-ch, h3');
    const title = h ? h.textContent : 'Chart';
    return d3.select(el).append('svg').attr('width', '100%').attr('role', 'img')
      .attr('aria-label', title + '. ' + (summary || []).join('; ') + '.');
  }
  function tw(svg, strs, size) {
    const t = svg.append('text').attr('font-size', size || 11).attr('visibility', 'hidden');
    let m = 0;
    strs.forEach((s) => { t.text(s); m = Math.max(m, t.node().getComputedTextLength()); });
    t.remove();
    return Math.ceil(m);
  }
  function tipFor(el) {
    const card = el.closest('.th-card');
    let t = card.querySelector(':scope > .th-tip');
    if (!t) { t = document.createElement('div'); t.className = 'th-tip'; t.hidden = true; card.appendChild(t); }
    return {
      show(ev, lines, foot) {
        t.replaceChildren();
        lines.concat(foot ? [foot] : []).forEach((l, i, all) => {
          const d = document.createElement('div');
          if (i === 0) d.className = 'th-tip-h';
          else if (foot && i === all.length - 1) d.className = 'th-tip-f';
          d.textContent = l;
          t.appendChild(d);
        });
        t.hidden = false;
        const [x, y] = d3.pointer(ev, card);
        const w = t.offsetWidth, cw = card.clientWidth;
        t.style.left = Math.max(4, Math.min(cw - w - 4, x + 12)) + 'px';
        t.style.top = y + 16 + 'px';
      },
      hide() { t.hidden = true; },
    };
  }
  /* hover shows values with a mouse; on touch the first tap shows them and a second tap opens the card */
  let lastPointer = 'mouse';
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
  function bindRows(sel, rowsSel, o, tip) {
    let tapped = null;
    const dim = (d) => rowsSel && rowsSel.style('opacity', (e) => (d == null || e === d ? 1 : 0.45));
    const foot = (touch) => (o.player === false ? null : touch ? 'Tap again to open the player card' : 'Click to open the player card');
    if (o.player !== false) (rowsSel || sel).classed('go', true);
    sel.on('pointermove', (ev, d) => { if (ev.pointerType === 'touch') return; dim(d); tip.show(ev, o.tip(d), foot(false)); })
      .on('pointerleave', (ev) => { if (ev.pointerType === 'touch') return; dim(null); tip.hide(); })
      .on('click', (ev, d) => {
        if (lastPointer === 'touch' && tapped !== d) { tapped = d; dim(d); tip.show(ev, o.tip(d), foot(true)); return; }
        if (o.player !== false) openPlayer(d.short);
      });
  }
  function axisStyle(g) {
    g.attr('font-size', null).attr('font-family', null);
    g.select('.domain').remove();
    g.selectAll('line').style('stroke', 'var(--chart-grid)');
    g.selectAll('text').style('fill', 'var(--ink2)').attr('font-size', 11);
  }
  /* legend that wraps onto a second line on narrow screens; returns its height */
  function legend(svg, x, series, w, draw) {
    let lx = x, ly = 0;
    series.forEach((s) => {
      const tl = tw(svg, [s.name], 12);
      if (lx > x && lx + 15 + tl > w) { lx = x; ly += 18; }
      if (draw) {
        svg.append('rect').attr('x', lx).attr('y', ly + 4).attr('width', 10).attr('height', 10).attr('rx', 2).style('fill', s.color);
        svg.append('text').attr('x', lx + 15).attr('y', ly + 13).attr('font-size', 12).style('fill', 'var(--ink)').text(s.name);
      }
      lx += 15 + tl + 18;
    });
    return ly + 24;
  }

  /* horizontal bars: o = {label, value, color, vlabel, tip, base, domain, tick, rowH, ref:{v,label}, player} */
  function hbar(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el, data.map((d) => o.label(d) + ' ' + o.vlabel(d)));
    const base = o.base || 0, rowH = o.rowH || 24, bh = Math.min(16, rowH - 8);
    const lw = Math.min(tw(svg, data.map(o.label), 12) + 12, w * 0.4);
    const vw = Math.min(tw(svg, data.map(o.vlabel)) + 8, w * 0.35);
    const vals = data.map(o.value);
    let lo = Math.min(base, ...vals), hi = Math.max(base, ...vals);
    if (o.domain) { lo = o.domain[0]; hi = o.domain[1]; }
    const hasNeg = lo < base;
    const m = { t: o.ref ? 20 : 4, r: vw + 4, b: 22, l: lw + (hasNeg ? vw : 0) };
    const H = m.t + m.b + rowH * data.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const x = d3.scaleLinear([lo, hi], [m.l, w - m.r]);
    if (!o.domain) x.nice(4);
    const ax = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call((() => {
        const a = d3.axisBottom(x).ticks(Math.max(2, Math.floor((w - m.l - m.r) / 80))).tickSize(-(H - m.b - m.t)).tickFormat(o.tick || ((d) => d));
        return o.tick === f0 ? a.tickValues(x.ticks(Math.max(2, Math.floor((w - m.l - m.r) / 80))).filter(Number.isInteger)) : a;
      })());
    axisStyle(ax);
    svg.append('line').attr('x1', x(base)).attr('x2', x(base)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--chart-axis)');
    if (o.ref) {
      const rx = x(o.ref.v);
      svg.append('line').attr('x1', rx).attr('x2', rx).attr('y1', m.t - 4).attr('y2', H - m.b)
        .style('stroke', 'var(--chart-ref)').attr('stroke-dasharray', '4 3').attr('stroke-width', 1.5);
      const rt = svg.append('text').attr('y', 11).attr('font-size', 11).style('fill', 'var(--ink2)').text(o.ref.label);
      const rl = rt.node().getComputedTextLength();
      rt.attr('x', Math.max(m.l, Math.min(w - rl - 2, rx - rl / 2)));
    }
    const tip = tipFor(el);
    const gr = svg.selectAll('g.r').data(data).join('g').attr('class', 'r')
      .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12)
      .style('fill', 'var(--ink)').text((d) => o.label(d));
    gr.append('rect').attr('y', (rowH - bh) / 2).attr('height', bh).attr('rx', 3)
      .attr('x', (d) => Math.min(x(base), x(o.value(d))))
      .attr('width', (d) => Math.max(1, Math.abs(x(o.value(d)) - x(base))))
      .style('fill', (d) => o.color(d));
    gr.append('text').attr('y', rowH / 2 + 4).attr('font-size', 11).style('fill', 'var(--ink2)')
      .attr('x', (d) => (o.value(d) >= base ? x(o.value(d)) + 5 : x(o.value(d)) - 5))
      .attr('text-anchor', (d) => (o.value(d) >= base ? 'start' : 'end'))
      .text((d) => o.vlabel(d));
    const hit = gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent');
    bindRows(hit, gr, o, tip);
  }

  /* scatter: o = {x, y, label, color, shape, xt, yt, xd, yd, ref, tip, prio, corner} */
  function scatter(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el, [o.xt + ' across, ' + o.yt + ' up'].concat(data.map((d) => `${o.label(d)} ${f1(o.x(d))}, ${f1(o.y(d))}`)));
    const H = Math.round(Math.max(360, Math.min(540, w * 0.95)));
    const m = { t: o.shape ? 30 : 10, r: 14, b: 40, l: 46 };
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    if (o.shape) {
      const lg = svg.append('g').attr('transform', `translate(${m.l},12)`);
      [['c', 'Forward'], ['s', 'Defenseman']].forEach(([s, txt], i) => {
        const gx0 = i * 100;
        lg.append('path').attr('transform', `translate(${gx0 + 6},0)`)
          .attr('d', d3.symbol().type(s === 's' ? d3.symbolSquare : d3.symbolCircle).size(70)())
          .style('fill', 'var(--ink2)');
        lg.append('text').attr('x', gx0 + 17).attr('y', 4).attr('font-size', 12).style('fill', 'var(--ink)').text(txt);
      });
    }
    const x = d3.scaleLinear(o.xd, [m.l, w - m.r]), y = d3.scaleLinear(o.yd, [H - m.b, m.t]);
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(w / 90))).tickSize(-(H - m.b - m.t))));
    axisStyle(svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickSize(-(w - m.l - m.r))));
    svg.append('text').attr('x', (m.l + w - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle').attr('font-size', 12)
      .style('fill', 'var(--ink2)').text(o.xt);
    svg.append('text').attr('transform', `translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle')
      .attr('font-size', 12).style('fill', 'var(--ink2)').text(o.yt);
    if (o.ref) {
      const s = o.ref.slope;
      const xa = Math.max(o.xd[0], o.yd[0] / s), xb = Math.min(o.xd[1], o.yd[1] / s);
      svg.append('line').attr('x1', x(xa)).attr('y1', y(s * xa)).attr('x2', x(xb)).attr('y2', y(s * xb))
        .style('stroke', 'var(--chart-ref)').attr('stroke-dasharray', '5 4').attr('stroke-width', 1.5);
      if (o.ref.label && w >= 520) {
        svg.append('text').attr('x', x(xb) - 4).attr('y', y(s * xb) - 8).attr('text-anchor', 'end').attr('font-size', 11)
          .style('fill', 'var(--ink2)').text(o.ref.label);
      }
    }
    (o.corner || []).forEach((c) => {
      svg.append('text').attr('x', c.right ? w - m.r - 6 : m.l + 6).attr('y', c.bottom ? H - m.b - 8 : m.t + 14)
        .attr('text-anchor', c.right ? 'end' : 'start').attr('font-size', 11).style('fill', 'var(--ink2)')
        .style('font-style', 'italic').text(c.text);
    });
    const tip = tipFor(el);
    const sym = (s) => d3.symbol().type(s === 's' ? d3.symbolSquare : d3.symbolCircle).size(s === 's' ? 62 : 80)();
    const pts = svg.selectAll('path.pt').data(data).join('path').attr('class', 'pt r')
      .attr('transform', (d) => `translate(${x(o.x(d))},${y(o.y(d))})`)
      .attr('d', (d) => sym(o.shape ? o.shape(d) : 'c'))
      .style('fill', (d) => o.color(d)).style('stroke', 'var(--panel)').attr('stroke-width', 1.5);
    /* labels, greedy placement */
    const boxes = data.map((d) => ({ x0: x(o.x(d)) - 7, x1: x(o.x(d)) + 7, y0: y(o.y(d)) - 7, y1: y(o.y(d)) + 7 }));
    const gl = svg.append('g');
    const pos = [[8, 4, 'start'], [-8, 4, 'end'], [0, -9, 'middle'], [0, 17, 'middle'], [8, -7, 'start'], [-8, -7, 'end'], [8, 14, 'start'], [-8, 14, 'end']];
    const order = [...data].sort((a, c) => (o.prio ? o.prio(c) - o.prio(a) : 0));
    const hit = (p, q) => !(p.x1 < q.x0 || p.x0 > q.x1 || p.y1 < q.y0 || p.y0 > q.y1);
    const placed = [];
    order.forEach((d) => {
      const px = x(o.x(d)), py = y(o.y(d));
      const t = gl.append('text').attr('font-size', 11).style('fill', 'var(--ink)').style('pointer-events', 'none').text(o.label(d));
      const tl = t.node().getComputedTextLength();
      for (const [dx, dy, an] of pos) {
        const x0 = an === 'start' ? px + dx : an === 'end' ? px + dx - tl : px + dx - tl / 2;
        const bx = { x0, x1: x0 + tl, y0: py + dy - 10, y1: py + dy + 3 };
        if (bx.x0 < 2 || bx.x1 > w - 2 || bx.y0 < 2 || bx.y1 > H - m.b + 12) continue;
        if (boxes.some((c) => hit(bx, c)) || placed.some((c) => hit(bx, c))) continue;
        t.attr('x', px + dx).attr('y', py + dy).attr('text-anchor', an);
        placed.push(bx);
        return;
      }
      t.remove();
    });
    bindRows(pts, pts, o, tip);
  }

  /* grouped horizontal bars with two series */
  function gbar(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el, data.map((d) => `${o.label(d)}: ${o.series.map((s) => s.name.toLowerCase() + ' ' + d[s.f]).join(', ')}`));
    const rowH = 30, bh = 10;
    const lw = Math.min(tw(svg, data.map(o.label), 12) + 12, w * 0.4);
    const vw = tw(svg, data.flatMap((d) => o.series.map((s) => String(d[s.f])))) + 10;
    const m = { t: legend(svg, lw, o.series, w), r: vw, b: 22, l: lw };
    const H = m.t + m.b + rowH * data.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const hi = d3.max(data, (d) => Math.max(...o.series.map((s) => d[s.f])));
    const x = d3.scaleLinear([0, hi], [m.l, w - m.r]).nice(hi <= 8 ? Math.ceil(hi) : 4);
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(hi <= 8 ? Math.ceil(hi) : Math.max(2, Math.floor((w - m.l - m.r) / 80))).tickSize(-(H - m.b - m.t))));
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--chart-axis)');
    legend(svg, m.l, o.series, w, true);
    const tip = tipFor(el);
    const gr = svg.selectAll('g.r').data(data).join('g').attr('class', 'r')
      .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12)
      .style('fill', 'var(--ink)').text((d) => o.label(d));
    o.series.forEach((s, k) => {
      const y0 = rowH / 2 - bh - 1 + k * (bh + 2);
      gr.append('rect').attr('x', x(0)).attr('y', y0).attr('height', bh).attr('rx', 3)
        .attr('width', (d) => Math.max(1, x(d[s.f]) - x(0))).style('fill', s.color);
      gr.append('text').attr('x', (d) => x(d[s.f]) + 5).attr('y', y0 + bh - 1).attr('font-size', 11)
        .style('fill', 'var(--ink2)').text((d) => d[s.f]);
    });
    const hit = gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent');
    bindRows(hit, gr, o, tip);
  }

  /* stacked horizontal bars: o = {label, series:[{name,f,color}], total, vlabel, tip} */
  function sbar(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const vl = o.vlabel || ((d) => String(o.total(d)));
    const svg = mkSvg(el, data.map((d) => `${o.label(d)} ${vl(d)} (${o.series.map((s) => s.name.toLowerCase() + ' ' + d[s.f]).join(', ')})`));
    const rowH = 26, bh = 16;
    const lw = Math.min(tw(svg, data.map(o.label), 12) + 12, w * 0.4);
    const vw = tw(svg, data.map(vl)) + 8;
    const m = { t: legend(svg, lw, o.series, w), r: vw + 4, b: 22, l: lw };
    const H = m.t + m.b + rowH * data.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const hi = d3.max(data, o.total);
    const x = d3.scaleLinear([0, hi], [m.l, w - m.r]).nice(Math.min(hi, 5));
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.min(hi, Math.max(2, Math.floor((w - m.l - m.r) / 80)))).tickSize(-(H - m.b - m.t)).tickFormat(f0)));
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--chart-axis)');
    legend(svg, m.l, o.series, w, true);
    const tip = tipFor(el);
    const gr = svg.selectAll('g.r').data(data).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12).style('fill', 'var(--ink)').text((d) => o.label(d));
    o.series.forEach((s, k) => {
      gr.append('rect').attr('y', (rowH - bh) / 2).attr('height', bh)
        .attr('x', (d) => x(d3.sum(o.series.slice(0, k), (q) => d[q.f])))
        .attr('width', (d) => Math.max(0, x(d[s.f]) - x(0) - (d[s.f] > 0 ? 1 : 0)))
        .style('fill', s.color);
    });
    gr.append('text').attr('x', (d) => x(o.total(d)) + 5).attr('y', rowH / 2 + 4).attr('font-size', 11).style('fill', 'var(--ink2)').text(vl);
    const hit = gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent');
    bindRows(hit, gr, o, tip);
  }

  /* clustered columns, one cluster per game: o = {series:[{name,f,color}], tip} */
  function gcols(el, rows, o) {
    const w = el.clientWidth;
    if (!w || !rows.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el, rows.map((r) => `Game ${r.game}: ${o.series.map((s) => s.name.toLowerCase() + ' ' + (s.fmt || String)(r[s.f])).join(', ')}`));
    const H = 270, m = { t: legend(svg, 38, o.series, w) + 6, r: 10, b: 28, l: 38 };
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const x0 = d3.scaleBand(rows.map((r) => r.game), [m.l, w - m.r]).padding(0.25);
    const bw = Math.min(x0.bandwidth() / o.series.length, 44), cw = bw * o.series.length;
    const hi = d3.max(rows, (r) => d3.max(o.series, (s) => r[s.f]));
    const y = d3.scaleLinear([0, hi * 1.1], [H - m.b, m.t]).nice(5);
    axisStyle(svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r))));
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x0).tickSize(0).tickFormat((g) => 'Game ' + g)));
    svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--chart-axis)');
    legend(svg, m.l, o.series, w, true);
    const tip = tipFor(el);
    const gr = svg.selectAll('g.c').data(rows).join('g').attr('class', 'c').attr('transform', (r) => `translate(${x0(r.game) + (x0.bandwidth() - cw) / 2},0)`);
    o.series.forEach((s, k) => {
      gr.append('rect').attr('x', k * bw + 1).attr('width', bw - 2).attr('rx', 3).attr('y', (r) => y(r[s.f])).attr('height', (r) => y(0) - y(r[s.f])).style('fill', s.color);
      gr.append('text').attr('x', k * bw + bw / 2).attr('y', (r) => y(r[s.f]) - 5).attr('text-anchor', 'middle').attr('font-size', 11).style('fill', 'var(--ink2)').text((r) => (s.fmt || String)(r[s.f]));
    });
    const hit = gr.append('rect').attr('width', cw).attr('y', m.t).attr('height', H - m.t - m.b).style('fill', 'transparent');
    bindRows(hit, null, { tip: o.tip, player: false }, tip);
  }

  /* before-and-after: hollow dot last season, triangle this season pointing the way it moved */
  function dumbbell(el, rows, o) {
    const w = el.clientWidth;
    if (!w || !rows.length) { el.replaceChildren(); return; }
    const delta = (r) => o.cur(r) - o.prev(r);
    const dir = (r) => (Math.abs(delta(r)) < o.band ? 0 : delta(r) > 0 ? 1 : -1);
    const word = (r) => (dir(r) === 0 ? 'about the same' : dir(r) > 0 ? 'up' : 'down');
    const svg = mkSvg(el, rows.map((r) => `${o.label(r)} ${word(r)}, ${o.dfmt(delta(r))}`));
    const rowH = 26;
    const lw = Math.min(tw(svg, rows.map(o.label), 12) + 12, w * 0.4);
    const vw = Math.min(tw(svg, rows.map((r) => o.dfmt(delta(r)))) + 10, w * 0.3);
    const m = { t: 4, r: vw + 4, b: 22, l: lw };
    const H = m.t + m.b + rowH * rows.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const vals = rows.flatMap((r) => [o.cur(r), o.prev(r)]);
    const x = d3.scaleLinear([d3.min(vals), d3.max(vals)], [m.l + 8, w - m.r - 8]).nice(4);
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((w - m.l - m.r) / 80))).tickSize(-(H - m.b - m.t))));
    const tip = tipFor(el);
    const col = (r) => [C.n, C.g, C.bad][[0, 1, -1].indexOf(dir(r))];
    const txt = (r) => ['var(--ink2)', C.g, C.badText][[0, 1, -1].indexOf(dir(r))];
    const gr = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12).style('fill', 'var(--ink)').text((d) => o.label(d));
    gr.append('line').attr('y1', rowH / 2).attr('y2', rowH / 2).attr('x1', (d) => x(o.prev(d))).attr('x2', (d) => x(o.cur(d)))
      .style('stroke', col).attr('stroke-width', 3).attr('stroke-linecap', 'round').style('opacity', 0.6);
    gr.append('circle').attr('cx', (d) => x(o.prev(d))).attr('cy', rowH / 2).attr('r', 5).style('fill', 'var(--panel)').style('stroke', 'var(--chart-axis)').attr('stroke-width', 2);
    gr.append('path')
      .attr('d', (d) => d3.symbol().type(dir(d) === 0 ? d3.symbolCircle : d3.symbolTriangle).size(dir(d) === 0 ? 90 : 110)())
      .attr('transform', (d) => `translate(${x(o.cur(d))},${rowH / 2}) rotate(${dir(d) * 90})`)
      .style('fill', col).style('stroke', 'var(--panel)').attr('stroke-width', 1);
    gr.append('text').attr('x', w - m.r + 8).attr('y', rowH / 2 + 4).attr('font-size', 11).attr('font-weight', 600).style('fill', txt).text((d) => o.dfmt(delta(d)));
    const hit = gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent');
    bindRows(hit, gr, o, tip);
  }

  /* ---------- overview ---------- */
  const sum = (f) => d3.sum(P, (r) => r[f]);
  const pctOf = (a, c) => (c ? Math.round((a / c) * 100) : 0);

  function insights() {
    const out = [];
    const s = Math.sqrt(G);
    const first = (r) => esc(r.short);

    const goals = sum('g'), xg = sum('xg');
    const maxP = d3.max(P, (r) => r.p);
    const lead = P.filter((r) => r.p === maxP && maxP > 0);
    const scorers = P.filter((r) => r.g > 0).sort(byDesc('g'));
    out.push({
      id: 'scoring', eyebrow: 'Scoring', go: 'team/scoring', link: 'points charts',
      title: !lead.length ? 'No points yet' : lead.length === 1 ? `${lead[0].short} leads with ${count(maxP, 'point')}` : `${list(lead.map((r) => r.short))} lead with ${count(maxP, 'point')} each`,
      body: goals === 0 ? 'The team has not scored yet.'
        : `The team scored ${b(goals)} on ${b(f1(xg))} expected goals, from ${count(scorers.length, 'different scorer')}: ${list(scorers.map((r) => first(r) + (r.g > 1 ? ' (' + r.g + ')' : '')))}.`
          + (lead.length === 1 ? ` ${first(lead[0])} had ${count(lead[0].g, 'goal')} and ${count(lead[0].a, 'assist')}.` : ''),
    });

    const over = P.filter((r) => r.gxg >= 0.5 * s).sort(byDesc('gxg')).slice(0, 3);
    const under = P.filter((r) => r.xg >= 0.4 * s && r.gxg <= -0.4 * s).sort((a, c) => a.gxg - c.gxg).slice(0, 3);
    const caveat = G < 5 ? `With ${count(G, 'game')} played, treat this as noise. Expected goals is a model, and gaps this size usually shrink.` : 'Expected goals is a model, and gaps this size often shrink over a season.';
    out.push({
      id: 'finishing', eyebrow: 'Finishing', go: 'team/scoring', link: 'finishing chart',
      title: over.length ? `${list(over.slice(0, 2).map((r) => r.short))} scored well above the chances` : 'Nobody is far from their chances',
      body: [
        over.length ? `${list(over.map((r) => `${first(r)} (${r.g} on ${f1(r.xg)} expected)`))} scored more than the shots were worth.` : '',
        under.length ? `${list(under.map((r) => `${first(r)} (${r.g} on ${f1(r.xg)})`))} scored less.` : '',
        caveat,
      ].filter(Boolean).join(' '),
    });

    const el = P.filter((r) => r.gp >= minGP && r.corsi != null).sort(byDesc('corsi'));
    if (el.length >= 6) {
      const top = el.slice(0, 3), low = el.slice(-3).reverse();
      const bx = P.slice().sort(byDesc('netxg_pg'))[0];
      out.push({
        id: 'possession', eyebrow: 'Possession', go: 'team/impact', link: 'shot-share charts',
        title: `${top[0].short} had the best shot share, ${Math.round(top[0].corsi)}%`,
        body: `With ${list(top.map((r) => `${first(r)} (${Math.round(r.corsi)}%)`))} on the ice, the team took the biggest share of shot attempts. The lowest were ${list(low.map((r) => `${first(r)} (${Math.round(r.corsi)}%)`))}. Fifty percent is even. ${first(bx)} had the best expected-goal margin, ${signed(bx.netxg_pg, f2)} a game.`,
      });
    }

    const topOf = (pos, n) => P.filter((r) => r.pos === pos).sort(byDesc('toi')).slice(0, n);
    const tf = topOf('F', 3), td = topOf('D', 3);
    if (tf.length && td.length) {
      let body = `Forwards: ${list(tf.map((r) => `${first(r)} ${r.toi_txt}`))}. Defense: ${list(td.map((r) => `${first(r)} ${r.toi_txt}`))}.`;
      body += iceOK() ? '' : ' Ice time looks under-logged this season (see the data check above), so read these as relative minutes, not full-game minutes.';
      out.push({ id: 'usage', eyebrow: 'Usage', go: 'team/roles', link: 'ice-time charts', title: `${tf[0].short} and ${td[0].short} lead in ice time`, body });
    }

    const takers = P.filter((r) => r.fo > 0).sort(byDesc('fo'));
    if (takers.length) {
      const fo = sum('fo'), fow = sum('fow');
      const z = (k) => { const n = sum('fo_' + k), w = sum('fow_' + k); return n ? `${w} of ${n} (${pctOf(w, n)}%)` : 'no draws'; };
      const gone = Object.values(LAST).filter((l) => l.left), allFo = d3.sum(Object.values(LAST), (l) => l.fo);
      const share = allFo ? pctOf(d3.sum(gone, (l) => l.fo), allFo) : 0;
      out.push({
        id: 'faceoffs', eyebrow: 'Faceoffs', go: 'team/roles', link: 'faceoff charts',
        title: takers.length > 1 ? `${takers[0].short} and ${takers[1].short} took the most draws` : `${takers[0].short} took the draws`,
        body: `The team won ${b(fow)} of ${b(fo)} draws (${pctOf(fow, fo)}%). ${list(takers.slice(0, 4).map((r) => `${first(r)} ${r.fow} of ${r.fo}`))}. By zone: defensive ${z('dz')}, neutral ${z('nz')}, offensive ${z('oz')}.`
          + (share ? ` Players who have graduated took ${share}% of last season's draws, so who takes them is still an open question.` : ''),
      });
    }

    const pen = P.filter((r) => r.pim > 0).sort(byDesc('pim')), drew = P.filter((r) => r.drawn > 0).sort(byDesc('drawn'));
    const missing = Object.entries(LAST).filter(([k, l]) => !l.left && !P.some((r) => r.short === k)).map(([k]) => esc(k));
    const fresh = P.filter((r) => !LAST[r.short]).map(first);
    const parts = [];
    parts.push(pen.length ? `${list(pen.map((r) => `${first(r)} (${r.pim})`))} took ${b(sum('pim'))} penalty minutes, and the team drew ${b(sum('drawn'))}${drew.length ? ': ' + list(drew.map((r) => first(r) + (r.drawn > 1 ? ' (' + r.drawn + ')' : ''))) : ''}.` : `No penalty minutes yet. The team drew ${b(sum('drawn'))}.`);
    if (missing.length) parts.push(`${list(missing)} from last year's roster ${missing.length === 1 ? 'has' : 'have'} not played yet. The file does not say why.`);
    if (fresh.length) parts.push(`New to the data this season: ${list(fresh)}.`);
    out.push({ id: 'roster', eyebrow: 'Penalties and roster', go: 'team/roles', link: 'penalty charts', title: missing.length ? `${list(missing)} ${missing.length === 1 ? 'has' : 'have'} not played yet` : 'Penalties and roster', body: parts.join(' ') });
    return out;
  }

  function findCard(f) {
    const a = document.createElement('article');
    a.className = 'th-find';
    a.innerHTML = `<div class="th-eyebrow">${esc(f.eyebrow)}</div><h3>${esc(f.title)}</h3><p>${f.body}</p><button type="button" class="th-link">See the ${esc(f.link)}</button>`;
    a.querySelector('.th-link').addEventListener('click', () => go(f.go));
    return a;
  }

  function drawOverview() {
    const goals = sum('g'), sog = sum('sog'), shots = sum('shots'), fo = sum('fo'), fow = sum('fow');
    $('#th-lede').innerHTML = `After ${count(G, 'game')}, the team has ${b(goals)} goals from ${b(sog)} shots on goal, and the shots were worth ${b(f1(sum('xg')))} expected goals.`
      + (S.log.length && S.log[S.log.length - 1].ga_min === 0 ? ' No skater was on the ice for a goal against in the latest game.' : '');
    const kpi = (l, v, s2) => `<div class="th-kpi"><div class="th-kpi-l">${l}</div><div class="th-kpi-v">${v}</div><div class="th-kpi-s">${s2}</div></div>`;
    const k = $('#th-kpis');
    k.innerHTML = kpi('Goals', goals, f1(sum('xg')) + ' expected')
      + kpi('Shots on goal', sog, `of ${shots} attempts (${pctOf(sog, shots)}%)`)
      + kpi('Faceoffs won', fo ? pctOf(fow, fo) + '%' : '–', `${fow} of ${fo} draws`)
      + kpi('Penalty minutes', sum('pim'), `${sum('drawn')} penalties drawn`);
    k.removeAttribute('aria-busy');

    /* one caution strip instead of two banners: a one-line summary, details on demand */
    const early = G < 8, ice = !iceOK();
    const lastIce = (() => { const v = Object.values(LAST); const gm = d3.max(v, (l) => l.gp); return gm ? d3.sum(v, (l) => l.toi * l.gp) / (5 * gm) : 0; })();
    const cz = $('#th-caution');
    cz.hidden = !early && !ice;
    const bits = [];
    if (early) bits.push(G < 3 ? `${count(G, 'game')} of data` : `Only ${G} games in`);
    if (ice) bits.push('ice time looks under-logged');
    $('#th-caution-sum').innerHTML = `<span class="th-dot${ice ? ' warn' : ''}" aria-hidden="true"></span><span><b>Read with care:</b> ${esc(bits.join(', and '))}.</span>`;
    const body = [];
    if (early) body.push(G < 3
      ? `<p><b>Very early.</b> This is ${count(G, 'game')} of data, so every number describes one night, not a pattern. Read the charts as a snapshot and start looking for trends after about five games.</p>`
      : `<p><b>Still early.</b> After ${G} games, one big night can still swing a total. Rates and plus-minus are the shakiest numbers.</p>`);
    if (ice) body.push(`<p><b>Check the ice time.</b> The skaters' ice time adds up to about ${Math.round(tracked)} minutes per 60-minute game${lastIce ? ` (last season's exports added up to about ${Math.round(lastIce)})` : ''}. Shots and goals look like a full game, so some ice time was probably not logged. Until that is sorted out, treat ice time and per-60 numbers as low-confidence and lean on shot share, pass accuracy and faceoffs.</p>`);
    $('#th-caution-body').innerHTML = body.join('');

    const all = insights();
    const leadIds = ['scoring', 'possession'];
    let lead = all.filter((f) => leadIds.includes(f.id));
    if (lead.length < 2) lead = lead.concat(all.filter((f) => !leadIds.includes(f.id)).slice(0, 2 - lead.length));
    $('#th-lead').replaceChildren(...lead.map(findCard));
    $('#th-more').replaceChildren(...all.filter((f) => !lead.includes(f)).map(findCard));
  }

  /* ---------- team ---------- */
  const fin = (r) => tone(r.gxg, 0, 0.25 * Math.sqrt(G));
  const SEC = {
    scoring() {
      const pts = P.filter((r) => r.p > 0).sort((a, c) => c.p - a.p || c.g - a.g || a.name.localeCompare(c.name));
      sbar($('#ch-points'), pts, {
        label: (r) => r.short, total: (r) => r.p, series: [{ name: 'Goals', f: 'g', color: C.g }, { name: 'First assists', f: 'a1', color: C.s2 }, { name: 'Second assists', f: 'a2', color: C.s3 }],
        tip: (r) => [r.name, `${r.p} points in ${count(r.gp, 'game')}`, `${r.g} goals, ${r.a1} first assists, ${r.a2} second assists`],
      });
      hbar($('#ch-fin'), P.filter((r) => r.shots > 0).sort(byDesc('gxg')), {
        label: (r) => r.short, value: (r) => r.gxg, color: fin, rowH: 22,
        vlabel: (r) => signed(r.gxg, f2), tick: (d) => (d > 0 ? '+' + d : d),
        tip: (r) => [r.name, `${r.g} goals, ${f2(r.xg)} expected`, `${r.shots} shots, ${r.shpct}% scored`],
      });
      gbar($('#ch-shots'), P.slice().sort(byDesc('shots')).slice(0, 12), {
        label: (r) => r.short, series: [{ name: 'Attempts', f: 'shots', color: C.s2 }, { name: 'On goal', f: 'sog', color: C.g }],
        tip: (r) => [r.name, `${r.shots} attempts, ${r.sog} on goal`, `${r.blk} shots blocked`],
      });
      if (gate('#ch-p60', 5)) return;
      const pp = P.filter((r) => r.gp >= minGP);
      scatter($('#ch-p60'), pp, {
        x: (r) => r.toi, y: (r) => r.p60, label: (r) => r.short, color: () => C.g, shape: (r) => (r.pos === 'D' ? 's' : 'c'),
        xt: 'Minutes on ice per game', yt: 'Points per 60 minutes',
        xd: [Math.floor(d3.min(pp, (r) => r.toi)) - 1, Math.ceil(d3.max(pp, (r) => r.toi)) + 1], yd: [0, Math.ceil(d3.max(pp, (r) => r.p60) * 1.1)], prio: (r) => r.p60,
        tip: (r) => [r.name, `${r.p} points in ${r.gp} games`, `${f2(r.p60)} per 60 on ${r.toi_txt} a game`],
      });
    },
    impact() {
      const base = P.filter((r) => r.gp >= minGP && r.corsi != null);
      const cmed = d3.median(base, (r) => r.corsi);
      hbar($('#ch-corsi'), base.slice().sort(byDesc('corsi')), {
        label: (r) => r.short, value: (r) => r.corsi, base: 50, color: (r) => tone(r.corsi, 50, 5 / Math.sqrt(G)), rowH: 22,
        vlabel: (r) => Math.round(r.corsi) + '%', tick: (d) => d + '%', ref: { v: cmed, label: `Team median ${Math.round(cmed)}%` },
        tip: (r) => [r.name, `${f1(r.corsi)}% of shot attempts`, `${count(r.gp, 'game')}`],
      });
      hbar($('#ch-netxg'), P.slice().sort(byDesc('netxg_pg')), {
        label: (r) => r.short, value: (r) => r.netxg_pg, color: (r) => tone(r.netxg_pg, 0, 0.25 / Math.sqrt(G)), rowH: 22,
        vlabel: (r) => signed(r.netxg_pg, f2), tick: (d) => (d > 0 ? '+' + d : d),
        tip: (r) => [r.name, `Team ${f2(r.xgf)} expected for, ${f2(r.xga)} against`, `Margin ${signed(r.netxg, f2)} over ${count(r.gp, 'game')}`],
      });
      if (!gate('#ch-pmxg', 5)) {
        const lo = Math.floor(d3.min(base, (r) => Math.min(r.netxg, r.pm, 0))) - 1, hi = Math.ceil(d3.max(base, (r) => Math.max(r.netxg, r.pm))) + 1;
        scatter($('#ch-pmxg'), base, {
          x: (r) => r.netxg, y: (r) => r.pm, label: (r) => r.short, color: () => C.g, shape: (r) => (r.pos === 'D' ? 's' : 'c'),
          xt: 'On-ice expected-goal margin, season', yt: 'Plus-minus, season', xd: [lo, hi], yd: [lo, hi],
          ref: { slope: 1, label: 'Plus-minus equals chances' }, prio: (r) => Math.abs(r.pmgap),
          corner: [{ text: 'Plus-minus better than chances' }, { text: 'Plus-minus worse than chances', right: true, bottom: true }],
          tip: (r) => [r.name, `Plus-minus ${signed(r.pm, f0)}`, `On-ice expected margin ${signed(r.netxg)}`, `Difference ${signed(r.pmgap)}`],
        });
      }
      /* below the median is not the same as bad, so pass accuracy carries no verdict color */
      const accs = base.map((r) => r.accpass);
      const dom = [Math.min(PB, ...accs) - 3, Math.min(100, Math.max(PB, ...accs) + 3)];
      const passOpt = {
        label: (r) => r.short, value: (r) => r.accpass, base: dom[0], domain: dom, color: () => C.s2, rowH: 22, ref: { v: PB, label: `Median ${PB}%` },
        vlabel: (r) => r.accpass + '%', tick: (d) => d + '%',
        tip: (r) => [r.name, `${r.accpass}% of passes accurate`, `${count(r.gp, 'game')}`],
      };
      const byPass = (pos) => base.filter((r) => (r.pos === 'D') === (pos === 'D')).sort(byDesc('accpass'));
      hbar($('#ch-pass-f'), byPass('F'), passOpt);
      hbar($('#ch-pass-d'), byPass('D'), passOpt);
      gbar($('#ch-entries'), base.slice().sort((a, c) => c.entries + c.breakouts - (a.entries + a.breakouts)), {
        label: (r) => r.short, series: [{ name: 'Entries', f: 'entries', color: C.g }, { name: 'Breakouts', f: 'breakouts', color: C.s2 }],
        tip: (r) => [r.name, `Entries ${r.entries} a game`, `Breakouts ${r.breakouts} a game`],
      });
      const D = P.filter((r) => r.pos === 'D').sort(byDesc('slot'));
      const dopt = (f, lab, fmt) => ({ label: (r) => r.short, value: (r) => r[f], color: () => C.g, rowH: 24, vlabel: (r) => fmt(r[f]), tip: (r) => [r.name, `${lab} ${r[f]} a game`, `${count(r.gp, 'game')}`] });
      hbar($('#ch-dslot'), D, dopt('slot', 'Passes to the slot', f2));
      hbar($('#ch-dbo'), D.slice().sort(byDesc('breakouts')), dopt('breakouts', 'Breakouts', f1));
      hbar($('#ch-dsh'), D.slice().sort(byDesc('shots_pg')), dopt('shots_pg', 'Shots', f1));
    },
    roles() {
      $('#th-toi-flag').hidden = iceOK();
      const toi = (pos) => P.filter((r) => r.pos === pos).sort(byDesc('toi'));
      const topt = { label: (r) => r.short, value: (r) => r.toi, color: () => C.g, rowH: 22, vlabel: (r) => r.toi_txt, tip: (r) => [r.name, `${r.toi_txt} a game`, `${count(r.gp, 'game')}`] };
      hbar($('#ch-toi-f'), toi('F'), topt);
      hbar($('#ch-toi-d'), toi('D'), topt);
      const tk = P.filter((r) => r.fo > 0).sort(byDesc('fo')).map((r) => ({ ...r, fol: r.fo - r.fow }));
      if (!tk.length) { ['#ch-fo', '#ch-fz-dz', '#ch-fz-nz', '#ch-fz-oz'].forEach((s) => message($(s), 'No faceoffs recorded yet.')); $('#th-fz-sum').textContent = ''; }
      else {
        sbar($('#ch-fo'), tk, {
          label: (r) => r.short, total: (r) => r.fo, vlabel: (r) => `${r.fopct}% of ${r.fo}`,
          series: [{ name: 'Won', f: 'fow', color: C.g }, { name: 'Lost', f: 'fol', color: C.s2 }],
          tip: (r) => [r.name, `${r.fow} won of ${r.fo} draws`, `${r.fopct}% win rate`],
        });
        [['dz', 'defensive'], ['nz', 'neutral'], ['oz', 'offensive']].forEach(([z, name]) => {
          const n = (r) => r['fo_' + z], w = (r) => r['fow_' + z], pc = (r) => (n(r) ? (w(r) / n(r)) * 100 : 50);
          hbar($('#ch-fz-' + z), tk, {
            label: (r) => r.short, value: pc, base: 50, domain: [0, 100], color: (r) => (n(r) < 3 ? C.n : tone(pc(r), 50, 5)), rowH: 24,
            vlabel: (r) => (n(r) ? `${w(r)} of ${n(r)}` : '–'), tick: (d) => d + '%',
            tip: (r) => [r.name, n(r) ? `${w(r)} won of ${n(r)} ${name}-zone draws` : `No ${name}-zone draws`, n(r) ? Math.round(pc(r)) + '% win rate' : ''].filter(Boolean),
          });
        });
        const z = (k) => { const n = sum('fo_' + k), w = sum('fow_' + k); return n ? `${w} of ${n} (${pctOf(w, n)}%)` : 'none taken'; };
        $('#th-fz-sum').innerHTML = `Team totals: defensive zone ${z('dz')}, neutral zone ${z('nz')}, offensive zone ${z('oz')}.`;
      }
      const pen = P.filter((r) => r.pim > 0 || r.drawn > 0).sort((a, c) => c.pim - a.pim || c.drawn - a.drawn || a.name.localeCompare(c.name));
      if (!pen.length) { message($('#ch-pim'), 'No penalties yet.'); $('#ch-drawn').replaceChildren(); }
      else {
        hbar($('#ch-pim'), pen, { label: (r) => r.short, value: (r) => r.pim, color: () => C.bad, rowH: 24, vlabel: (r) => r.pim + ' min', tick: f0, tip: (r) => [r.name, `${r.pim} penalty minutes taken`, `${count(r.drawn, 'penalty').replace('penaltys', 'penalties')} drawn`] });
        hbar($('#ch-drawn'), pen, { label: (r) => r.short, value: (r) => r.drawn, color: () => C.g, rowH: 24, vlabel: (r) => String(r.drawn), tick: f0, tip: (r) => [r.name, `${count(r.drawn, 'penalty').replace('penaltys', 'penalties')} drawn`, `${r.pim} penalty minutes taken`] });
      }
      [['pp', 'pp_min'], ['pk', 'pk_min']].forEach(([id, f]) => {
        const card = $('#ch-' + id).closest('.th-card');
        card.hidden = !(sum(f) > 0);
        if (card.hidden) return;
        hbar($('#ch-' + id), P.filter((r) => r[f] > 0).sort(byDesc(f)).slice(0, 10), {
          label: (r) => r.short, value: (r) => r[f], color: () => C.g, rowH: 22, vlabel: (r) => r[f] + ' min', tip: (r) => [r.name, `${r[f]} minutes in ${count(r.gp, 'game')}`],
        });
      });
    },
  };

  /* ---------- season ---------- */
  const METRICS = [
    { k: 'ppg', label: 'Points per game', noise: 0.5, cur: (r) => r.ppg, prev: (l) => l.ppg, dfmt: (v) => signed(v, f2) },
    { k: 'corsi', label: 'Shot share', noise: 5, cur: (r) => r.corsi, prev: (l) => l.corsi, dfmt: (v) => signed(v) + ' pts' },
    { k: 'accpass', label: 'Pass accuracy', noise: 4, cur: (r) => r.accpass, prev: (l) => l.accpass, dfmt: (v) => signed(v, f0) + ' pts' },
    { k: 'netxg60', label: 'On-ice xG margin per 60', noise: 1.5, cur: (r) => r.netxg60, prev: (l) => (l.toi ? (l.netxg_pg / l.toi) * 60 : 0), dfmt: (v) => signed(v, f2) },
  ];
  let metric = METRICS[0];
  function drawLast() {
    const rows = P.filter((r) => LAST[r.short] && r.gp >= minGP && metric.cur(r) != null).sort((a, c) => metric.cur(c) - metric.cur(a) || a.name.localeCompare(c.name));
    const pv = (r) => metric.prev(LAST[r.short]);
    const band = metric.noise / Math.sqrt(G);
    dumbbell($('#ch-last'), rows, {
      label: (r) => r.short, cur: metric.cur, prev: pv, dfmt: metric.dfmt, band,
      tip: (r) => [r.name, `This season ${f2(metric.cur(r))} over ${count(r.gp, 'game')}`, `Last season ${f2(pv(r))} over ${LAST[r.short].gp} games`],
    });
    const d = (r) => metric.cur(r) - pv(r);
    const up = rows.filter((r) => d(r) >= band).sort((a, c) => d(c) - d(a)).slice(0, 3), down = rows.filter((r) => d(r) <= -band).sort((a, c) => d(a) - d(c)).slice(0, 3);
    const parts = [];
    if (up.length) parts.push(`Biggest gains: ${list(up.map((r) => esc(r.short) + ' (' + metric.dfmt(d(r)) + ')'))}.`);
    if (down.length) parts.push(`Biggest drops: ${list(down.map((r) => esc(r.short) + ' (' + metric.dfmt(d(r)) + ')'))}.`);
    parts.push(`Changes smaller than ${metric.dfmt(band).replace('+', '')} are drawn grey.`);
    parts.push(G < 5 ? `After ${count(G, 'game')} even the colored gaps are mostly noise. Last season is a full year and this season is a few nights.` : 'Gaps this size can still be a hot or cold stretch.');
    $('#th-last-sum').innerHTML = parts.join(' ');
  }
  const seg = $('#th-seg');
  METRICS.forEach((m, i) => {
    const bt = document.createElement('button');
    bt.type = 'button'; bt.className = 'th-fbtn'; bt.textContent = m.label; bt.setAttribute('aria-pressed', String(i === 0));
    bt.addEventListener('click', () => { metric = m; $$('#th-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === bt))); drawLast(); });
    seg.appendChild(bt);
  });
  function drawSeason() {
    drawLast();
    const log = S.log;
    if (!gate('#ch-g-goals', 3, 'Until then, the game log below has every number.')) gcols($('#ch-g-goals'), log, { series: [{ name: 'Goals', f: 'g', color: C.g }, { name: 'Expected goals', f: 'xg', color: C.s2, fmt: f1 }], tip: (r) => [`Game ${r.game}`, `${r.g} goals, ${f2(r.xg)} expected`] });
    if (!gate('#ch-g-shots', 3, 'Until then, the game log below has every number.')) gcols($('#ch-g-shots'), log, { series: [{ name: 'Attempts', f: 'shots', color: C.s2 }, { name: 'On goal', f: 'sog', color: C.g }], tip: (r) => [`Game ${r.game}`, `${r.shots} attempts, ${r.sog} on goal`] });
    const cols = [['Game', (r) => r.game], ['Date', (r) => fmtDate(r.date)], ['Goals', (r) => r.g], ['xG', (r) => f2(r.xg)], ['Shots', (r) => r.shots], ['On goal', (r) => r.sog],
      ['FO %', (r) => (r.fo ? pctOf(r.fow, r.fo) + '%' : '–')], ['PIM', (r) => r.pim], ['Drawn', (r) => r.drawn], ['Skaters', (r) => r.skaters]];
    const t = $('#th-glog');
    t.tHead.innerHTML = '<tr>' + cols.map(([l], i) => `<th scope="col" class="${i === 0 || i > 1 ? 'r' : ''}"><span>${l}</span></th>`).join('') + '</tr>';
    t.tBodies[0].replaceChildren(...log.slice().reverse().map((r) => {
      const tr = document.createElement('tr');
      cols.forEach(([, f], i) => { const td = document.createElement('td'); td.textContent = f(r); if (i === 0 || i > 1) td.className = 'n'; tr.appendChild(td); });
      return tr;
    }));
  }

  /* ---------- player cards ---------- */
  function playerCard(r, ctx) {
    const lp = LAST[r.short];
    const tags = [];
    if (r.p > 0 && r.p === ctx.maxP) tags.push('Points leader');
    if (ctx.topShare.has(r.short)) tags.push('Top shot share');
    if (r.gxg >= 0.75 * Math.sqrt(G)) tags.push('Finishing high');
    else if (r.xg >= 0.4 * Math.sqrt(G) && r.gxg <= -0.4 * Math.sqrt(G)) tags.push('Finishing low');
    if (r.fo >= 5) tags.push('Takes faceoffs');
    if (!lp) tags.push('New to the data');
    const s = [];
    const shotLine = r.shots ? `${count(r.shots, 'shot')} (${r.sog} on goal) for ${count(r.g, 'goal')} on ${f1(r.xg)} expected.` : `no shots, and ${f1(r.xg)} expected goals.`;
    s.push(iceOK() ? `${b(r.toi_txt)} ${G > 1 ? 'a game' : 'of ice time'}, ${shotLine}` : shotLine.replace(/^./, (c) => c.toUpperCase()));
    if (r.corsi != null) s.push(`The team took ${b(Math.round(r.corsi) + '%')} of shot attempts with him on the ice and made ${signed(r.netxg_pg, f2)} expected goals a game.`);
    if (r.fo) s.push(`Took ${count(r.fo, 'faceoff')} and won ${b(r.fopct + '%')}.`);
    if (r.pim || r.drawn) s.push([r.pim ? `Took ${r.pim} penalty ${r.pim === 1 ? 'minute' : 'minutes'}` : '', r.drawn ? `drew ${count(r.drawn, 'penalty').replace('penaltys', 'penalties')}` : ''].filter(Boolean).join(' and ').replace(/^./, (c) => c.toUpperCase()) + '.');
    if (lp) s.push(`Last season: ${f2(lp.ppg)} points a game${iceOK() ? `, ${lp.toi_txt} a night` : ''}, ${f1(lp.corsi)}% shot share.`);
    const a = document.createElement('article');
    a.className = 'th-pc'; a.dataset.grp = r.pos; a.id = 'pc-' + slug(r.short); a.tabIndex = -1;
    a.setAttribute('aria-labelledby', a.id + '-h');
    a.innerHTML = `<header><h3 id="${a.id}-h">${esc(r.name)}</h3><div class="th-pc-sub">#${r.num} · ${r.pos === 'D' ? 'Defense' : 'Forward'} · ${count(r.gp, 'game')}</div></header>`
      + `<dl class="th-pc-stats">${[['G', r.g], ['A', r.a], ['P', r.p], ['+/-', r.pm], ['SOG', r.sog]].map(([l, v]) => `<div><dt>${l}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + (tags.length ? `<p class="th-tags">${tags.slice(0, 3).map(esc).join(' · ')}</p>` : '') + `<p>${s.join(' ')}</p>`;
    return a;
  }
  let pf = 'all';
  function drawPlayers() {
    const ctx = { maxP: d3.max(P, (r) => r.p), topShare: new Set(P.filter((r) => r.gp >= minGP && r.corsi != null).sort(byDesc('corsi')).slice(0, 3).map((r) => r.short)) };
    $('#th-cards').replaceChildren(...P.slice().sort((a, c) => c.p - a.p || c.g - a.g || a.name.localeCompare(c.name)).map((r) => playerCard(r, ctx)));
    applyPlayers();
  }
  function applyPlayers() {
    $$('.th-pc').forEach((c) => { c.hidden = !(pf === 'all' || c.dataset.grp === pf); });
    $$('.th-fbtn[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === pf)));
  }
  $$('.th-fbtn[data-f]').forEach((x) => x.addEventListener('click', () => { pf = x.dataset.f; applyPlayers(); }));
  function openPlayer(short) { go('players/' + slug(short)); }

  /* ---------- all stats table ---------- */
  const COLS = [
    ['name', 'Player', 'Player'], ['num', '#', 'Jersey number'], ['pos', 'Pos', 'Position'], ['gp', 'GP', 'Games played'],
    ['g', 'G', 'Goals'], ['a', 'A', 'Assists'], ['p', 'P', 'Points'], ['pm', '+/-', 'Plus-minus'], ['ppg', 'P/GP', 'Points per game'], ['p60', 'P/60', 'Points per 60 minutes on ice'],
    ['toi_txt', 'TOI', 'Ice time per game'], ['shots', 'Shots', 'Shot attempts'], ['sog', 'SOG', 'Shots on goal'], ['shpct', 'Sh%', 'Share of shots that scored'],
    ['xg', 'xG', 'Expected goals'], ['gxg', 'G-xG', 'Goals minus expected goals'], ['netxg', 'On-ice xG', "Team's expected-goal margin with the player on the ice, season"],
    ['corsi', 'Shot share', "Team's share of shot attempts with the player on the ice"], ['accpass', 'Pass %', 'Passes that reached a teammate'],
    ['entries', 'Entries/GP', 'Zone entries per game'], ['breakouts', 'Breakouts/GP', 'Breakouts per game'], ['slot', 'Slot/GP', 'Passes to the slot per game'],
    ['hits', 'Hits', 'Hits'], ['blk', 'Blocks', 'Shots blocked'],
    ['fo', 'FO', 'Faceoffs taken'], ['fopct', 'FO%', 'Faceoff win rate'], ['fz_dz', 'DZ FO%', 'Defensive-zone faceoff win rate'], ['fz_nz', 'NZ FO%', 'Neutral-zone faceoff win rate'], ['fz_oz', 'OZ FO%', 'Offensive-zone faceoff win rate'],
    ['pim', 'PIM', 'Penalty minutes'], ['drawn', 'Drawn', 'Penalties drawn'],
  ];
  const TEXT = ['name', 'pos'];
  const KEYED = COLS.filter(([f, l, full]) => !TEXT.includes(f) && f !== 'num' && l !== full);
  $('#th-keylist').innerHTML = KEYED.map(([, l, full]) => `<div><dt>${esc(l)}</dt><dd>${esc(full)}</dd></div>`).join('');
  $('#th-table').tHead.innerHTML = '<tr>' + COLS.map(([f, l, full]) => `<th scope="col" data-field="${f}" class="${TEXT.includes(f) ? '' : 'r'}"><button type="button" class="th-sort" data-k="${f}"${l !== full ? ` aria-label="${esc(l)}: ${esc(full)}" title="${esc(full)}"` : ''}>${esc(l)}</button></th>`).join('') + '</tr>';
  let sortK = 'p', sortDir = -1, query = '', cls = 'all';
  function renderTable() {
    const tb = $('#th-table').tBodies[0];
    const rows = P.filter((r) => (cls === 'all' || r.pos === cls) && (!query || r.name.toLowerCase().includes(query)));
    const val = (r, k) => (k === 'toi_txt' ? r.toi : r[k]);
    rows.sort((a, c) => {
      const x = val(a, sortK), y = val(c, sortK);
      const d = typeof x === 'number' || typeof y === 'number' ? (x == null ? -1 : x) - (y == null ? -1 : y) : String(x).localeCompare(String(y));
      return d * sortDir || a.name.localeCompare(c.name);
    });
    if (!rows.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = COLS.length; td.textContent = `No players match "${query}".`; tr.appendChild(td);
      tb.replaceChildren(tr);
    } else tb.replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      COLS.forEach(([f]) => {
        const td = document.createElement('td');
        if (f === 'name') td.innerHTML = `<span class="th-nm-l">${esc(r.name)}</span><span class="th-nm-s">${esc(r.short)}</span>`;
        else td.textContent = show(f, r[f]) + (f === 'accpass' && r[f] != null ? '%' : '');
        if (!TEXT.includes(f)) td.className = 'n';
        tr.appendChild(td);
      });
      return tr;
    }));
    $$('#th-table thead th').forEach((th) => th.setAttribute('aria-sort', th.dataset.field === sortK ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
  }
  $$('#th-table .th-sort').forEach((x) => x.addEventListener('click', () => {
    const k = x.dataset.k;
    if (k === sortK) sortDir = -sortDir; else { sortK = k; sortDir = TEXT.includes(k) ? 1 : -1; }
    renderTable();
  }));
  $('#th-q').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderTable(); });
  $$('.th-sbtn').forEach((x) => x.addEventListener('click', () => { cls = x.dataset.s; $$('.th-sbtn').forEach((y) => y.setAttribute('aria-pressed', String(y === x))); renderTable(); }));

  /* ---------- routing: #overview, #players[/name], #team[/scoring|impact|roles], #season, #data ---------- */
  const TABS = ['overview', 'players', 'team', 'season', 'data'];
  const LEGACY = { scoring: 'team/scoring', impact: 'team/impact', roles: 'team/roles', last: 'season', games: 'season', stats: 'data', notes: 'data' };
  let current = 'overview', sub = 'scoring', focusPlayer = null;
  function parse() {
    let h = decodeURIComponent((location.hash || '').slice(1));
    if (h.startsWith('tab-')) h = LEGACY[h.slice(4)] || h.slice(4);
    const [tab, rest] = h.split('/');
    return { tab: TABS.includes(tab) ? tab : 'overview', rest: rest || '' };
  }
  function go(path) {
    if (location.hash.slice(1) === path) route(); else location.hash = path;
  }
  function route() {
    const { tab, rest } = parse();
    const changed = tab !== current || (tab === 'team' && rest && rest !== sub);
    current = tab;
    if (tab === 'team' && SEC[rest]) sub = rest;
    focusPlayer = tab === 'players' && rest ? rest : null;
    if (focusPlayer) pf = 'all';
    $$('.th-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab || !P.length && tab !== 'overview'; });
    if (!$('#th-error').hidden) $$('.th-pane').forEach((p) => { p.hidden = true; });
    tabs.forEach((t) => { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
    $$('.th-sec').forEach((s) => { s.hidden = s.dataset.sec !== sub; });
    $$('#th-sub button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.sub === sub)));
    if (changed && !focusPlayer) window.scrollTo(0, 0);
    draw();
  }
  const tabs = $$('.th-tabs [role=tab]');
  tabs.forEach((t, i) => {
    t.setAttribute('aria-controls', 'pane-' + t.dataset.tab);
    t.addEventListener('click', () => go(t.dataset.tab === 'team' ? 'team/' + sub : t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const n = tabs.length;
      const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
      if (j === null) return;
      e.preventDefault(); tabs[j].focus(); tabs[j].click();
    });
  });
  $$('#th-sub button').forEach((x) => x.addEventListener('click', () => go('team/' + x.dataset.sub)));
  $$('.th-pane').forEach((p) => {
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', 'tab-' + p.dataset.pane);
    p.tabIndex = 0;
    if (p.dataset.pane !== 'overview') {
      const h = document.createElement('h2');
      h.className = 'th-sr'; h.textContent = $('#tab-' + p.dataset.pane).textContent;
      p.prepend(h);
    }
  });
  window.addEventListener('hashchange', route);

  /* ---------- draw and load ---------- */
  function fillVars() {
    const v = { minGames: count(minGP, 'game'), games: G, updated: S.updated ? fmtDate(S.updated) : '', passBase: PB };
    $$('[data-var]').forEach((el) => { el.textContent = v[el.dataset.var]; });
  }
  function draw() {
    if (!P.length) return;
    fillVars();
    if (current === 'overview') drawOverview();
    if (current === 'players') {
      drawPlayers();
      if (focusPlayer) {
        const c = document.getElementById('pc-' + focusPlayer);
        if (c) { c.scrollIntoView({ block: 'start' }); c.focus({ preventScroll: true }); }
        focusPlayer = null;
      }
    }
    if (current === 'team') SEC[sub]();
    if (current === 'season') drawSeason();
    if (current === 'data') renderTable();
  }

  const FILES = ['players', 'season', 'last-season'];
  Promise.all(FILES.map((n) => fetch(`data/${n}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((d) => [n, d], () => [n, null])))
    .then((res) => {
      const got = Object.fromEntries(res);
      const missing = ['players', 'season'].filter((n) => !got[n]);
      if (missing.length) {
        fail(`Couldn't load ${list(missing.map((n) => `data/${n}.json`))}. If you're offline, reconnect and try again. If this keeps happening, rerun prep/prep.py and push again.`);
        return;
      }
      P = got.players; S = got.season; LAST = got['last-season'] || {};
      P.forEach((r) => {
        if (!r.fo) r.fopct = null;
        ['dz', 'nz', 'oz'].forEach((z) => { r['fz_' + z] = r['fo_' + z] ? Math.round((r['fow_' + z] / r['fo_' + z]) * 100) : null; });
      });
      G = S.games; minGP = Math.max(1, Math.ceil(G / 2));
      tracked = d3.sum(P, (r) => r.toi * r.gp) / (5 * G);
      PB = Math.round(d3.median(P.filter((r) => r.gp >= minGP && r.corsi != null), (r) => r.accpass));
      $('#th-status').textContent = `Through game ${G} · updated ${fmtDate(S.updated)}`;
      route();
    });
  let resizeTimer, lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth === lastW) return; lastW = window.innerWidth; clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); });

  route();
})();
