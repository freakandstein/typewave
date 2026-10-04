#!/usr/bin/env python3
"""Menembakkan tombol sungguhan lewat OS (Quartz CGEventPost) untuk menguji listener -> bridge -> halaman.

PERINGATAN: tombol dikirim ke aplikasi yang sedang FOKUS. Fokuskan jendela target (mis. tab TypeWave) selama
hitung mundur dan jangan menyentuh keyboard/mouse sampai selesai. Butuh izin Accessibility untuk aplikasi yang
menjalankan skrip ini (System Settings > Privacy & Security > Accessibility).
"""
from __future__ import annotations

import argparse
import importlib
import json
import random
import sys
import time

from bridge.keymap import CODE_TO_VK, FLAG_ALT, FLAG_CMD, FLAG_CTRL, FLAG_SHIFT

DEFAULT_CODES = [f'Key{c}' for c in 'ASDFJKLEOIU'] + ['Space']  # tanpa KeyR: di halaman yang fokus R membuka kartu laporan
MOD_FLAGS = {'shift': FLAG_SHIFT, 'ctrl': FLAG_CTRL, 'alt': FLAG_ALT, 'cmd': FLAG_CMD}


def plan_keys(count: int, seed: int, codes: list[str] | None = None, burst_rate: float = 15.0) -> list[tuple[str, float]]:
    """(kode, jeda sebelum tombol berikutnya, detik). Irama acak: 15% burst pada burst_rate/detik, sisanya 0.11 sampai 0.7 s."""
    rng = random.Random(seed)
    pool = codes or DEFAULT_CODES
    out = []
    for _ in range(count):
        r = rng.random()
        if r < 0.15:
            delay = 1 / burst_rate
        elif r < 0.9:
            delay = rng.uniform(0.11, 0.25)
        else:
            delay = rng.uniform(0.3, 0.7)
        out.append((rng.choice(pool), delay))
    return out


def parse_chord(text: str) -> tuple[list[str], str]:
    parts = text.split('+')
    mods, code = parts[:-1], parts[-1]
    if any(m not in MOD_FLAGS for m in mods) or code not in CODE_TO_VK:
        raise ValueError(f'chord tidak valid: {text}')
    return mods, code


def post_key(q, vk: int, down: bool, flags: int = 0) -> None:
    ev = q.CGEventCreateKeyboardEvent(None, vk, down)
    if flags:
        q.CGEventSetFlags(ev, flags)
    q.CGEventPost(q.kCGHIDEventTap, ev)


def type_keys(plan, quartz=None, hold: float = 0.012, sleep=time.sleep) -> int:
    q = quartz or importlib.import_module('Quartz')
    n = 0
    for code, delay in plan:
        vk = CODE_TO_VK[code]
        post_key(q, vk, True)
        sleep(hold)
        post_key(q, vk, False)
        n += 1
        sleep(delay)
    return n


def press_chord(q, mods: list[str], code: str, sleep=time.sleep) -> None:
    flags = 0
    for m in mods:
        flags |= MOD_FLAGS[m]
    vk = CODE_TO_VK[code]
    post_key(q, vk, True, flags)
    sleep(0.03)
    post_key(q, vk, False, flags)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--count', type=int, default=200)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--burst-rate', type=float, default=15.0)
    ap.add_argument('--codes', default=None, help='daftar KeyboardEvent.code dipisah koma')
    ap.add_argument('--chord', default=None, help='mis. ctrl+alt+KeyP (menggantikan pengetikan biasa)')
    ap.add_argument('--countdown', type=int, default=3, help='detik menunggu sebelum mengetik')
    ap.add_argument('--print-plan', action='store_true', help='cetak daftar kode (JSON) lalu keluar tanpa mengetik')
    args = ap.parse_args()

    codes = args.codes.split(',') if args.codes else None
    plan = plan_keys(args.count, args.seed, codes, args.burst_rate)
    if args.print_plan:
        print(json.dumps([c for c, _ in plan]))
        return
    chord = parse_chord(args.chord) if args.chord else None
    for i in range(args.countdown, 0, -1):
        print(f'autotype mulai dalam {i} detik: fokuskan jendela target...', file=sys.stderr, flush=True)
        time.sleep(1)
    q = importlib.import_module('Quartz')
    if chord:
        press_chord(q, *chord)
        print(f'autotype: chord {args.chord} terkirim')
    else:
        print(f'autotype: {type_keys(plan, quartz=q)} tombol terkirim')


if __name__ == '__main__':
    main()
