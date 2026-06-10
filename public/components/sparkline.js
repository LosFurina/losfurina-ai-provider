// public/components/sparkline.js
// Renders a 24-hour status sparkline: 24 cells, each colored by hourly worst status.
export function renderStatusSparkline({ healthLogs, hours = 24 }) {
  const buckets = [];
  const now = Date.now();
  for (let i = hours - 1; i >= 0; i--) {
    const start = now - (i + 1) * 3600 * 1000;
    const end = now - i * 3600 * 1000;
    const inBucket = healthLogs.filter(h => {
      const t = new Date(h.ts).getTime();
      return t >= start && t < end;
    });
    let status = 'none';
    if (inBucket.length) {
      if (inBucket.some(h => h.status === 'unhealthy')) status = 'unhealthy';
      else if (inBucket.some(h => h.status === 'degraded')) status = 'degraded';
      else status = 'healthy';
    }
    buckets.push(status);
  }
  const colorOf = (s) => ({
    healthy: '#4ade80',
    degraded: '#fbbf24',
    unhealthy: '#ef4444',
    none: '#334155',
  })[s];
  const cellW = 6, gap = 2, h = 16;
  const totalW = hours * (cellW + gap);
  const cells = buckets.map((s, i) => `
    <rect x="${i * (cellW + gap)}" y="0" width="${cellW}" height="${h}" rx="1" fill="${colorOf(s)}"/>
  `).join('');
  return `<svg width="${totalW}" height="${h}" viewBox="0 0 ${totalW} ${h}">${cells}</svg>`;
}

export function renderLatencyLineSparkline({ healthLogs, hours = 24 }) {
  const points = healthLogs
    .filter(h => h.status !== 'unhealthy' && typeof h.latency_ms === 'number')
    .map(h => ({ t: new Date(h.ts).getTime(), v: h.latency_ms }));
  if (!points.length) return '<div style="color:var(--text-tertiary);font-size:11px">无数据</div>';
  const w = 240, h = 40;
  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const maxV = Math.max(...points.map(p => p.v), 1);
  const path = points.map((p, i) => {
    const x = ((p.t - minT) / Math.max(maxT - minT, 1)) * w;
    const y = h - (p.v / maxV) * h;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="${path}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
  </svg>`;
}
