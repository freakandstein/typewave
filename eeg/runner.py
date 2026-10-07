"""Perakit sumber EEG mandiri: pengawas koneksi headset (reconnect otomatis) + pemrosesan sinyal + pengiriman mind ke bridge.

Alur: Supervisor menyambung ke headset (MuseSession) dan menjalankan loop pemrosesan di thread sendiri; loop itu mengisi MindState;
tugas asyncio mengirim snapshot MindState ke bridge 5 kali per detik lewat BridgeLink (yang juga reconnect otomatis). Selama headset
putus atau masih warm-up tidak ada pesan mind, jadi halaman jatuh ke "no signal" dan pulih sendiri saat data kembali.

Pesan `headset` (status sambungan + kontak tiap sensor) dikirim terpisah dari mind pada kecepatan yang sama, juga saat mind tidak ada: justru
ketika headset baru dipasang (semua sensor buruk, tidak ada mind) halaman perlu tahu penyebabnya. Pesan itu sekaligus detak "sumber EEG hidup".
Teks galat sengaja tidak ikut: bisa memuat alamat Bluetooth, dan halaman ini tampil di layar siaran.
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable

import numpy as np

from . import dsp
from .bridge_link import BridgeLink
from .config import DEFAULT, PPG_SR, SAMPLE_RATE, Settings
from .state import MindState
from .supervisor import Supervisor


class _Ring:
    """Penyangga melingkar: sampel terbaru selalu tersedia tanpa alokasi ulang."""

    def __init__(self, size: int, channels: int = 0) -> None:
        self.size = size
        self.buf = np.zeros((channels, size)) if channels else np.zeros(size)
        self.ptr = 0
        self.total = 0

    def append(self, x) -> None:
        x = np.asarray(x, dtype=float)
        if len(x) == 0:
            return
        if len(x) > self.size:
            x = x[-self.size:]
        idx = (self.ptr + np.arange(len(x))) % self.size
        if self.buf.ndim == 2:
            self.buf[:, idx] = x.T
        else:
            self.buf[idx] = x
        self.ptr = (self.ptr + len(x)) % self.size
        self.total = min(self.size, self.total + len(x))

    def last(self, n: int):
        n = min(n, self.total)
        idx = (self.ptr - n + np.arange(n)) % self.size
        return self.buf[:, idx] if self.buf.ndim == 2 else self.buf[idx]


class Runner:
    def __init__(self, bridge_url: str, open_session: Callable, settings: Settings = DEFAULT, log: Callable = print,
                 clock: Callable = time.monotonic) -> None:
        self.s = settings
        self.log = log
        self.clock = clock
        self.state = MindState(settings)
        self.link = BridgeLink(bridge_url, settings, log)
        self.supervisor = Supervisor(open_session, settings, on_status=self._on_status, log=log, clock=clock)
        self.statuses: list = []
        self.headset: dict = {'state': 'connecting'}  # status sambungan untuk pesan headset (diganti utuh: aman dibaca dari thread lain)

    def stop(self) -> None:
        self.supervisor.cancel()

    def headset_message(self, now: float) -> dict:
        """Status sambungan headset dan, selama tersambung, kualitas tiap sensor (TP9, AF7, AF8, TP10)."""
        msg = {'t': 'headset', **self.headset}
        if msg['state'] == 'connected':
            contact = self.state.contact(now)
            if contact is not None:
                msg['contact'] = contact
        return msg

    def _on_status(self, status: str, info: dict) -> None:
        self.statuses.append((status, info))
        self.headset = {'state': status, 'attempt': int(info.get('attempt', 1))} if status == 'reconnecting' else {'state': status}
        if status == 'connecting':
            self.log('menyambung ke headset...')
        elif status == 'connected':
            self.log('headset tersambung')
        if status != 'connected':
            self.state.lost()  # berhenti mengirim seketika; halaman jatuh ke "no signal" setelah 5 detik

    def _work(self, session, cancel) -> None:
        """Loop pemrosesan selama tersambung. check() melempar StreamLost bila headset putus atau macet; pengawas lalu menyambung ulang."""
        s = self.s
        self.state.lost()  # sambungan baru: buang data lama
        eeg = _Ring(SAMPLE_RATE * 10, 4)
        ppg = _Ring(PPG_SR * 30)
        need = int(SAMPLE_RATE * s.window_s)
        next_hr = self.clock() + s.hr_every_s
        while not cancel.is_set():
            session.check()
            e, p = session.pull()
            eeg.append(e)
            ppg.append(p)
            if eeg.total >= need:
                win = eeg.last(need)
                bands = dsp.band_powers(win, dsp.channel_quality(win))
                self.state.update(bands, self.clock())
            if ppg.total >= PPG_SR * 4 and self.clock() >= next_hr:
                next_hr = self.clock() + s.hr_every_s
                hr = dsp.heart_rate(ppg.last(PPG_SR * 10))
                if hr is not None:
                    self.state.set_heart_rate(hr)
            cancel.wait(s.tick_s)

    async def _send_loop(self) -> None:
        period = 1.0 / self.s.send_hz
        while True:
            now = self.clock()
            msg = self.state.snapshot(now)
            if msg is not None:
                await self.link.send(msg)
            await self.link.send(self.headset_message(now))
            await asyncio.sleep(period)

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        tasks = [asyncio.create_task(self.link.run()), asyncio.create_task(self._send_loop())]
        worker = loop.run_in_executor(None, self.supervisor.run, self._work)
        try:
            await asyncio.shield(worker)
        finally:
            self.supervisor.cancel()
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await asyncio.wait([worker], timeout=15)  # beri waktu thread menutup sesi dan mematikan streamer
