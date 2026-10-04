// keydown di halaman (pengembangan). Aktif hanya bila enabled() true, mis. saat bridge tidak melaporkan listener global.
export function modsOf(e) {
  const m = [];
  if (e.shiftKey) m.push('shift');
  if (e.ctrlKey) m.push('ctrl');
  if (e.altKey) m.push('alt');
  if (e.metaKey) m.push('cmd');
  return m;
}

export function createBrowserKeys({ bus, win, enabled = () => true, now = Date.now }) {
  const onKey = (e) => {
    if (!enabled() || !e.code) return;
    bus.emit('key', { code: e.code, at: now(), rep: !!e.repeat, mods: modsOf(e) });
  };
  win.addEventListener('keydown', onKey);
  return { stop() { win.removeEventListener('keydown', onKey); } };
}
