// Statistik dan API debug (?debug=1): dipakai tes e2e dan overlay debug.
export function createStats() {
  return { keysReceived: 0, lastCode: null, helloCount: 0, hello: null, wsConnected: false, latencies: [], seq: [] };
}

export function recordKey(stats, ev, now = Date.now()) {
  stats.keysReceived++;
  stats.lastCode = ev.code;
  stats.latencies.push(now - ev.at);
  if (stats.latencies.length > 5000) stats.latencies.shift();
  stats.seq.push(ev.code);
  if (stats.seq.length > 5000) stats.seq.shift();
}

export function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}
