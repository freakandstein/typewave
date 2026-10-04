#!/usr/bin/env python3
"""Streamer Muse milik TypeWave: muselsl.stream dengan dua penyesuaian yang dibutuhkan di macOS dan pada sesi panjang.

Dijalankan langsung oleh interpreter streamer (python eeg/muse_streamer.py ALAMAT), jadi hanya bergantung pada pustaka standar dan muselsl:
`--python` bisa menunjuk interpreter lain yang punya muselsl tanpa perlu memasang paket eeg.

1. Langganan ganda. muselsl 2.5.0 mendaftarkan kanal kontrol dua kali (connect() lalu stream() memanggil refresh_subscriptions()). BlueZ dan WinRT
   menerimanya, tetapi bleak di CoreBluetooth (macOS) menolak start_notify kedua dengan ValueError("Characteristic notifications already
   started"), sehingga muselsl polos mati di setiap sambungan. Penolakan yang persis itu diabaikan: callback pertama sudah terpasang dan sama.
2. Watchdog muselsl sendiri (AUTO_DISCONNECT_DELAY = 3 detik) membandingkan jam dinding dengan last_timestamp, yang untuk paket PPG dihitung dari jam
   nominal 64 Hz tanpa koreksi paket hilang. Tiap paket PPG yang hilang membuat jam itu tertinggal 94 ms, jadi lama-lama muselsl keluar "Disconnected."
   padahal EEG sehat. Watchdog itu dimatikan; pengawas TypeWave (eeg/stream.py: tanpa sampel EEG selama stall_s, atau proses mati) menggantikannya.
"""
from __future__ import annotations

import importlib
import os
import signal
import sys
import threading
import time

NO_AUTO_DISCONNECT = 1_000_000_000  # detik; bukan inf, karena muselsl mencetak nilainya dengan "%d" di log debug


def patch_muselsl() -> None:
    from muselsl import backends

    # muselsl.stream tertutup oleh fungsi bernama sama di paketnya: modulnya diambil lewat importlib
    importlib.import_module('muselsl.stream').AUTO_DISCONNECT_DELAY = NO_AUTO_DISCONNECT

    original = backends.BleakDevice.subscribe

    def subscribe(self, uuid, *args, **kwargs):
        try:
            return original(self, uuid, *args, **kwargs)
        except ValueError as exc:
            if 'already started' not in str(exc):
                raise

    backends.BleakDevice.subscribe = subscribe


def exit_when_orphaned(parent_pid: int, poll_s: float = 1.0, grace_s: float = 5.0) -> None:
    """Keluar sendiri bila proses induk (eeg) mati keras, supaya streamer tidak jadi yatim yang menahan koneksi BLE dan terus memancar.

    Pertama SIGINT, jalur Ctrl+C milik muselsl yang memutus BLE dengan rapi; bila macet lebih dari grace_s detik, keluar paksa."""
    def watch() -> None:
        while os.getppid() == parent_pid:
            time.sleep(poll_s)
        os.kill(os.getpid(), signal.SIGINT)
        time.sleep(grace_s)
        os._exit(0)

    threading.Thread(target=watch, daemon=True).start()


def main(argv=None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print('pemakaian: muse_streamer.py ALAMAT', file=sys.stderr)
        raise SystemExit(2)
    exit_when_orphaned(os.getppid())
    patch_muselsl()
    from muselsl import stream

    stream(address=argv[0], ppg_enabled=True)


if __name__ == '__main__':
    main()
