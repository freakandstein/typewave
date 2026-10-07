#!/usr/bin/env python3
"""Menjalankan bridge dan sumber EEG mandiri sekaligus dalam satu perintah.

Tiap proses diawasi: bila mati dijalankan ulang (jeda 1, 2, lalu 5 detik; direset setelah hidup stabil 30 detik), jadi bridge atau sumber
EEG yang crash tidak menghentikan yang lain. Ctrl+C menghentikan semuanya.

Pemakaian: .venv/bin/python -m tools.start [--fake [profil]] [--fake-degrade KANAL:JENIS@MULAI[-AKHIR]] [--no-eeg] [--no-listener] [--port N] [--address A] [--name N] [--python P] [--state-dir D]
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Spec:
    name: str
    command: list
    cwd: Optional[str] = None


class Launcher:
    def __init__(self, specs: list, log: Callable = print, backoff: tuple = (1.0, 2.0, 5.0), stable_s: float = 30.0,
                 clock: Callable = time.monotonic) -> None:
        self.specs = specs
        self.log = log
        self.backoff = backoff
        self.stable_s = stable_s
        self.clock = clock
        self.procs: dict = {}
        self._stop = threading.Event()
        self._done = [threading.Event() for _ in specs]  # spec ke-i selesai dimatikan

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        threads = [threading.Thread(target=self._supervise, args=(i, spec), daemon=True) for i, spec in enumerate(self.specs)]
        for t in threads:
            t.start()
        self._stop.wait()
        for t in threads:
            t.join(10)

    def _pump(self, name: str, proc: subprocess.Popen) -> None:
        try:
            for line in proc.stdout:
                self.log(f'[{name}] {line.rstrip()}')
        finally:
            proc.stdout.close()  # tanpa ini tiap restart meninggalkan satu pipa terbuka sampai GC

    def _terminate(self, proc: subprocess.Popen) -> None:
        if proc.poll() is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except OSError:
            proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                proc.kill()
            proc.wait(timeout=3)

    def _supervise(self, index: int, spec: Spec) -> None:
        try:
            self._supervise_loop(index, spec)
        finally:
            self._done[index].set()

    def _supervise_loop(self, index: int, spec: Spec) -> None:
        failures = 0
        while not self._stop.is_set():
            started = self.clock()
            proc = subprocess.Popen(spec.command, cwd=spec.cwd or str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    bufsize=1, env={**os.environ, 'PYTHONUNBUFFERED': '1'}, start_new_session=True)
            self.procs[spec.name] = proc
            threading.Thread(target=self._pump, args=(spec.name, proc), daemon=True).start()
            while proc.poll() is None and not self._stop.is_set():
                self._stop.wait(0.2)
            if self._stop.is_set():
                if index + 1 < len(self.specs):
                    self._done[index + 1].wait(20)  # yang dijalankan belakangan dimatikan lebih dulu: sumber EEG sebelum bridge, tanpa galat "bridge hilang"
                self._terminate(proc)
                break
            failures = 1 if self.clock() - started >= self.stable_s else failures + 1
            delay = self.backoff[min(failures - 1, len(self.backoff) - 1)]
            self.log(f'[start] {spec.name} berhenti (kode {proc.returncode}); dijalankan ulang dalam {delay:g} detik')
            if self._stop.wait(delay):
                break


def build_specs(args) -> list:
    py = sys.executable
    bridge = [py, '-m', 'bridge.bridge', '--port', str(args.port)] + (['--no-listener'] if args.no_listener else [])
    specs = [Spec('bridge', bridge)]
    if not args.no_eeg:
        eeg = [py, '-m', 'eeg', '--bridge', f'ws://127.0.0.1:{args.port}/ws']
        if args.fake:
            eeg += ['--fake', args.fake]
            for spec in args.fake_degrade or []:
                eeg += ['--fake-degrade', spec]
        for flag, value in (('--address', args.address), ('--name', args.name), ('--python', args.python), ('--state-dir', args.state_dir)):
            if value:
                eeg += [flag, value]
        specs.append(Spec('eeg', eeg))
    return specs


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8770)
    ap.add_argument('--no-listener', action='store_true', help='bridge tanpa listener ketikan global (tanpa izin macOS)')
    ap.add_argument('--no-eeg', action='store_true', help='hanya bridge')
    ap.add_argument('--fake', nargs='?', const='mixed', choices=['relaxed', 'focused', 'tense', 'mixed'], help='sumber EEG palsu tanpa headset')
    ap.add_argument('--fake-degrade', action='append', default=[], metavar='KANAL:JENIS@MULAI[-AKHIR]',
                    help='dengan --fake: sensor yang kontaknya buruk, mis. AF7:flat@20-40 (boleh diulang)')
    ap.add_argument('--address', help='alamat BLE headset (default: dipindai otomatis)')
    ap.add_argument('--name', help='nama headset bila ada beberapa')
    ap.add_argument('--python', help='interpreter untuk streamer muselsl')
    ap.add_argument('--state-dir', help='folder status sumber EEG: cache alamat, pidfile streamer, kunci (default eeg/)')
    args = ap.parse_args()
    launcher = Launcher(build_specs(args))
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):  # SIGHUP: jendela Terminal ditutup; anak-anak di sesi sendiri tidak ikut menerimanya
        signal.signal(sig, lambda *_: launcher.stop())
    print(f'TypeWave: buka http://127.0.0.1:{args.port}/ (Ctrl+C untuk berhenti)', flush=True)
    launcher.run()


if __name__ == '__main__':
    main()
