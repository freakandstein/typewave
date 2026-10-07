"""Bridge TypeWave: file statis + relay WebSocket + hotkey + /status. Hanya listen di 127.0.0.1."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
from pathlib import Path

from aiohttp import WSMsgType, web

ROOT = Path(__file__).resolve().parent.parent
MAX_MSG = 4096
MODS = ('shift', 'ctrl', 'alt', 'cmd')
HEADSET_STATES = ('connecting', 'connected', 'reconnecting', 'stopped')
STATIC_DIRS = ('src', 'assets', 'replay')
ALLOWED_HOSTS = ('127.0.0.1', 'localhost')


def _num(v):
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    return float(v) if ok else None


class Bridge:
    def __init__(self) -> None:
        self.clients: set[web.WebSocketResponse] = set()
        self.paused = False
        self.keys_forwarded = 0
        self.dropped = 0
        self.listener_status = 'off'  # off | ok | no-permission | secure-input

    # --- status --------------------------------------------------------------
    @staticmethod
    def _active(status: str) -> bool:
        return status in ('ok', 'secure-input')

    def hello(self) -> dict:
        # Snapshot status bridge: klien yang (kembali) tersambung selalu tahu keadaan terkini, bukan mewarisi yang basi.
        return {'t': 'hello', 'keys': self._active(self.listener_status), 'paused': self.paused,
                'secure': self.listener_status == 'secure-input'}

    async def set_listener_status(self, status: str) -> None:
        prev = self.listener_status
        if status == prev:
            return
        self.listener_status = status
        if self._active(status) != self._active(prev):
            await self.broadcast(self.hello())
        if (status == 'secure-input') != (prev == 'secure-input'):
            await self.broadcast({'t': 'ctl', 'secure': status == 'secure-input'})

    async def set_paused(self, value: bool) -> None:
        if value != self.paused:
            self.paused = value
            await self.broadcast({'t': 'ctl', 'pause': value})

    # --- relay ---------------------------------------------------------------
    async def broadcast(self, msg: dict, exclude: web.WebSocketResponse | None = None) -> None:
        text = json.dumps(msg, separators=(',', ':'))
        for ws in list(self.clients):
            if ws is exclude or ws.closed:
                continue
            try:
                await ws.send_str(text)
            except Exception:  # satu klien mati tidak boleh mengganggu yang lain
                self.clients.discard(ws)

    async def on_key(self, code: str, at: int, rep: bool, mods: list[str], source=None) -> str:
        # Hotkey kontrol TypeWave (ctrl+alt+P / ctrl+alt+R) dikonsumsi di sini dan tidak diteruskan sebagai key.
        if 'ctrl' in mods and 'alt' in mods and code in ('KeyP', 'KeyR'):
            if not rep:
                if code == 'KeyP':
                    await self.set_paused(not self.paused)
                else:
                    await self.broadcast({'t': 'ctl', 'report': True})
            return 'hotkey'
        if self.paused:
            return 'paused'
        self.keys_forwarded += 1
        await self.broadcast({'t': 'key', 'code': code, 'at': at, 'rep': rep, 'mods': mods}, exclude=source)
        return 'sent'

    async def on_text(self, ws: web.WebSocketResponse, text: str) -> None:
        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                self.dropped += 1
                continue
            await self.on_message(ws, msg)

    async def on_message(self, ws: web.WebSocketResponse, msg) -> None:
        if not isinstance(msg, dict):
            self.dropped += 1
            return
        t = msg.get('t')
        if t == 'key':
            code = msg.get('code')
            if not isinstance(code, str) or not 0 < len(code) <= 32:
                self.dropped += 1
                return
            at = _num(msg.get('at'))
            raw_mods = msg.get('mods')
            mods = [m for m in raw_mods if m in MODS] if isinstance(raw_mods, list) else []
            await self.on_key(code, int(at) if at is not None else int(time.time() * 1000), bool(msg.get('rep')), mods, source=ws)
        elif t == 'mind':
            pos = _num(msg.get('pos'))
            if pos is None:
                self.dropped += 1
                return
            out = {'t': 'mind', 'pos': pos}
            for k in ('hr', 'q', 'alpha', 'beta', 'theta'):
                v = _num(msg.get(k))
                if v is not None:
                    out[k] = v
            await self.broadcast(out, exclude=ws)
        elif t == 'headset':
            # Status sambungan headset dan kontak sensor dari sumber EEG. Hanya bidang yang dikenal dan tervalidasi yang diteruskan:
            # halaman ini tampil di layar siaran, jadi teks bebas (mis. pesan galat dengan alamat Bluetooth) tidak boleh ikut.
            state = msg.get('state')
            if state not in HEADSET_STATES:
                self.dropped += 1
                return
            out = {'t': 'headset', 'state': state}
            attempt = _num(msg.get('attempt'))
            if attempt is not None:
                out['attempt'] = max(0, min(9999, int(round(attempt))))
            contact = msg.get('contact')
            if isinstance(contact, list) and len(contact) == 4:
                values = [_num(v) for v in contact]
                if all(v is not None for v in values):
                    out['contact'] = [min(1.0, max(0.0, v)) for v in values]
            await self.broadcast(out, exclude=ws)
        elif t == 'ctl':
            if isinstance(msg.get('pause'), bool):
                await self.set_paused(msg['pause'])
            if msg.get('report') is True:
                await self.broadcast({'t': 'ctl', 'report': True}, exclude=ws)
        else:
            self.dropped += 1

    # --- HTTP ----------------------------------------------------------------
    async def ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(max_msg_size=MAX_MSG, heartbeat=20)
        await ws.prepare(request)
        self.clients.add(ws)
        try:
            await ws.send_str(json.dumps(self.hello()))
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    await self.on_text(ws, msg.data)
        finally:
            self.clients.discard(ws)
        return ws

    async def status(self, _request: web.Request) -> web.Response:
        return web.json_response({
            'listener': self.listener_status,
            'clients': len(self.clients),
            'keys_forwarded': self.keys_forwarded,
            'paused': self.paused,
            'dropped': self.dropped,
        })


@web.middleware
async def guard(request: web.Request, handler):
    host = request.headers.get('Host', '')
    name = host.rsplit(':', 1)[0] if ':' in host else host
    if name not in ALLOWED_HOSTS:
        raise web.HTTPForbidden(text='host tidak diizinkan')
    origin = request.headers.get('Origin')
    if origin is not None and origin != f'http://{host}':
        raise web.HTTPForbidden(text='origin tidak diizinkan')
    return await handler(request)


BRIDGE_KEY = web.AppKey('bridge', Bridge)


def create_app(root: Path = ROOT) -> web.Application:
    bridge = Bridge()
    app = web.Application(middlewares=[guard])
    app[BRIDGE_KEY] = bridge

    async def index(_request: web.Request) -> web.StreamResponse:
        return web.FileResponse(root / 'index.html')

    async def no_store(_request: web.Request, response: web.StreamResponse) -> None:
        response.headers['Cache-Control'] = 'no-store'

    app.on_response_prepare.append(no_store)
    app.router.add_get('/', index)
    app.router.add_get('/ws', bridge.ws_handler)
    app.router.add_get('/status', bridge.status)
    for d in STATIC_DIRS:
        if (root / d).is_dir():
            app.router.add_static(f'/{d}/', root / d, follow_symlinks=False)
    return app


async def serve(port: int, with_listener: bool) -> None:
    app = create_app()
    bridge: Bridge = app[BRIDGE_KEY]
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', port).start()
    print(f'TypeWave bridge: http://127.0.0.1:{port}/  (ws://127.0.0.1:{port}/ws, status: /status)', flush=True)
    listener = None
    if with_listener:
        from .listener import QuartzListener

        loop = asyncio.get_running_loop()
        listener = QuartzListener(
            on_key=lambda ev: asyncio.run_coroutine_threadsafe(bridge.on_key(ev.code, ev.at, ev.rep, ev.mods), loop),
            on_status=lambda s: asyncio.run_coroutine_threadsafe(bridge.set_listener_status(s), loop),
        )
        listener.start()
    try:
        await asyncio.Event().wait()
    finally:
        if listener is not None:
            listener.stop()
        await runner.cleanup()


def main() -> None:
    ap = argparse.ArgumentParser(description='TypeWave bridge')
    ap.add_argument('--port', type=int, default=8770)
    ap.add_argument('--no-listener', action='store_true', help='tanpa listener global (untuk tes, tanpa izin macOS)')
    args = ap.parse_args()
    try:
        asyncio.run(serve(args.port, not args.no_listener))
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
