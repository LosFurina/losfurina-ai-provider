// public/components/chart.js
const THEME = {
  bg: 'transparent',
  axis: 'rgba(148,163,184,0.6)',
  grid: 'rgba(30,35,48,0.8)',
  text: '#94a3b8',
};

const COLORS = ['#3b82f6', '#a78bfa', '#f472b6', '#4ade80', '#fbbf24', '#06b6d4'];

export function renderLineChart(container, { buckets, series, height = 200, formatY }) {
  if (!window.uPlot) {
    container.innerHTML = '<div style="padding:20px;color:var(--accent-red)">uPlot not loaded</div>';
    return;
  }
  const xs = buckets.map(b => Math.floor(new Date(b.ts).getTime() / 1000));
  const seriesConfigs = [{}];
  const seriesData = [xs];

  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    seriesData.push(buckets.map(b => s.extract(b)));
    seriesConfigs.push({
      label: s.label,
      stroke: COLORS[i % COLORS.length],
      width: 2,
      fill: i === 0 ? hexToRgba(COLORS[0], 0.1) : undefined,
      points: { show: false },
    });
  }

  const containerId = container.id || '(no-id)';
  const yValues = formatY
    ? (u, splits) => splits.map(s => formatY(s))
    : undefined;
  const opts = {
    width: container.clientWidth || 800,
    height,
    cursor: { drag: { x: true, y: false } },
    scales: { x: { time: true } },
    axes: [
      { stroke: THEME.text, grid: { stroke: THEME.grid } },
      { stroke: THEME.text, grid: { stroke: THEME.grid }, size: 60, values: yValues },
    ],
    series: seriesConfigs,
    legend: { show: series.length > 1 },
  };
  container.innerHTML = '';
  new window.uPlot(opts, seriesData, container);
}

export function renderDonut(container, { slices, total, totalLabel = '' }) {
  // SVG donut — uPlot doesn't do donuts; tiny hand-rolled SVG
  const radius = 40, cx = 50, cy = 50, stroke = 12, circ = 2 * Math.PI * radius;
  let acc = 0;
  const segments = slices.map((s, i) => {
    const portion = total > 0 ? s.value / total : 0;
    const dash = portion * circ;
    const offset = -acc;
    acc += dash;
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
              stroke="${COLORS[i % COLORS.length]}" stroke-width="${stroke}"
              stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${offset}"
              transform="rotate(-90 ${cx} ${cy})"/>`;
  }).join('');
  const legend = slices.map((s, i) => `
    <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">
      <span><span style="color:${COLORS[i % COLORS.length]}">●</span> ${s.label}</span>
      <span style="color:var(--text-secondary)">${s.display}</span>
    </div>`).join('');
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="var(--border-subtle)" stroke-width="${stroke}"/>
        ${segments}
        <text x="${cx}" y="${cy}" text-anchor="middle" dy="4" fill="var(--text-primary)" font-size="11" font-weight="600">${totalLabel}</text>
      </svg>
      <div style="width:100%">${legend}</div>
    </div>
  `;
}

function hexToRgba(hex, alpha) {
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}
