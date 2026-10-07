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
from eeg.dsp import Bands
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
        self.headset = []  # (waktu, pesan headset): status sambungan dan kontak sensor
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
                elif d.get('t') == 'headset':
                    self.headset.append((time.monotonic(), d))

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

    def with_contact(self):
        return [m for _, m in self.headset if m['state'] == 'connected' and 'contact' in m]

    async def test_status_headset_mengalir_terus_dengan_kontak_semua_sensor_bagus(self):
        self.start('hs', [[]])
        self.assertTrue(await self.until(lambda: len(self.with_contact()) >= 10, 25), f'pesan: {[m for _, m in self.headset][-3:]}')
        m = self.with_contact()[-1]
        self.assertEqual(m['t'], 'headset')
        self.assertEqual(len(m['contact']), 4)
        self.assertTrue(all(0.65 <= c <= 1.0 for c in m['contact']), m)
        times = [t for t, m in self.headset if m['state'] == 'connected']
        rate = (len(times) - 1) / (times[-1] - times[0])
        self.assertTrue(3.5 < rate < 6.5, f'sekitar 5 pesan per detik (sekaligus tanda sumber EEG hidup), dapat {rate:.1f}')

    async def test_putus_dan_tersambung_ulang_terlihat_dengan_nomor_percobaan_tanpa_teks_galat(self):
        self.start('hsputus', [['--exit-after', '8.0'], []])
        self.assertTrue(await self.until(lambda: any(m['state'] == 'reconnecting' for _, m in self.headset), 30), 'putus harus terlihat di halaman')
        first = next(i for i, (_, m) in enumerate(self.headset) if m['state'] == 'reconnecting')
        r = self.headset[first][1]
        self.assertEqual(r['attempt'], 1)
        self.assertEqual(set(r), {'t', 'state', 'attempt'}, 'teks galat (bisa memuat alamat Bluetooth) tidak boleh sampai ke layar siaran')
        self.assertTrue(await self.until(lambda: any(m['state'] == 'connected' and 'contact' in m for _, m in self.headset[first:]), 30),
                        'tersambung ulang: status kembali connected dengan kontak')
        self.assertTrue(all('contact' not in m for _, m in self.headset if m['state'] == 'reconnecting'), 'selama putus tidak ada kontak yang basi')

    async def test_satu_sensor_buruk_terbaca_buruk_dan_mind_tetap_mengalir_dari_sensor_lain(self):
        self.start('hssatu', [['--degrade', 'AF7:flat@0']])
        self.assertTrue(await self.until(lambda: len(self.with_contact()) >= 3, 25))
        c = self.with_contact()[-1]['contact']
        self.assertLess(c[1], 0.25, c)
        self.assertTrue(all(v >= 0.65 for i, v in enumerate(c) if i != 1), c)
        self.assertTrue(await self.until(lambda: len(self.msgs) >= 3, 25), 'tiga sensor lain cukup untuk mind')

    async def test_semua_sensor_buruk_titik_tetap_terkirim_walau_mind_tidak_ada(self):
        flat = [x for ch in ('TP9', 'AF7', 'AF8', 'TP10') for x in ('--degrade', f'{ch}:flat@0')]
        self.start('hssemua', [flat])
        self.assertTrue(await self.until(lambda: len(self.with_contact()) >= 3, 25), 'headset baru dipasang: justru saat ini titik sensor dibutuhkan')
        self.assertTrue(all(v < 0.25 for v in self.with_contact()[-1]['contact']))
        await asyncio.sleep(FAST.warmup_s + 2.0)
        self.assertEqual(self.msgs, [], 'tanpa sensor yang layak tidak ada mind: halaman menampilkan "cek sensor", bukan data palsu')

    async def test_nomor_percobaan_naik_selama_gagal_berulang_lalu_titik_kembali(self):
        self.start('hsgagal', [['--fail-start'], ['--fail-start'], []])
        self.assertTrue(await self.until(lambda: len(self.with_contact()) >= 1, 40), f'status: {self.statuses()}')
        attempts = [m['attempt'] for _, m in self.headset if m['state'] == 'reconnecting']
        self.assertEqual(sorted(set(attempts)), [1, 2], 'gagal dua kali: percobaan 1 lalu 2 terlihat di halaman')
        self.assertEqual(attempts, sorted(attempts), 'nomor tidak pernah turun selama belum tersambung')

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


class HeadsetMessageTest(unittest.TestCase):
    """Pesan headset langsung dari Runner, tanpa bridge: bridge menyaring bidang tak dikenal, jadi kebocoran di runner tidak terlihat dari sisi penerima."""

    def test_pesan_tiap_status_hanya_memuat_bidang_yang_boleh_tampil_di_layar_siaran(self):
        r = Runner('ws://127.0.0.1:1/ws', lambda failures, last_error: None, FAST, log=lambda m: None)
        self.assertEqual(r.headset_message(0.0), {'t': 'headset', 'state': 'connecting'})
        r._on_status('connecting', {})
        r._on_status('connected', {})
        self.assertEqual(r.headset_message(0.0), {'t': 'headset', 'state': 'connected'}, 'belum ada kontak')
        r.state.update(Bands(quality=[1.0, 0.5, 0.2, 0.9]), 1.0)
        self.assertEqual(r.headset_message(1.0), {'t': 'headset', 'state': 'connected', 'contact': [1.0, 0.5, 0.2, 0.9]})
        r._on_status('reconnecting', {'error': 'Failed to connect to AA:BB:CC:DD:EE:FF', 'retry_in': 3.0, 'attempt': 2})
        self.assertEqual(r.headset_message(1.0), {'t': 'headset', 'state': 'reconnecting', 'attempt': 2}, 'tanpa teks galat, tanpa kontak basi')
        r._on_status('stopped', {})
        self.assertEqual(r.headset_message(1.0), {'t': 'headset', 'state': 'stopped'})


if __name__ == '__main__':
    unittest.main()
