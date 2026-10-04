#!/usr/bin/env python3
"""Mengirim pesan key atau mind palsu ke bridge lewat WebSocket (tanpa izin macOS).

Contoh: .venv/bin/python tools/inject.py --count 200 --rate 15 --seed 1
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import time

import aiohttp

DEFAULT_CODES = 'KeyA,KeyS,KeyD,KeyF,KeyG,KeyH,KeyJ,KeyK,KeyL,Space,Backspace,Enter,ShiftLeft,ArrowLeft'


def delays(count: int, rate: float, seed: int) -> list[float]:
    """Jeda antar pesan: acak seragam antara 1/rate dan 3/rate detik (burst sampai `rate` tombol/detik)."""
    rng = random.Random(seed)
    return [rng.uniform(1 / rate, 3 / rate) for _ in range(count)]


def mind_message(args: argparse.Namespace) -> dict:
    """Pesan mind; level gelombang (alpha, beta, theta) hanya disertakan bila diberikan."""
    msg = {'t': 'mind', 'pos': args.pos, 'hr': args.hr, 'q': args.q}
    for key in ('alpha', 'beta', 'theta'):
        if getattr(args, key, None) is not None:
            msg[key] = getattr(args, key)
    return msg


async def run(args: argparse.Namespace) -> None:
    codes = args.codes.split(',')
    wait = delays(args.count, args.rate, args.seed)
    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(args.url) as ws:
            async def drain() -> None:
                async for _ in ws:
                    pass

            reader = asyncio.create_task(drain())
            for i in range(args.count):
                if args.kind == 'key':
                    msg = {'t': 'key', 'code': codes[i % len(codes)], 'at': int(time.time() * 1000), 'rep': False, 'mods': []}
                else:
                    msg = mind_message(args)
                await ws.send_str(json.dumps(msg))
                await asyncio.sleep(wait[i])
            await asyncio.sleep(0.3)
            reader.cancel()
    print(f'inject: {args.count} pesan {args.kind} terkirim')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default='ws://127.0.0.1:8770/ws')
    ap.add_argument('--count', type=int, default=100)
    ap.add_argument('--rate', type=float, default=10.0, help='laju maksimum pesan/detik')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--kind', choices=['key', 'mind'], default='key')
    ap.add_argument('--codes', default=DEFAULT_CODES, help='daftar KeyboardEvent.code dipisah koma (dipakai berulang)')
    ap.add_argument('--pos', type=float, default=0.5)
    ap.add_argument('--hr', type=float, default=70.0)
    ap.add_argument('--q', type=float, default=1.0)
    for band in ('alpha', 'beta', 'theta'):
        ap.add_argument(f'--{band}', type=float, default=None, help=f'level {band} 0..1 (opsional)')
    asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    main()
