#!/usr/bin/env python3
"""Emulator BLE Muse 2 untuk tes: klien bleak palsu (aturan CoreBluetooth) di bawah muselsl ASLI.

Dijalankan sebagai skrip, di proses sendiri (muselsl memakai event loop global dan LSL):
    python test/bridge/fake_ble.py ADDRESS [--plain] [--lenient] [--ppg-loss P]
Tanpa opsi, yang dijalankan adalah streamer TypeWave (eeg/muse_streamer.py); --plain menjalankan muselsl.stream polos seperti perintah lama.

Yang ditiru:
- bleak CoreBluetooth: start_notify kedua pada karakteristik yang sama melempar ValueError("Characteristic notifications already started")
  (bleak/backends/corebluetooth/PeripheralDelegate.py). --lenient meniru BlueZ/WinRT yang menerima pendaftaran ganda.
- Muse 2: setelah perintah 'd' (resume) ke kanal kontrol, notifikasi EEG (5 kanal, 12 sampel 12-bit per paket, 256 Hz, urutan handle 44, 41, 38, 32, 35)
  dan PPG (3 kanal, 6 sampel 24-bit per paket, 64 Hz, handle 56, 59, 62), dalam format yang didekode muselsl.muse.Muse.
  --ppg-loss P membuang tiap grup paket PPG dengan peluang P (kehilangan paket BLE).
  --subscribe-error PESAN membuat start_notify melempar ValueError(PESAN), kesalahan lain yang tidak boleh ikut diabaikan.
- Handle: muselsl menganggap karakteristik.handle bleak = handle deklarasi (nilai - 1). Itu asumsi muselsl; belum dibuktikan di CoreBluetooth sungguhan.
Sinyal: EEG = irama 10 Hz (20 uV) + 6 Hz (8 uV) di semua kanal; PPG = ambient 1000, IR 20000 + 400 * denyut, merah 18000 + 300 * denyut (72 bpm).
"""
from __future__ import annotations

import argparse
import asyncio
import math
import random
import runpy
import sys
import threading
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STREAMER = ROOT / 'eeg' / 'muse_streamer.py'

EEG_RATE, EEG_CHUNK = 256, 12
PPG_RATE, PPG_CHUNK = 64, 6
BPM = 72.0


class FakeCharacteristic:
    def __init__(self, uuid: str, value_handle: int) -> None:
        self.uuid = uuid
        self.handle = value_handle - 1  # handle deklarasi, seperti yang diasumsikan muselsl (menambah 1 lagi di backends.BleakDevice.subscribe)


class FakeBleakClient:
    strict = True
    ppg_loss = 0.0
    seed = 1
    subscribe_error = None

    def __init__(self, address, timeout=10.0, **kwargs) -> None:
        from muselsl import constants as C

        self.address = address
        self._eeg = [(C.MUSE_GATT_ATTR_RIGHTAUX, 44), (C.MUSE_GATT_ATTR_TP10, 41), (C.MUSE_GATT_ATTR_AF8, 38), (C.MUSE_GATT_ATTR_TP9, 32),
                     (C.MUSE_GATT_ATTR_AF7, 35)]  # urutan kedatangan di Muse asli; paket terakhir yang dinanti muselsl adalah handle 35
        self._ppg = [(C.MUSE_GATT_ATTR_PPG1, 56), (C.MUSE_GATT_ATTR_PPG2, 59), (C.MUSE_GATT_ATTR_PPG3, 62)]
        uuids = [u for u, _ in self._eeg] + [u for u, _ in self._ppg] + [C.MUSE_GATT_ATTR_STREAM_TOGGLE, C.MUSE_GATT_ATTR_TELEMETRY,
                                                                         C.MUSE_GATT_ATTR_GYRO, C.MUSE_GATT_ATTR_ACCELEROMETER]
        self.services = [types.SimpleNamespace(characteristics=[types.SimpleNamespace(uuid=u) for u in uuids])]
        self._callbacks: dict = {}
        self._stop = threading.Event()
        self._thread = None

    @property
    def is_connected(self) -> bool:
        return True

    async def connect(self, **kwargs):
        await asyncio.sleep(0.05)
        return True

    async def disconnect(self):
        self._stop.set()

    async def write_gatt_char(self, spec, data, response=None):
        data = bytes(data)
        if len(data) >= 2 and data[1] == ord('d') and self._thread is None:
            self._thread = threading.Thread(target=self._emit, daemon=True)
            self._thread.start()
        elif len(data) >= 2 and data[1] == ord('h'):
            self._stop.set()

    async def start_notify(self, spec, callback, **kwargs):
        uuid = str(spec).lower()
        if self.subscribe_error:
            raise ValueError(self.subscribe_error)
        if self.strict and uuid in self._callbacks:
            raise ValueError('Characteristic notifications already started')
        self._callbacks[uuid] = callback

    # --- emisi data -----------------------------------------------------------------------------------------------------------
    def _emit(self) -> None:
        from muselsl import backends

        loop = backends._get_event_loop()
        rng = random.Random(self.seed)
        t0 = time.monotonic()
        n_eeg = n_ppg = 0
        while not self._stop.is_set():
            now = time.monotonic() - t0
            while n_eeg * EEG_CHUNK / EEG_RATE <= now:
                self._send_eeg(loop, n_eeg)
                n_eeg += 1
            while n_ppg * PPG_CHUNK / PPG_RATE <= now:
                if rng.random() >= self.ppg_loss:
                    self._send_ppg(loop, n_ppg)
                n_ppg += 1  # indeks paket tetap maju saat paket hilang, seperti kehilangan paket BLE yang sebenarnya
            time.sleep(0.004)

    def _deliver(self, loop, uuid: str, handle: int, payload: bytes) -> None:
        cb = self._callbacks.get(uuid)
        if cb is not None:
            loop.call_soon_threadsafe(cb, FakeCharacteristic(uuid, handle), bytearray(payload))

    def _send_eeg(self, loop, group: int) -> None:
        import bitstring

        for uuid, handle in self._eeg:
            samples = []
            for k in range(EEG_CHUNK):
                t = (group * EEG_CHUNK + k) / EEG_RATE
                uv = 20.0 * math.sin(2 * math.pi * 10.0 * t) + 8.0 * math.sin(2 * math.pi * 6.0 * t)
                samples.append(max(0, min(4095, int(round(uv / 0.48828125 + 2048)))))
            payload = bitstring.pack('uint:16' + ',uint:12' * EEG_CHUNK, group & 0xFFFF, *samples).bytes
            self._deliver(loop, uuid, handle, payload)

    def _send_ppg(self, loop, group: int) -> None:
        import bitstring

        for ch, (uuid, handle) in enumerate(self._ppg):
            samples = []
            for k in range(PPG_CHUNK):
                t = (group * PPG_CHUNK + k) / PPG_RATE
                pulse = math.sin(2 * math.pi * BPM / 60.0 * t) + 0.3 * math.sin(2 * math.pi * 2 * BPM / 60.0 * t)
                samples.append(int([1000 + 5 * pulse, 20000 + 400 * pulse, 18000 + 300 * pulse][ch]))
            payload = bitstring.pack('uint:16' + ',uint:24' * PPG_CHUNK, group & 0xFFFF, *samples).bytes
            self._deliver(loop, uuid, handle, payload)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('address')
    ap.add_argument('--plain', action='store_true', help='muselsl.stream polos (perintah streamer lama), bukan streamer TypeWave')
    ap.add_argument('--lenient', action='store_true', help='terima pendaftaran notifikasi ganda (BlueZ/WinRT)')
    ap.add_argument('--ppg-loss', type=float, default=0.0)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--subscribe-error', help='start_notify melempar ValueError(PESAN): kesalahan lain yang tidak boleh diabaikan')
    a = ap.parse_args(argv)

    import bleak

    FakeBleakClient.strict = not a.lenient
    FakeBleakClient.ppg_loss = a.ppg_loss
    FakeBleakClient.seed = a.seed
    FakeBleakClient.subscribe_error = a.subscribe_error
    bleak.BleakClient = FakeBleakClient
    if a.plain:
        from muselsl import stream

        stream(address=a.address, ppg_enabled=True)
    else:
        sys.argv = [str(STREAMER), a.address]
        runpy.run_path(str(STREAMER), run_name='__main__')  # persis jalur produksi: berkas dijalankan langsung oleh interpreter streamer


if __name__ == '__main__':
    main()
