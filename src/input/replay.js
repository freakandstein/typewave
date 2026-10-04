// Pemutar sesi: file {events:[{t, type:'key'|'mind', ...}]} dikirim ke bus dengan timeline asli.
export async function loadReplay(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`replay ${url}: HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.events)) throw new Error(`replay ${url}: field events tidak ada`);
  return data.events;
}

export function createReplay({ bus, events, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, speed = 1, onDone }) {
  let i = 0, t0 = 0, timer = null, running = false, done = false;

  function emit(ev) {
    if (ev.type === 'key') bus.emit('key', { code: ev.code, at: now(), rep: !!ev.rep, mods: ev.mods || [] });
    else if (ev.type === 'mind') {
      const mind = { pos: ev.pos, hr: ev.hr, q: ev.q };
      for (const k of ['theta', 'alpha', 'beta']) if (ev[k] !== undefined) mind[k] = ev[k];
      bus.emit('mind', mind);
    }
  }

  function pump() {
    timer = null;
    if (!running) return;
    const elapsed = (now() - t0) * speed;
    while (i < events.length && events[i].t <= elapsed) emit(events[i++]);
    if (i >= events.length) {
      running = false;
      done = true;
      if (onDone) onDone();
      return;
    }
    timer = setTimer(pump, Math.max(0, (events[i].t - elapsed) / speed));
  }

  return {
    start() { if (running) return; running = true; done = false; i = 0; t0 = now(); pump(); },
    stop() { running = false; if (timer !== null) clearTimer(timer); timer = null; },
    get done() { return done; },
  };
}
