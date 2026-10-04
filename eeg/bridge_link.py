"""Koneksi WebSocket ke bridge TypeWave dengan reconnect otomatis (backoff 1, 2, 5 detik).

Pesan hanya dikirim bila sedang tersambung; selama putus pesan dibuang (data EEG yang basi tidak berguna, dan tidak boleh menumpuk).
"""
from __future__ import annotations

import asyncio
import json
from typing import Callable, Optional

import aiohttp

from .config import DEFAULT, Settings


class BridgeLink:
    def __init__(self, url: str, settings: Settings = DEFAULT, log: Callable = print) -> None:
        self.url = url
        self.s = settings
        self.log = log
        self.connects = 0
        self.sent = 0
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._ws.closed

    async def send(self, msg: dict) -> bool:
        ws = self._ws
        if ws is None or ws.closed:
            return False
        try:
            await ws.send_str(json.dumps(msg))
            self.sent += 1
            return True
        except Exception:
            return False

    async def run(self) -> None:
        i = 0
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    async with session.ws_connect(self.url, heartbeat=20) as ws:
                        self._ws = ws
                        self.connects += 1
                        i = 0
                        self.log('terhubung ke bridge')
                        async for _ in ws:  # menguras pesan masuk; loop berakhir saat koneksi tertutup
                            pass
                    self.log('koneksi ke bridge terputus')
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self.log(f'bridge tidak terhubung: {exc}')
                finally:
                    self._ws = None
                await asyncio.sleep(self.s.bridge_backoff[min(i, len(self.s.bridge_backoff) - 1)])
                i += 1
