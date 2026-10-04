"""Adapter: server EEG (socket.io, event state_update) -> bridge TypeWave (pesan mind, ~5 Hz).

Pemakaian: .venv/bin/python -m adapters.eeg_socketio [--eeg http://127.0.0.1:8765] [--bridge ws://127.0.0.1:8770/ws]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import time

import aiohttp
import socketio

COMMAND_EVENTS = ['eyebrow_raise', 'jaw_clench', 'double_jaw', 'tilt_left', 'tilt_right', 'tilt_up', 'tilt_down']
REQUIRED = ('spectrum_pos', 'eeg_active', 'warming_up', 'muse')
MIN_INTERVAL = 0.18  # detik: 10 Hz dari server -> ~5 Hz ke bridge
BACKOFF = (1, 2, 5)


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def to_mind(payload) -> dict | None:
    """Pemetaan state_update -> mind. None = jangan kirim (halaman jatuh ke noSignal setelah 5 detik)."""
    if not isinstance(payload, dict):
        return None
    if not payload.get('eeg_active') or payload.get('warming_up') or payload.get('muse') != 'connected':
        return None
    pos = payload.get('spectrum_pos')
    if not _is_num(pos):
        return None
    out = {'t': 'mind', 'pos': float(pos)}
    hr = payload.get('heart_rate')  # BUKAN 'bpm': itu tempo drum engine
    if _is_num(hr) and hr > 0:
        out['hr'] = float(hr)
    cq = payload.get('channel_quality')
    if isinstance(cq, dict):
        vals = [float(v) for v in cq.values() if _is_num(v)]
        if vals:
            out['q'] = sum(vals) / len(vals)
    # Level gelombang 0..1 (sudah dinormalisasi server terhadap riwayat user sendiri): theta lambat, alpha santai, beta cepat.
    for key in ('theta', 'alpha', 'beta'):
        v = payload.get(key)
        if _is_num(v) and math.isfinite(v):
            out[key] = min(1.0, max(0.0, float(v)))
    return out


def missing_fields(payload) -> list[str]:
    if not isinstance(payload, dict):
        return list(REQUIRED)
    return [k for k in REQUIRED if k not in payload]


class Adapter:
    def __init__(self, eeg_url: str, bridge_url: str, log=print, clock=time.monotonic) -> None:
        self.eeg_url = eeg_url
        self.bridge_url = bridge_url
        self.log = log
        self.clock = clock
        self.sio = socketio.AsyncClient(reconnection=True, reconnection_delay=1, reconnection_delay_max=5)
        self.sent = 0
        self._ws = None
        self._last_sent = -1e9
        self._warned: dict[str, float] = {}
        self.sio.on('state_update', self.on_state)
        for name in COMMAND_EVENTS:
            self.sio.on(name, self._command_handler(name))

    def _warn(self, key: str, text: str, every: float) -> None:
        now = self.clock()
        if now - self._warned.get(key, -1e9) >= every:
            self._warned[key] = now
            self.log(text)

    def _command_handler(self, name: str):
        async def handler(*_args):
            self._warn('cmd:' + name, f"[peringatan] command mental '{name}' menembak; key yang dipetakan akan terbaca "
                                      "sebagai ketikan. Matikan command mental (typing mode), lihat README.", every=10)
        return handler

    async def on_state(self, payload) -> None:
        miss = missing_fields(payload)
        if miss:
            self._warn('fields', f"[peringatan] field state_update tidak ada: {', '.join(miss)} "
                                 "(nama field di server EEG berubah?)", every=30)
        msg = to_mind(payload)
        if msg is None:
            return
        now = self.clock()
        if now - self._last_sent < MIN_INTERVAL:
            return
        self._last_sent = now
        if self._ws is not None and not self._ws.closed:
            try:
                await self._ws.send_str(json.dumps(msg))
                self.sent += 1
            except Exception:
                pass

    async def bridge_loop(self) -> None:
        i = 0
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    async with session.ws_connect(self.bridge_url) as ws:
                        self._ws = ws
                        i = 0
                        self.log('terhubung ke bridge')
                        async for _ in ws:
                            pass
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self.log(f'bridge tidak terhubung: {exc}')
                finally:
                    self._ws = None
                await asyncio.sleep(BACKOFF[min(i, len(BACKOFF) - 1)])
                i += 1

    async def eeg_loop(self) -> None:
        i = 0
        while True:
            try:
                await self.sio.connect(self.eeg_url, wait_timeout=5)
                self.log('terhubung ke server EEG')
                i = 0
                await self.sio.wait()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.log(f'server EEG tidak terhubung: {exc}')
            await asyncio.sleep(BACKOFF[min(i, len(BACKOFF) - 1)])
            i += 1

    async def close(self) -> None:
        """Putuskan socket.io dan tutup sesi HTTP engineio (aman dipanggil setelah run() dibatalkan)."""
        try:
            await self.sio.disconnect()
        except (Exception, asyncio.CancelledError):  # task baca ikut dibatalkan bersama task adapter
            pass
        http = getattr(self.sio.eio, 'http', None)
        if http is not None and not http.closed:
            await http.close()

    async def run(self) -> None:
        try:
            await asyncio.gather(self.bridge_loop(), self.eeg_loop())
        finally:
            await self.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--eeg', default='http://127.0.0.1:8765')
    ap.add_argument('--bridge', default='ws://127.0.0.1:8770/ws')
    args = ap.parse_args()
    try:
        asyncio.run(Adapter(args.eeg, args.bridge).run())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
