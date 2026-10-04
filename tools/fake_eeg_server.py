"""Server EEG palsu: meniru event state_update (nama field sama persis dengan eeg_server.py) untuk tes dan demo.

Pemakaian: .venv/bin/python -m tools.fake_eeg_server --port 8765 --wander
"""
from __future__ import annotations

import argparse
import asyncio
import math
import time

import socketio
from aiohttp import web


def default_payload() -> dict:
    return {
        'state': 'flow', 'bpm': 100.0,  # bpm = tempo drum engine (sengaja berbeda dari heart_rate)
        'tense_level': 0.0, 'arousal': 0.0, 'threshold': 0.02, 'warming_up': False, 'confidence': 0.5,
        'consistency': 0.5, 'flow_score': 0.5, 'spectrum_pos': 0.5, 'eeg_active': True,
        'alpha': 0.3, 'beta': 0.3, 'theta': 0.3, 'tbr': 0.5, 'muse': 'connected', 'heart_rate': 71.0,
        'battery_percent': 80, 'channel_quality': {'TP9': 1.0, 'AF7': 1.0, 'AF8': 0.5, 'TP10': 1.0},
        'cursor_control': False,
    }


def wander_state(t: float) -> dict:
    """Mode --wander: spectrum_pos bergerak calm -> tense, level gelombang mengikuti (santai = theta/alpha tinggi, tegang = beta tinggi)."""
    pos = 0.5 + 0.45 * math.sin(t / 8)

    def clip(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 3)

    return {
        'spectrum_pos': round(pos, 3),
        'beta': clip(0.1 + 0.85 * pos + 0.08 * math.sin(t / 2.3)),
        'alpha': clip(0.95 - 0.7 * pos + 0.1 * math.sin(t / 3.1 + 1)),
        'theta': clip(0.9 - 0.8 * pos + 0.12 * math.sin(t / 4.7 + 2)),
    }


class FakeEEG:
    def __init__(self, hz: float = 10.0) -> None:
        self.hz = hz
        self.payload = default_payload()
        self.wander = False
        self.sio = socketio.AsyncServer(async_mode='aiohttp', cors_allowed_origins='*')
        self.app = web.Application()
        self.sio.attach(self.app)
        self.runner: web.AppRunner | None = None
        self._task: asyncio.Task | None = None

    async def start(self, port: int = 0) -> int:
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        await web.TCPSite(self.runner, '127.0.0.1', port).start()
        self._task = asyncio.create_task(self._loop())
        return self.runner.addresses[0][1]

    async def _loop(self) -> None:
        t0 = time.monotonic()
        while True:
            if self.wander:
                self.payload.update(wander_state(time.monotonic() - t0))
            await self.sio.emit('state_update', dict(self.payload))
            await asyncio.sleep(1 / self.hz)

    async def emit_command(self, name: str) -> None:
        await self.sio.emit(name, {})

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self.runner is not None:
            await self.runner.cleanup()


async def _serve(port: int, wander: bool) -> None:
    eeg = FakeEEG()
    eeg.wander = wander
    print(f'FakeEEG di http://127.0.0.1:{await eeg.start(port)}  (wander={wander})', flush=True)
    await asyncio.Event().wait()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--wander', action='store_true', help='spectrum_pos dan level theta/alpha/beta bergerak calm -> tense -> calm')
    args = ap.parse_args()
    try:
        asyncio.run(_serve(args.port, args.wander))
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
