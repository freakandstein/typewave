import asyncio
import json
import os
import socket
import sys
import time
import unittest
from dataclasses import replace
from pathlib import Path

import aiohttp
from aiohttp import web

from bridge.bridge import create_app
from eeg.config import DEFAULT
from eeg.runner import Runner
from eeg.stream import MuseSession
from test.bridge.test_bridge import make_root

FAKE = str(Path(__file__).resolve().parents[2] / 'tools' / 'fake_muse_lsl.py')
FAST = replace(DEFAULT, warmup_s=1.5, stale_s=1.0, backoff=(0.3,), lsl_wait_s=15.0, stall_s=1.5, stable_s=60.0,
               hr_every_s=2.0, bridge_backoff=(0.1, 0.2))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


async def start_bridge(port):
    runner = web.AppRunner(create_app(make_root()), shutdown_timeout=0.2)  # bridge yang mati mendadak menutup soket seketika
    await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', port).start()
    return runner


class Factory:
    """Pabrik sesi: tiap percobaan memakai daftar argumen streamer palsu berikutnya (yang terakhir diulang)."""

    def __init__(self, address, plans):
        self.address = address
        self.plans = plans
        self.sessions = []

    def __call__(self, failures, last_error):
        extra = self.plans[min(len(self.sessions), len(self.plans) - 1)]
        s = MuseSession([sys.executable, FAKE, '--address', self.address, *extra], self.address, FAST, log=lambda m: None)
        self.sessions.append(s)
        return s


class RunnerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.port = free_port()
        self.url = f'ws://127.0.0.1:{self.port}/ws'
        self.bridge = await start_bridge(self.port)
        self.msgs = []  # (waktu, pesan mind) yang diterima klien lain dari bridge
        self.http = aiohttp.ClientSession()
        self.rx = await self.http.ws_connect(self.url)
        self.rx_task = asyncio.create_task(self._collect())
        self.runner = None
        self.run_task = None

    async def _collect(self):
        async for m in self.rx:
            if m.type == aiohttp.WSMsgType.TEXT:
                d = json.loads(m.data)
                if d.get('t') == 'mind':
                    self.msgs.append((time.monotonic(), d))

    async def asyncTearDown(self):
        if self.runner is not None:
            self.runner.stop()
        if self.run_task is not None:
            await asyncio.wait_for(self.run_task, 15)
        self.rx_task.cancel()
        await asyncio.gather(self.rx_task, return_exceptions=True)
        await self.rx.close()
        await self.http.close()
        await self.bridge.cleanup()

    def start(self, name, plans):
        self.factory = Factory(f'R{os.getpid()}{name}', plans)
        self.runner = Runner(self.url, self.factory, FAST, log=lambda m: None)
        self.run_task = asyncio.create_task(self.runner.run())

    async def until(self, cond, timeout):
        t = time.monotonic()
        while time.monotonic() - t < timeout:
            if cond():
                return True
            await asyncio.sleep(0.05)
        return False

    def statuses(self):
        return [s for s, _ in self.runner.statuses]

    async def test_mind_mengalir_setelah_warmup_dengan_semua_field(self):
        self.start('alir', [[]])
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 15 and any('hr' in m for _, m in self.msgs), 20), f'pesan: {len(self.msgs)}')
        m = self.msgs[-1][1]
        for k in ('pos', 'theta', 'alpha', 'beta', 'q'):
            self.assertTrue(0.0 <= m[k] <= 1.0, (k, m[k]))
        self.assertGreater(m['q'], 0.9, 'sinyal sintetis bersih')
        hrs = [x['hr'] for _, x in self.msgs if 'hr' in x]
        self.assertTrue(all(60 <= h <= 85 for h in hrs), hrs)
        times = [t for t, _ in self.msgs]
        rate = (len(times) - 1) / (times[-1] - times[0])
        self.assertTrue(3.5 < rate < 6.5, f'sekitar 5 pesan per detik, dapat {rate:.1f}')

    async def test_streamer_mati_lalu_tersambung_ulang_otomatis_dan_pesan_kembali(self):
        # pesan baru mengalir ~3,5 detik setelah streamer jalan (jendela 2 detik + warm-up 1,5 detik): 8 detik menjamin
        # kelima pesan pertama berasal dari streamer pertama, jadi memang ada aliran yang terputus
        self.start('putus', [['--exit-after', '8.0'], []])
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 5, 20))
        self.assertTrue(await self.until(lambda: 'reconnecting' in self.statuses(), 20), 'putus harus terdeteksi')
        n_at_drop = len(self.msgs)
        self.assertTrue(await self.until(lambda: self.statuses().count('connected') >= 2, 20), 'harus tersambung ulang sendiri')
        self.assertTrue(await self.until(lambda: len(self.msgs) >= n_at_drop + 8, 15), 'pesan mind harus mengalir lagi')
        gap = max(b[0] - a[0] for a, b in zip(self.msgs, self.msgs[1:]))
        self.assertGreater(gap, 1.0, 'selama putus tidak ada pesan (halaman jatuh ke no signal), bukan data basi')
        self.assertEqual(len(self.factory.sessions), 2)
        self.assertIsNotNone(self.factory.sessions[0]._proc.poll(), 'streamer lama sudah mati, tidak ada yatim')

    async def test_stall_diam_diam_memicu_sambung_ulang_dan_streamer_macet_dimatikan(self):
        self.start('macet', [['--stall-after', '3.0'], []])
        self.assertTrue(await self.until(lambda: 'reconnecting' in self.statuses(), 20), 'stall harus terdeteksi')
        info = [i for s, i in self.runner.statuses if s == 'reconnecting'][0]
        self.assertIn('tidak ada sampel', info['error'])
        self.assertTrue(await self.until(lambda: self.statuses().count('connected') >= 2, 20))
        self.assertIsNotNone(self.factory.sessions[0]._proc.poll(), 'streamer yang macet harus dimatikan walau prosesnya masih hidup')

    async def test_gagal_mulai_berulang_lalu_berhasil(self):
        self.start('gagal', [['--fail-start'], ['--fail-start'], []])
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 3, 30), f'status: {self.statuses()}')
        self.assertEqual(self.statuses().count('reconnecting'), 2)
        self.assertEqual(len(self.factory.sessions), 3)

    async def test_bridge_mati_dan_hidup_lagi_pesan_tetap_mengalir_tanpa_warmup_ulang(self):
        self.start('bridge', [[]])
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 5, 20))
        await self.bridge.cleanup()
        self.rx_task.cancel()
        await asyncio.gather(self.rx_task, return_exceptions=True)
        await self.rx.close()
        await asyncio.sleep(1.0)
        self.bridge = await start_bridge(self.port)
        self.rx = await self.http.ws_connect(self.url)
        self.rx_task = asyncio.create_task(self._collect())
        n = len(self.msgs)
        self.assertTrue(await self.until(lambda: len(self.msgs) >= n + 3, 10), 'pesan kembali mengalir setelah bridge hidup lagi')
        self.assertEqual(self.statuses().count('connected'), 1, 'koneksi headset tidak terganggu oleh bridge yang mati')

    async def test_berhenti_bersih_mematikan_streamer(self):
        self.start('henti', [[]])
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 3, 20))
        proc = self.factory.sessions[0]._proc
        self.runner.stop()
        await asyncio.wait_for(self.run_task, 15)
        self.run_task = None
        self.assertIsNotNone(proc.poll(), 'streamer harus mati saat berhenti')
        self.assertEqual(self.statuses()[-1], 'stopped')

    async def test_run_dibatalkan_dari_luar_tetap_mematikan_streamer(self):
        self.start('batal', [[]])
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 3, 20))
        proc = self.factory.sessions[0]._proc
        t0 = time.monotonic()
        self.run_task.cancel()  # bukan stop(): mis. tugas induk dibatalkan atau asyncio.run keluar karena error
        await asyncio.gather(self.run_task, return_exceptions=True)
        self.run_task = None
        self.assertLess(time.monotonic() - t0, 10.0, 'tidak boleh menunggu thread pemroses sampai batas 15 detik')
        self.assertIsNotNone(proc.poll(), 'streamer tidak boleh jadi yatim')
        self.assertEqual(self.statuses()[-1], 'stopped')


if __name__ == '__main__':
    unittest.main()
