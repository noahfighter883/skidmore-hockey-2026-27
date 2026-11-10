(function () {
  const root = document.getElementById('app');
  const $ = (s, el) => (el || root).querySelector(s);
  const $$ = (s, el) => [...(el || root).querySelectorAll(s)];
  const C = { g: '#235240', bad: '#9b4538', b: '#677c88', gold: '#ab8d3b' };

  let P = [], S = { games: 1, updated: '', log: [] }, LAST = {}, G = 1, minGP = 1, tracked = 60;
  const f0 = d3.format('d'), f1 = d3.format('.1f'), f2 = d3.format('.2f');
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + (f || f1)(Math.abs(v));
  const mmss = (m) => { const s = Math.round(m * 60); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b = (v) => '<b>' + esc(v) + '</b>';
  const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
  const count = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const byDesc = (f) => (a, c) => c[f] - a[f] || a.name.localeCompare(c.name);
  const signColor = (v, base) => (v >= (base || 0) ? C.g : C.bad);
  const DEC = { ppg: 2, p60: 2, shpct: 1, xg: 2, gxg: 2, netxg: 2, corsi: 1 };
  const show = (f, v) => (v == null ? '–' : typeof v === 'number' && DEC[f] != null ? v.toFixed(DEC[f]) : String(v));
  const fmtDate = (iso) => d3.timeFormat('%B %-d, %Y')(new Date(iso + 'T12:00:00'));
  const message = (el, text) => { const d = document.createElement('div'); d.className = 'th-early'; d.textContent = text; el.replaceChildren(d); };
  const gate = (sel, need) => { if (G >= need) return false; message($(sel), 'This chart appears once the team has played ' + need + ' games. One or two games is too few for this view.'); return true; };
  const median = (xs) => d3.median(xs);

  /* ---------- chart helpers ---------- */
  function mkSvg(el) {
    el.replaceChildren();
    const prev = el.previousElementSibling;
    const h = prev && prev.matches('h4') ? prev : el.closest('.th-card') && el.closest('.th-card').querySelector('h2,h3');
    return d3.select(el).append('svg').attr('width', '100%').attr('role', 'img')
      .attr('aria-label', (h ? h.textContent : 'Chart') + '. Hover for values. The All stats tab has the full table.');
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
      show(ev, lines) {
        t.replaceChildren();
        lines.forEach((l, i) => {
          const d = document.createElement('div');
          if (i === 0) d.className = 'th-tip-h';
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
  function axisStyle(g) {
    g.attr('font-size', null).attr('font-family', null);
    g.select('.domain').remove();
    g.selectAll('line').style('stroke', 'var(--cds-chart-grid)');
    g.selectAll('text').style('fill', 'var(--color-fg-muted)').attr('font-size', 11);
  }
  function statusLine(el, d) {
    el.replaceChildren();
    if (d.status === 'error') {
      const s = document.createElement('div');
      s.className = 'th-fail';
      s.textContent = 'Failed to load';
      el.appendChild(s);
    }
  }

  /* horizontal bars: o = {label, value, color, vlabel, tip, base, domain, tick, rowH} */
  function hbar(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el);
    const base = o.base || 0, rowH = o.rowH || 24, bh = Math.min(16, rowH - 8);
    const lw = Math.min(tw(svg, data.map(o.label)) + 12, w * 0.4);
    const vw = Math.min(tw(svg, data.map(o.vlabel)) + 8, w * 0.35);
    const vals = data.map(o.value);
    let lo = Math.min(base, ...vals), hi = Math.max(base, ...vals);
    if (o.domain) { lo = o.domain[0]; hi = o.domain[1]; }
    const hasNeg = lo < base;
    const m = { t: 4, r: vw + 4, b: 22, l: lw + (hasNeg ? vw : 0) };
    const H = m.t + m.b + rowH * data.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const x = d3.scaleLinear([lo, hi], [m.l, w - m.r]);
    if (!o.domain) x.nice(4);
    const ax = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((w - m.l - m.r) / 80))).tickSize(-(H - m.b - m.t)).tickFormat(o.tick || ((d) => d)));
    axisStyle(ax);
    svg.append('line').attr('x1', x(base)).attr('x2', x(base)).attr('y1', m.t).attr('y2', H - m.b)
      .style('stroke', 'var(--cds-chart-axis)');
    const tip = tipFor(el);
    const gr = svg.selectAll('g.r').data(data).join('g').attr('class', 'r')
      .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12)
      .style('fill', 'var(--color-fg)').text((d) => o.label(d));
    gr.append('rect').attr('class', 'bar').attr('y', (rowH - bh) / 2).attr('height', bh).attr('rx', 3)
      .attr('x', (d) => Math.min(x(base), x(o.value(d))))
      .attr('width', (d) => Math.max(1, Math.abs(x(o.value(d)) - x(base))))
      .style('fill', (d) => o.color(d));
    gr.append('text').attr('y', rowH / 2 + 4).attr('font-size', 11).style('fill', 'var(--color-fg-muted)')
      .attr('x', (d) => (o.value(d) >= base ? x(o.value(d)) + 5 : x(o.value(d)) - 5))
      .attr('text-anchor', (d) => (o.value(d) >= base ? 'start' : 'end'))
      .text((d) => o.vlabel(d));
    gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent')
      .on('pointermove', function (ev, d) {
        gr.style('opacity', (e) => (e === d ? 1 : 0.45));
        tip.show(ev, o.tip(d));
      })
      .on('pointerleave', () => { gr.style('opacity', 1); tip.hide(); });
  }

  /* scatter: o = {x, y, label, color, shape, xt, yt, xd, yd, ref, tip, prio, corner} */
  function scatter(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el);
    const H = Math.round(Math.max(360, Math.min(540, w * 0.95)));
    const m = { t: o.shape ? 30 : 10, r: 14, b: 40, l: 46 };
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    if (o.shape) {
      const lg = svg.append('g').attr('transform', `translate(${m.l},12)`);
      [['c', 'Forward'], ['s', 'Defenseman']].forEach(([s, txt], i) => {
        const gx0 = i * 100;
        lg.append('path').attr('transform', `translate(${gx0 + 6},0)`)
          .attr('d', d3.symbol().type(s === 's' ? d3.symbolSquare : d3.symbolCircle).size(70)())
          .style('fill', 'var(--color-fg-muted)');
        lg.append('text').attr('x', gx0 + 17).attr('y', 4).attr('font-size', 12).style('fill', 'var(--color-fg)').text(txt);
      });
    }
    const x = d3.scaleLinear(o.xd, [m.l, w - m.r]), y = d3.scaleLinear(o.yd, [H - m.b, m.t]);
    const gx = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(w / 90))).tickSize(-(H - m.b - m.t)));
    axisStyle(gx);
    const gy = svg.append('g').attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(6).tickSize(-(w - m.l - m.r)));
    axisStyle(gy);
    svg.append('text').attr('x', (m.l + w - m.r) / 2).attr('y', H - 6).attr('text-anchor', 'middle').attr('font-size', 11)
      .style('fill', 'var(--color-fg-muted)').text(o.xt);
    svg.append('text').attr('transform', `translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle')
      .attr('font-size', 11).style('fill', 'var(--color-fg-muted)').text(o.yt);
    if (o.ref) {
      const s = o.ref.slope;
      const xa = Math.max(o.xd[0], o.yd[0] / s), xb = Math.min(o.xd[1], o.yd[1] / s);
      svg.append('line').attr('x1', x(xa)).attr('y1', y(s * xa)).attr('x2', x(xb)).attr('y2', y(s * xb))
        .style('stroke', 'var(--cds-chart-reference)').attr('stroke-dasharray', '5 4').attr('stroke-width', 1.5);
      if (o.ref.label && w >= 520) {
        svg.append('text').attr('x', x(xb) - 4).attr('y', y(s * xb) - 8).attr('text-anchor', 'end').attr('font-size', 11)
          .style('fill', 'var(--color-fg-muted)').text(o.ref.label);
      }
    }
    (o.corner || []).forEach((c) => {
      svg.append('text').attr('x', c.right ? w - m.r - 6 : m.l + 6).attr('y', c.bottom ? H - m.b - 8 : m.t + 14)
        .attr('text-anchor', c.right ? 'end' : 'start').attr('font-size', 11).style('fill', 'var(--color-fg-muted)')
        .style('font-style', 'italic').text(c.text);
    });
    const tip = tipFor(el);
    const sym = (s) => d3.symbol().type(s === 's' ? d3.symbolSquare : d3.symbolCircle).size(s === 's' ? 62 : 80)();
    const pts = svg.selectAll('path.pt').data(data).join('path').attr('class', 'pt')
      .attr('transform', (d) => `translate(${x(o.x(d))},${y(o.y(d))})`)
      .attr('d', (d) => sym(o.shape ? o.shape(d) : 'c'))
      .style('fill', (d) => o.color(d)).style('stroke', 'var(--color-panel)').attr('stroke-width', 1.5)
      ;
    /* labels, greedy placement */
    const boxes = data.map((d) => ({ x0: x(o.x(d)) - 7, x1: x(o.x(d)) + 7, y0: y(o.y(d)) - 7, y1: y(o.y(d)) + 7 }));
    const gl = svg.append('g');
    const pos = [[8, 4, 'start'], [-8, 4, 'end'], [0, -9, 'middle'], [0, 17, 'middle'], [8, -7, 'start'], [-8, -7, 'end'], [8, 14, 'start'], [-8, 14, 'end']];
    const order = [...data].sort((a, b) => (o.prio ? o.prio(b) - o.prio(a) : 0));
    const hit = (b, c) => !(b.x1 < c.x0 || b.x0 > c.x1 || b.y1 < c.y0 || b.y0 > c.y1);
    const placed = [];
    order.forEach((d) => {
      const px = x(o.x(d)), py = y(o.y(d));
      const t = gl.append('text').attr('font-size', 11).style('fill', 'var(--color-fg)').text(o.label(d));
      const tl = t.node().getComputedTextLength();
      for (const [dx, dy, an] of pos) {
        const x0 = an === 'start' ? px + dx : an === 'end' ? px + dx - tl : px + dx - tl / 2;
        const b = { x0, x1: x0 + tl, y0: py + dy - 10, y1: py + dy + 3 };
        if (b.x0 < 2 || b.x1 > w - 2 || b.y0 < 2 || b.y1 > H - m.b + 12) continue;
        if (boxes.some((c) => hit(b, c))) continue;
        if (placed.some((c) => hit(b, c))) continue;
        t.attr('x', px + dx).attr('y', py + dy).attr('text-anchor', an);
        placed.push(b);
        return;
      }
      t.remove();
    });
    pts.on('pointermove', function (ev, d) { tip.show(ev, o.tip(d)); }).on('pointerleave', () => tip.hide());
  }

  /* grouped horizontal bars with two series */
  function gbar(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el);
    const rowH = 30, bh = 10;
    const lw = Math.min(tw(svg, data.map(o.label)) + 12, w * 0.4);
    const m = { t: 24, r: 36, b: 22, l: lw };
    const H = m.t + m.b + rowH * data.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const hi = d3.max(data, (d) => Math.max(...o.series.map((s) => d[s.f])));
    const x = d3.scaleLinear([0, hi], [m.l, w - m.r]).nice(hi <= 8 ? Math.ceil(hi) : 4);
    const ax = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(hi <= 8 ? Math.ceil(hi) : Math.max(2, Math.floor((w - m.l - m.r) / 80))).tickSize(-(H - m.b - m.t)));
    axisStyle(ax);
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--cds-chart-axis)');
    let lx = m.l;
    o.series.forEach((s) => {
      svg.append('rect').attr('x', lx).attr('y', 4).attr('width', 10).attr('height', 10).attr('rx', 2).style('fill', s.color);
      const t = svg.append('text').attr('x', lx + 15).attr('y', 13).attr('font-size', 11).style('fill', 'var(--color-fg)').text(s.name);
      lx += 15 + t.node().getComputedTextLength() + 18;
    });
    const tip = tipFor(el);
    const gr = svg.selectAll('g.r').data(data).join('g').attr('class', 'r')
      .attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12)
      .style('fill', 'var(--color-fg)').text((d) => o.label(d));
    o.series.forEach((s, k) => {
      const y0 = rowH / 2 - bh - 1 + k * (bh + 2);
      gr.append('rect').attr('x', x(0)).attr('y', y0).attr('height', bh).attr('rx', 3)
        .attr('width', (d) => Math.max(1, x(d[s.f]) - x(0))).style('fill', s.color);
      gr.append('text').attr('x', (d) => x(d[s.f]) + 5).attr('y', y0 + bh - 1).attr('font-size', 10)
        .style('fill', 'var(--color-fg-muted)').text((d) => d[s.f]);
    });
    gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent')
      .on('pointermove', function (ev, d) {
        gr.style('opacity', (e) => (e === d ? 1 : 0.45));
        tip.show(ev, o.tip(d));
      })
      .on('pointerleave', () => { gr.style('opacity', 1); tip.hide(); });
  }

  /* stacked horizontal bars: o = {label, series:[{name,f,color}], total, tip} */
  function sbar(el, data, o) {
    const w = el.clientWidth;
    if (!w || !data.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el);
    const rowH = 26, bh = 16;
    const lw = Math.min(tw(svg, data.map(o.label)) + 12, w * 0.4);
    const vw = tw(svg, data.map((d) => String(o.total(d)))) + 8;
    const m = { t: 24, r: vw + 4, b: 22, l: lw };
    const H = m.t + m.b + rowH * data.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const hi = d3.max(data, o.total);
    const x = d3.scaleLinear([0, hi], [m.l, w - m.r]).nice(Math.min(hi, 5));
    const ax = svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.min(hi, Math.max(2, Math.floor((w - m.l - m.r) / 80)))).tickSize(-(H - m.b - m.t)).tickFormat(f0));
    axisStyle(ax);
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--cds-chart-axis)');
    let lx = m.l;
    o.series.forEach((s) => {
      svg.append('rect').attr('x', lx).attr('y', 4).attr('width', 10).attr('height', 10).attr('rx', 2).style('fill', s.color);
      const t = svg.append('text').attr('x', lx + 15).attr('y', 13).attr('font-size', 11).style('fill', 'var(--color-fg)').text(s.name);
      lx += 15 + t.node().getComputedTextLength() + 18;
    });
    const tip = tipFor(el);
    const gr = svg.selectAll('g.r').data(data).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12).style('fill', 'var(--color-fg)').text((d) => o.label(d));
    o.series.forEach((s, k) => {
      gr.append('rect').attr('y', (rowH - bh) / 2).attr('height', bh)
        .attr('x', (d) => x(d3.sum(o.series.slice(0, k), (q) => d[q.f])))
        .attr('width', (d) => Math.max(0, x(d[s.f]) - x(0) - (d[s.f] > 0 ? 1 : 0)))
        .style('fill', s.color);
    });
    gr.append('text').attr('x', (d) => x(o.total(d)) + 5).attr('y', rowH / 2 + 4).attr('font-size', 11).style('fill', 'var(--color-fg-muted)').text((d) => o.total(d));
    gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent')
      .on('pointermove', function (ev, d) { gr.style('opacity', (e) => (e === d ? 1 : 0.45)); tip.show(ev, o.tip(d)); })
      .on('pointerleave', () => { gr.style('opacity', 1); tip.hide(); });
  }

  /* clustered columns, one cluster per game: o = {series:[{name,f,color}], tip} */
  function gcols(el, rows, o) {
    const w = el.clientWidth;
    if (!w || !rows.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el);
    const H = 270, m = { t: 30, r: 10, b: 28, l: 38 };
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const x0 = d3.scaleBand(rows.map((r) => r.game), [m.l, w - m.r]).padding(0.25);
    const bw = Math.min(x0.bandwidth() / o.series.length, 44), cw = bw * o.series.length;
    const hi = d3.max(rows, (r) => d3.max(o.series, (s) => r[s.f]));
    const y = d3.scaleLinear([0, hi * 1.1], [H - m.b, m.t]).nice(5);
    axisStyle(svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r))));
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x0).tickSize(0).tickFormat((g) => 'Game ' + g)));
    svg.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--cds-chart-axis)');
    let lx = m.l;
    o.series.forEach((s) => {
      svg.append('rect').attr('x', lx).attr('y', 4).attr('width', 10).attr('height', 10).attr('rx', 2).style('fill', s.color);
      const t = svg.append('text').attr('x', lx + 15).attr('y', 13).attr('font-size', 11).style('fill', 'var(--color-fg)').text(s.name);
      lx += 15 + t.node().getComputedTextLength() + 18;
    });
    const tip = tipFor(el);
    const gr = svg.selectAll('g.c').data(rows).join('g').attr('class', 'c').attr('transform', (r) => `translate(${x0(r.game) + (x0.bandwidth() - cw) / 2},0)`);
    o.series.forEach((s, k) => {
      gr.append('rect').attr('x', k * bw + 1).attr('width', bw - 2).attr('rx', 3).attr('y', (r) => y(r[s.f])).attr('height', (r) => y(0) - y(r[s.f])).style('fill', s.color);
      gr.append('text').attr('x', k * bw + bw / 2).attr('y', (r) => y(r[s.f]) - 5).attr('text-anchor', 'middle').attr('font-size', 11).style('fill', 'var(--color-fg-muted)').text((r) => (s.fmt || String)(r[s.f]));
    });
    gr.append('rect').attr('width', cw).attr('y', m.t).attr('height', H - m.t - m.b).style('fill', 'transparent')
      .on('pointermove', function (ev, r) { tip.show(ev, o.tip(r)); }).on('pointerleave', () => tip.hide());
  }

  /* before-and-after dots: o = {label, cur, prev, dfmt, neutral, tip} */
  function dumbbell(el, rows, o) {
    const w = el.clientWidth;
    if (!w || !rows.length) { el.replaceChildren(); return; }
    const svg = mkSvg(el);
    const rowH = 26;
    const delta = (r) => o.cur(r) - o.prev(r);
    const lw = Math.min(tw(svg, rows.map(o.label)) + 12, w * 0.4);
    const vw = Math.min(tw(svg, rows.map((r) => o.dfmt(delta(r)))) + 10, w * 0.3);
    const m = { t: 4, r: vw + 4, b: 22, l: lw };
    const H = m.t + m.b + rowH * rows.length;
    svg.attr('height', H).attr('viewBox', `0 0 ${w} ${H}`);
    const vals = rows.flatMap((r) => [o.cur(r), o.prev(r)]);
    const x = d3.scaleLinear([d3.min(vals), d3.max(vals)], [m.l + 8, w - m.r - 8]).nice(4);
    axisStyle(svg.append('g').attr('transform', `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((w - m.l - m.r) / 80))).tickSize(-(H - m.b - m.t))));
    const tip = tipFor(el);
    const col = (r) => (o.neutral ? C.b : delta(r) >= 0 ? C.g : C.bad);
    const gr = svg.selectAll('g.r').data(rows).join('g').attr('class', 'r').attr('transform', (d, i) => `translate(0,${m.t + i * rowH})`);
    gr.append('text').attr('x', lw - 6).attr('y', rowH / 2 + 4).attr('text-anchor', 'end').attr('font-size', 12).style('fill', 'var(--color-fg)').text((d) => o.label(d));
    gr.append('line').attr('y1', rowH / 2).attr('y2', rowH / 2).attr('x1', (d) => x(o.prev(d))).attr('x2', (d) => x(o.cur(d)))
      .style('stroke', col).attr('stroke-width', 3).attr('stroke-linecap', 'round').style('opacity', 0.55);
    gr.append('circle').attr('cx', (d) => x(o.prev(d))).attr('cy', rowH / 2).attr('r', 5).style('fill', 'var(--color-panel)').style('stroke', C.b).attr('stroke-width', 2);
    gr.append('circle').attr('cx', (d) => x(o.cur(d))).attr('cy', rowH / 2).attr('r', 5.5).style('fill', col);
    gr.append('text').attr('x', w - m.r + 8).attr('y', rowH / 2 + 4).attr('font-size', 11).style('fill', 'var(--color-fg-muted)').text((d) => o.dfmt(delta(d)));
    gr.append('rect').attr('width', w).attr('height', rowH).style('fill', 'transparent')
      .on('pointermove', function (ev, d) { gr.style('opacity', (e) => (e === d ? 1 : 0.45)); tip.show(ev, o.tip(d)); })
      .on('pointerleave', () => { gr.style('opacity', 1); tip.hide(); });
  }

  /* ---------- overview text ---------- */
  const sum = (f) => d3.sum(P, (r) => r[f]);
  const pctOf = (a, c) => (c ? Math.round((a / c) * 100) : 0);

  function insights() {
    const out = [];
    const s = Math.sqrt(G);
    const first = (r) => esc(r.short);

    // scoring
    const goals = sum('g'), xg = sum('xg');
    const maxP = d3.max(P, (r) => r.p);
    const lead = P.filter((r) => r.p === maxP && maxP > 0);
    const scorers = P.filter((r) => r.g > 0).sort(byDesc('g'));
    out.push({
      eyebrow: 'Scoring', tab: 'scoring',
      title: !lead.length ? 'No points yet' : lead.length === 1 ? `${lead[0].short} leads with ${count(maxP, 'point')}` : `${list(lead.map((r) => r.short))} lead with ${count(maxP, 'point')} each`,
      body: goals === 0 ? 'The team has not scored yet.'
        : `The team scored ${b(goals)} on ${b(f1(xg))} expected goals, from ${count(scorers.length, 'different scorer')}: ${list(scorers.map((r) => first(r) + (r.g > 1 ? ' (' + r.g + ')' : '')))}.`
          + (lead.length === 1 ? ` ${first(lead[0])} had ${count(lead[0].g, 'goal')} and ${count(lead[0].a, 'assist')}.` : ''),
    });

    // finishing
    const over = P.filter((r) => r.gxg >= 0.5 * s).sort(byDesc('gxg')).slice(0, 3);
    const under = P.filter((r) => r.xg >= 0.4 * s && r.gxg <= -0.4 * s).sort((a, c) => a.gxg - c.gxg).slice(0, 3);
    const caveat = G < 5 ? `With ${count(G, 'game')} played, treat this as noise. Expected goals is a model, and gaps this size usually shrink.` : 'Expected goals is a model, and gaps this size often shrink over a season.';
    out.push({
      eyebrow: 'Finishing', tab: 'scoring',
      title: over.length ? `${list(over.slice(0, 2).map((r) => r.short))} scored well above the chances` : 'Nobody is far from their chances',
      body: [
        over.length ? `${list(over.map((r) => `${first(r)} (${r.g} on ${f1(r.xg)} expected)`))} scored more than the shots were worth.` : '',
        under.length ? `${list(under.map((r) => `${first(r)} (${r.g} on ${f1(r.xg)})`))} scored less.` : '',
        caveat,
      ].filter(Boolean).join(' '),
    });

    // possession
    const el = P.filter((r) => r.gp >= minGP && r.corsi != null).sort(byDesc('corsi'));
    if (el.length >= 6) {
      const top = el.slice(0, 3), low = el.slice(-3).reverse();
      const bx = P.slice().sort(byDesc('netxg_pg'))[0];
      out.push({
        eyebrow: 'Possession', tab: 'impact',
        title: `${top[0].short} had the best shot share, ${Math.round(top[0].corsi)}%`,
        body: `With ${list(top.map((r) => `${first(r)} (${Math.round(r.corsi)}%)`))} on the ice, the team took the biggest share of shot attempts. The lowest were ${list(low.map((r) => `${first(r)} (${Math.round(r.corsi)}%)`))}. Fifty percent is even. ${first(bx)} had the best expected-goal margin, ${signed(bx.netxg_pg, f2)} a game.`,
      });
    }

    // usage
    const topOf = (pos, n) => P.filter((r) => r.pos === pos).sort(byDesc('toi')).slice(0, n);
    const tf = topOf('F', 3), td = topOf('D', 3);
    if (tf.length && td.length) {
      let body = `Forwards: ${list(tf.map((r) => `${first(r)} ${r.toi_txt}`))}. Defense: ${list(td.map((r) => `${first(r)} ${r.toi_txt}`))}.`;
      body += tracked < 55 ? ' Ice time looks under-logged this season (see the data check above), so read these as relative minutes, not full-game minutes.' : '';
      out.push({ eyebrow: 'Usage', tab: 'roles', title: `${tf[0].short} and ${td[0].short} lead in ice time`, body });
    }

    // faceoffs
    const takers = P.filter((r) => r.fo > 0).sort(byDesc('fo'));
    if (takers.length) {
      const fo = sum('fo'), fow = sum('fow');
      const z = (k) => { const n = sum('fo_' + k), w = sum('fow_' + k); return n ? `${w} of ${n} (${pctOf(w, n)}%)` : 'no draws'; };
      const gone = Object.values(LAST).filter((l) => l.left), allFo = d3.sum(Object.values(LAST), (l) => l.fo);
      const share = allFo ? pctOf(d3.sum(gone, (l) => l.fo), allFo) : 0;
      out.push({
        eyebrow: 'Faceoffs', tab: 'roles',
        title: takers.length > 1 ? `${takers[0].short} and ${takers[1].short} took the most draws` : `${takers[0].short} took the draws`,
        body: `The team won ${b(fow)} of ${b(fo)} draws (${pctOf(fow, fo)}%). ${list(takers.slice(0, 4).map((r) => `${first(r)} ${r.fow} of ${r.fo}`))}. By zone: defensive ${z('dz')}, neutral ${z('nz')}, offensive ${z('oz')}.`
          + (share ? ` Players who have graduated took ${share}% of last season's draws, so who takes them is still an open question.` : ''),
      });
    }

    // penalties and roster
    const pen = P.filter((r) => r.pim > 0).sort(byDesc('pim')), drew = P.filter((r) => r.drawn > 0).sort(byDesc('drawn'));
    const missing = Object.entries(LAST).filter(([k, l]) => !l.left && !P.some((r) => r.short === k)).map(([k]) => esc(k));
    const fresh = P.filter((r) => !LAST[r.short]).map(first);
    const parts = [];
    parts.push(pen.length ? `${list(pen.map((r) => `${first(r)} (${r.pim})`))} took ${b(sum('pim'))} penalty minutes, and the team drew ${b(sum('drawn'))}${drew.length ? ': ' + list(drew.map((r) => first(r) + (r.drawn > 1 ? ' (' + r.drawn + ')' : ''))) : ''}.` : `No penalty minutes yet. The team drew ${b(sum('drawn'))}.`);
    if (missing.length) parts.push(`${list(missing)} from last year's roster ${missing.length === 1 ? 'has' : 'have'} not played yet. The file does not say why.`);
    if (fresh.length) parts.push(`New to the data this season: ${list(fresh)}.`);
    out.push({ eyebrow: 'Penalties and roster', tab: 'roles', title: missing.length ? `${list(missing)} ${missing.length === 1 ? 'has' : 'have'} not played yet` : 'Penalties and roster', body: parts.join(' ') });
    return out;
  }

  function drawOverview() {
    const goals = sum('g'), sog = sum('sog'), shots = sum('shots'), fo = sum('fo'), fow = sum('fow');
    $('#th-lede').innerHTML = `After ${count(G, 'game')}, the team has ${b(goals)} goals from ${b(sog)} shots on goal, and the shots were worth ${b(f1(sum('xg')))} expected goals.`
      + (S.log.length && S.log[S.log.length - 1].ga_min === 0 ? ' No skater was on the ice for a goal against in the latest game.' : '');
    const early = $('#th-early');
    early.hidden = G >= 8;
    early.innerHTML = G < 3
      ? `<b>Very early.</b> This is ${count(G, 'game')} of data, so every number describes one night, not a pattern. Read the charts as a snapshot and start looking for trends after about five games.`
      : `<b>Still early.</b> After ${G} games, one big night can still swing a total. Rates and plus-minus are the shakiest numbers.`;
    const chk = $('#th-check');
    const lastIce = (() => { const v = Object.values(LAST); const gm = d3.max(v, (l) => l.gp); return gm ? d3.sum(v, (l) => l.toi * l.gp) / (5 * gm) : 0; })();
    chk.hidden = tracked >= 55;
    chk.innerHTML = `<b>Check the ice time.</b> The skaters' ice time adds up to about ${Math.round(tracked)} minutes per 60-minute game${lastIce ? ` (last season's exports added up to about ${Math.round(lastIce)})` : ''}. Shots and goals look like a full game, so some ice time was probably not logged. Until that is sorted out, treat ice time and per-60 numbers as low-confidence and lean on shot share, pass accuracy and faceoffs.`;
    const kpi = (l, v, s2) => `<div class="th-kpi"><div class="th-kpi-l">${l}</div><div class="th-kpi-v">${v}</div><div class="th-kpi-s">${s2}</div></div>`;
    $('#th-kpis').innerHTML = kpi('Goals', goals, f1(sum('xg')) + ' expected')
      + kpi('Shots on goal', sog, `of ${shots} attempts (${pctOf(sog, shots)}%)`)
      + kpi('Faceoffs won', fo ? pctOf(fow, fo) + '%' : '–', `${fow} of ${fo} draws`)
      + kpi('Penalty minutes', sum('pim'), `${sum('drawn')} penalties drawn`);
    const finds = $('#th-finds');
    finds.replaceChildren(...insights().map((f) => {
      const a = document.createElement('article');
      a.className = 'th-find';
      a.innerHTML = `<div class="th-eyebrow">${esc(f.eyebrow)}</div><h3>${esc(f.title)}</h3><p>${f.body}</p><button type="button" class="th-link">See the charts</button>`;
      a.querySelector('.th-link').addEventListener('click', () => showTab(f.tab));
      return a;
    }));
  }

  /* ---------- panes ---------- */
  const DRAW = {
    overview: drawOverview,
    scoring() {
      const pts = P.filter((r) => r.p > 0).sort((a, c) => c.p - a.p || c.g - a.g || a.name.localeCompare(c.name));
      sbar($('#ch-points'), pts, {
        label: (r) => r.short, total: (r) => r.p, series: [{ name: 'Goals', f: 'g', color: C.g }, { name: 'First assists', f: 'a1', color: C.b }, { name: 'Second assists', f: 'a2', color: C.gold }],
        tip: (r) => [r.name, `${r.p} points in ${r.gp} ${r.gp === 1 ? 'game' : 'games'}`, `${r.g} goals, ${r.a1} first assists, ${r.a2} second assists`],
      });
      const fin = P.filter((r) => r.shots > 0).sort(byDesc('gxg'));
      hbar($('#ch-fin'), fin, {
        label: (r) => r.short, value: (r) => r.gxg, color: (r) => signColor(r.gxg), rowH: 22,
        vlabel: (r) => signed(r.gxg, f2), tick: (d) => (d > 0 ? '+' + d : d),
        tip: (r) => [r.name, `${r.g} goals, ${f2(r.xg)} expected`, `${r.shots} shots, ${r.shpct}% scored`],
      });
      const sh = P.slice().sort(byDesc('shots')).slice(0, 12);
      gbar($('#ch-shots'), sh, {
        label: (r) => r.short, series: [{ name: 'Attempts', f: 'shots', color: C.b }, { name: 'On goal', f: 'sog', color: C.g }],
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
      hbar($('#ch-corsi'), base.slice().sort(byDesc('corsi')), {
        label: (r) => r.short, value: (r) => r.corsi, base: 50, color: (r) => signColor(r.corsi, 50), rowH: 22,
        vlabel: (r) => Math.round(r.corsi) + '%', tick: (d) => d + '%',
        tip: (r) => [r.name, `${f1(r.corsi)}% of shot attempts`, `${r.gp} ${r.gp === 1 ? 'game' : 'games'}`],
      });
      hbar($('#ch-netxg'), P.slice().sort(byDesc('netxg_pg')), {
        label: (r) => r.short, value: (r) => r.netxg_pg, color: (r) => signColor(r.netxg_pg), rowH: 22,
        vlabel: (r) => signed(r.netxg_pg, f2), tick: (d) => (d > 0 ? '+' + d : d),
        tip: (r) => [r.name, `Team ${f2(r.xgf)} expected for, ${f2(r.xga)} against`, `Margin ${signed(r.netxg, f2)} over ${r.gp} ${r.gp === 1 ? 'game' : 'games'}`],
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
      const accs = base.map((r) => r.accpass);
      const pb = Math.round(median(accs));
      const dom = [Math.min(pb, ...accs) - 3, Math.min(100, Math.max(pb, ...accs) + 3)];
      const passOpt = {
        label: (r) => r.short, value: (r) => r.accpass, base: pb, domain: dom, color: (r) => signColor(r.accpass, pb), rowH: 22,
        vlabel: (r) => r.accpass + '%', tick: (d) => d + '%',
        tip: (r) => [r.name, `${r.accpass}% of passes accurate`, `${r.gp} ${r.gp === 1 ? 'game' : 'games'}`],
      };
      const byPass = (pos) => base.filter((r) => (r.pos === 'D') === (pos === 'D')).sort(byDesc('accpass'));
      hbar($('#ch-pass-f'), byPass('F'), passOpt);
      hbar($('#ch-pass-d'), byPass('D'), passOpt);
      const ent = base.slice().sort((a, c) => c.entries + c.breakouts - (a.entries + a.breakouts));
      gbar($('#ch-entries'), ent, {
        label: (r) => r.short, series: [{ name: 'Entries', f: 'entries', color: C.g }, { name: 'Breakouts', f: 'breakouts', color: C.b }],
        tip: (r) => [r.name, `Entries ${r.entries} a game`, `Breakouts ${r.breakouts} a game`],
      });
      const D = P.filter((r) => r.pos === 'D').sort(byDesc('slot'));
      const dopt = (f, lab, fmt) => ({ label: (r) => r.short, value: (r) => r[f], color: () => C.g, rowH: 24, vlabel: (r) => fmt(r[f]), tip: (r) => [r.name, `${lab} ${r[f]} a game`, `${r.gp} ${r.gp === 1 ? 'game' : 'games'}`] });
      hbar($('#ch-dslot'), D, dopt('slot', 'Passes to the slot', f2));
      hbar($('#ch-dbo'), D.slice().sort(byDesc('breakouts')), dopt('breakouts', 'Breakouts', f1));
      hbar($('#ch-dsh'), D.slice().sort(byDesc('shots_pg')), dopt('shots_pg', 'Shots', f1));
    },
    roles() {
      const toi = (pos) => P.filter((r) => r.pos === pos).sort(byDesc('toi'));
      const topt = { label: (r) => r.short, value: (r) => r.toi, color: () => C.g, rowH: 22, vlabel: (r) => r.toi_txt, tip: (r) => [r.name, `${r.toi_txt} a game`, `${r.gp} ${r.gp === 1 ? 'game' : 'games'}`] };
      hbar($('#ch-toi-f'), toi('F'), topt);
      hbar($('#ch-toi-d'), toi('D'), topt);
      const tk = P.filter((r) => r.fo > 0).sort(byDesc('fo'));
      if (!tk.length) { ['#ch-fo', '#ch-fz-dz', '#ch-fz-nz', '#ch-fz-oz'].forEach((s) => message($(s), 'No faceoffs recorded yet.')); $('#th-fz-sum').textContent = ''; }
      else {
        hbar($('#ch-fo'), tk, { label: (r) => r.short, value: (r) => r.fo, color: () => C.g, rowH: 26, vlabel: (r) => `${r.fo} ${r.fo === 1 ? 'draw' : 'draws'}, ${r.fopct}%`, tip: (r) => [r.name, `${r.fow} won of ${r.fo} draws`, `${r.fopct}% win rate`] });
        [['dz', 'defensive'], ['nz', 'neutral'], ['oz', 'offensive']].forEach(([z, name]) => {
          const n = (r) => r['fo_' + z], w = (r) => r['fow_' + z], pc = (r) => (n(r) ? (w(r) / n(r)) * 100 : 50);
          hbar($('#ch-fz-' + z), tk, {
            label: (r) => r.short, value: pc, base: 50, domain: [0, 100], color: (r) => signColor(pc(r), 50), rowH: 24,
            vlabel: (r) => (n(r) ? `${w(r)} of ${n(r)}` : '–'), tick: (d) => d + '%',
            tip: (r) => [r.name, n(r) ? `${w(r)} won of ${n(r)} ${name}-zone draws` : `No ${name}-zone draws`, n(r) ? Math.round(pc(r)) + '% win rate' : ''].filter(Boolean),
          });
        });
        const z = (k) => { const n = sum('fo_' + k), w = sum('fow_' + k); return n ? `${w} of ${n} (${pctOf(w, n)}%)` : 'none taken'; };
        $('#th-fz-sum').innerHTML = `Team totals: defensive zone ${z('dz')}, neutral zone ${z('nz')}, offensive zone ${z('oz')}.`;
      }
      const pen = P.filter((r) => r.pim > 0 || r.drawn > 0).sort((a, c) => c.pim - a.pim || c.drawn - a.drawn || a.name.localeCompare(c.name));
      if (!pen.length) message($('#ch-pen'), 'No penalties yet.');
      else gbar($('#ch-pen'), pen, {
        label: (r) => r.short, series: [{ name: 'Penalty minutes taken', f: 'pim', color: C.bad }, { name: 'Penalties drawn', f: 'drawn', color: C.g }],
        tip: (r) => [r.name, `${r.pim} penalty minutes taken`, `${r.drawn} penalties drawn`],
      });
      [['pp', 'pp_min', 'Power-play'], ['pk', 'pk_min', 'Penalty-kill']].forEach(([id, f, name]) => {
        const card = $('#ch-' + id).closest('.th-card');
        card.hidden = !(sum(f) > 0);
        if (card.hidden) return;
        hbar($('#ch-' + id), P.filter((r) => r[f] > 0).sort(byDesc(f)).slice(0, 10), {
          label: (r) => r.short, value: (r) => r[f], color: () => C.g, rowH: 22, vlabel: (r) => r[f] + ' min', tip: (r) => [r.name, `${r[f]} minutes in ${r.gp} ${r.gp === 1 ? 'game' : 'games'}`],
        });
      });
    },
    last() { drawLast(); },
    games() {
      const log = S.log;
      gcols($('#ch-g-goals'), log, { series: [{ name: 'Goals', f: 'g', color: C.g }, { name: 'Expected goals', f: 'xg', color: C.b, fmt: f1 }], tip: (r) => [`Game ${r.game}`, `${r.g} goals, ${f2(r.xg)} expected`] });
      gcols($('#ch-g-shots'), log, { series: [{ name: 'Attempts', f: 'shots', color: C.b }, { name: 'On goal', f: 'sog', color: C.g }], tip: (r) => [`Game ${r.game}`, `${r.shots} attempts, ${r.sog} on goal`] });
      const cols = [['Game', (r) => r.game], ['Date', (r) => fmtDate(r.date)], ['Goals', (r) => r.g], ['xG', (r) => f2(r.xg)], ['Shots', (r) => r.shots], ['On goal', (r) => r.sog],
        ['FO %', (r) => (r.fo ? pctOf(r.fow, r.fo) + '%' : '–')], ['PIM', (r) => r.pim], ['Drawn', (r) => r.drawn], ['Skaters', (r) => r.skaters]];
      const t = $('#th-glog');
      t.tHead.innerHTML = '<tr>' + cols.map(([l], i) => `<th scope="col" class="${i > 1 ? 'r' : ''}"><span class="th-sort" style="display:block;cursor:default">${l}</span></th>`).join('') + '</tr>';
      t.tBodies[0].replaceChildren(...log.slice().reverse().map((r) => {
        const tr = document.createElement('tr');
        cols.forEach(([, f], i) => { const td = document.createElement('td'); td.textContent = f(r); if (i > 1) td.className = 'n'; tr.appendChild(td); });
        return tr;
      }));
    },
  };

  /* ---------- vs last season ---------- */
  const METRICS = [
    { k: 'ppg', label: 'Points per game', cur: (r) => r.ppg, prev: (l) => l.ppg, dfmt: (v) => signed(v, f2) },
    { k: 'corsi', label: 'Shot share', cur: (r) => r.corsi, prev: (l) => l.corsi, dfmt: (v) => signed(v) + ' pts' },
    { k: 'accpass', label: 'Pass accuracy', cur: (r) => r.accpass, prev: (l) => l.accpass, dfmt: (v) => signed(v, f0) + ' pts' },
    { k: 'netxg60', label: 'On-ice xG margin per 60', cur: (r) => r.netxg60, prev: (l) => (l.toi ? (l.netxg_pg / l.toi) * 60 : 0), dfmt: (v) => signed(v, f2) },
  ];
  let metric = METRICS[0];
  function drawLast() {
    const rows = P.filter((r) => LAST[r.short] && r.gp >= minGP && metric.cur(r) != null).sort((a, c) => metric.cur(c) - metric.cur(a) || a.name.localeCompare(c.name));
    const pv = (r) => metric.prev(LAST[r.short]);
    dumbbell($('#ch-last'), rows, {
      label: (r) => r.short, cur: metric.cur, prev: pv, dfmt: metric.dfmt,
      tip: (r) => [r.name, `This season ${f2(metric.cur(r))} over ${r.gp} ${r.gp === 1 ? 'game' : 'games'}`, `Last season ${f2(pv(r))} over ${LAST[r.short].gp} games`],
    });
    const d = (r) => metric.cur(r) - pv(r);
    const up = rows.filter((r) => d(r) > 0).sort((a, c) => d(c) - d(a)).slice(0, 3), down = rows.filter((r) => d(r) < 0).sort((a, c) => d(a) - d(c)).slice(0, 3);
    const parts = [];
    if (up.length) parts.push(`Biggest gains: ${list(up.map((r) => esc(r.short) + ' (' + metric.dfmt(d(r)) + ')'))}.`);
    if (down.length) parts.push(`Biggest drops: ${list(down.map((r) => esc(r.short) + ' (' + metric.dfmt(d(r)) + ')'))}.`);
    parts.push(G < 5 ? `After ${count(G, 'game')} these gaps are mostly noise. Last season is a full year and this season is a few nights.` : 'Gaps this size can still be a hot or cold stretch.');
    $('#th-last-sum').innerHTML = parts.join(' ');
  }
  const seg = $('#th-seg');
  METRICS.forEach((m, i) => {
    const bt = document.createElement('button');
    bt.type = 'button'; bt.className = 'th-fbtn'; bt.textContent = m.label; bt.setAttribute('aria-pressed', String(i === 0));
    bt.addEventListener('click', () => { metric = m; $$('#th-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === bt))); drawLast(); });
    seg.appendChild(bt);
  });

  /* ---------- tabs ---------- */
  const STATIC = ['players', 'stats', 'notes'];
  let current = 'overview';
  function showTab(name, fromHash) {
    if (!DRAW[name] && !STATIC.includes(name)) return;
    current = name;
    $$('.th-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    $$('.th-tabs [role=tab]').forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.tab === name)); t.tabIndex = t.dataset.tab === name ? 0 : -1; });
    $('#th-intro').hidden = name !== 'overview';
    if (!fromHash) { history.replaceState(null, '', '#tab-' + name); window.scrollTo?.(0, 0); }
    draw();
  }
  const tabs = $$('.th-tabs [role=tab]');
  tabs.forEach((t, i) => {
    t.setAttribute('aria-controls', 'pane-' + t.dataset.tab);
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const n = tabs.length;
      const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
      if (j === null) return;
      e.preventDefault(); tabs[j].focus(); showTab(tabs[j].dataset.tab);
    });
  });
  $$('.th-pane').forEach((p) => {
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', 'tab-' + p.dataset.pane);
    if (p.dataset.pane !== 'overview') {
      const h = document.createElement('h2');
      h.className = 'th-sr'; h.textContent = $('#tab-' + p.dataset.pane).textContent;
      p.prepend(h);
    }
  });

  /* ---------- player cards ---------- */
  function playerCard(r, ctx) {
    const lp = LAST[r.short];
    const chips = [];
    if (r.p > 0 && r.p === ctx.maxP) chips.push('Points leader');
    if (ctx.topShare.has(r.short)) chips.push('Top shot share');
    if (r.gxg >= 0.75 * Math.sqrt(G)) chips.push('Finishing high');
    else if (r.xg >= 0.4 * Math.sqrt(G) && r.gxg <= -0.4 * Math.sqrt(G)) chips.push('Finishing low');
    if (r.fo >= 5) chips.push('Faceoffs');
    if (r.pim > 0) chips.push('Penalty');
    if (!lp) chips.push('New to the data');
    const s = [];
    s.push(`${b(r.toi_txt)} ${G > 1 ? 'a game' : 'of ice time'}, ` + (r.shots ? `${count(r.shots, 'shot')} (${r.sog} on goal) for ${count(r.g, 'goal')} on ${f1(r.xg)} expected.` : `no shots, and ${f1(r.xg)} expected goals.`));
    if (r.corsi != null) s.push(`The team took ${b(Math.round(r.corsi) + '%')} of shot attempts with him on the ice and made ${signed(r.netxg_pg, f2)} expected goals a game.`);
    if (r.fo) s.push(`Took ${count(r.fo, 'faceoff')} and won ${b(r.fopct + '%')}.`);
    if (r.pim || r.drawn) s.push([r.pim ? `Took ${r.pim} penalty ${r.pim === 1 ? 'minute' : 'minutes'}` : '', r.drawn ? `drew ${count(r.drawn, 'penalty').replace('penaltys', 'penalties')}` : ''].filter(Boolean).join(' and ').replace(/^./, (c) => c.toUpperCase()) + '.');
    if (lp) s.push(`Last season: ${f2(lp.ppg)} points a game, ${lp.toi_txt} a night, ${f1(lp.corsi)}% shot share.`);
    const a = document.createElement('article');
    a.className = 'th-pc'; a.dataset.grp = r.pos;
    a.innerHTML = `<header><h3>${esc(r.name)}</h3><div class="th-pc-sub">#${r.num} · ${esc(r.pos)} · ${r.gp} GP</div></header>`
      + `<dl class="th-pc-stats">${[['G', r.g], ['A', r.a], ['P', r.p], ['+/-', r.pm], ['SOG', r.sog]].map(([l, v]) => `<div><dt>${l}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + `<div class="th-chips">${chips.slice(0, 3).map((c) => `<span class="th-chip">${esc(c)}</span>`).join('')}</div><p>${s.join(' ')}</p>`;
    return a;
  }
  let pf = 'all';
  function drawPlayers() {
    const ctx = { maxP: d3.max(P, (r) => r.p), topShare: new Set(P.filter((r) => r.gp >= minGP && r.corsi != null).sort(byDesc('corsi')).slice(0, 3).map((r) => r.short)) };
    $('#th-cards').replaceChildren(...P.map((r) => playerCard(r, ctx)));
    applyPlayers();
  }
  function applyPlayers() {
    $$('.th-pc').forEach((c) => { c.hidden = !(pf === 'all' || c.dataset.grp === pf); });
    $$('.th-fbtn[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === pf)));
  }
  $$('.th-fbtn[data-f]').forEach((x) => x.addEventListener('click', () => { pf = x.dataset.f; applyPlayers(); }));

  /* ---------- table ---------- */
  const COLS = [['name', 'Player'], ['num', '#'], ['pos', 'Pos'], ['gp', 'GP'], ['toi_txt', 'TOI'], ['g', 'G'], ['a', 'A'], ['p', 'P'], ['pm', '+/-'], ['ppg', 'P/GP'], ['p60', 'P/60'],
    ['shots', 'Shots'], ['sog', 'SOG'], ['shpct', 'Sh%'], ['xg', 'xG'], ['gxg', 'G-xG'], ['netxg', 'On-ice xG'], ['corsi', 'Shot %'], ['fo', 'FO'], ['fopct', 'FO%'], ['pim', 'PIM'], ['drawn', 'Drawn']];
  const TEXT = ['name', 'pos'];
  $('#th-table').tHead.innerHTML = '<tr>' + COLS.map(([f, l]) => `<th scope="col" data-field="${f}"><button type="button" class="th-sort" data-k="${f}">${l}</button></th>`).join('') + '</tr>';
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
    tb.replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      COLS.forEach(([f]) => { const td = document.createElement('td'); td.textContent = show(f, r[f]); if (!TEXT.includes(f)) td.className = 'n'; tr.appendChild(td); });
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

  /* ---------- draw and load ---------- */
  function fillVars() {
    const v = { minGP, minGames: count(minGP, 'game'), games: G, updated: S.updated ? fmtDate(S.updated) : '', passBase: Math.round(median(P.map((r) => r.accpass))) };
    $$('[data-var]').forEach((el) => { el.textContent = v[el.dataset.var]; });
  }
  function draw() {
    if (!P.length) return;
    fillVars();
    if (current === 'players') drawPlayers();
    if (current === 'stats') renderTable();
    if (DRAW[current]) DRAW[current]();
  }

  Promise.all(['players', 'season', 'last-season'].map((n) => fetch(`data/${n}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then(([players, season, last]) => {
      if (!players || !season) throw new Error('missing data');
      P = players; S = season; LAST = last || {};
      G = S.games; minGP = Math.max(1, Math.ceil(G / 2));
      tracked = d3.sum(P, (r) => r.toi * r.gp) / (5 * G);
      $('#th-status').textContent = `Through game ${G} · updated ${fmtDate(S.updated)}`;
      draw();
    })
    .catch(() => { $('#th-status').textContent = 'Could not load the data'; $$('.th-chart').forEach((el) => statusLine(el, { status: 'error' })); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); });

  const named = (location.hash || '').slice(1);
  if (named.startsWith('tab-')) showTab(named.slice(4), true);
})();
