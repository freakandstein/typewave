import asyncio
import json
import unittest

import aiohttp
from aiohttp import web

from adapters import eeg_socketio as adapter
from tools.fake_eeg_server import FakeEEG, default_payload


class ToMindTest(unittest.TestCase):
    def test_pemetaan_field_nyata(self):
        m = adapter.to_mind(default_payload())
        self.assertEqual(m['t'], 'mind')
        self.assertEqual(m['pos'], 0.5)
        self.assertEqual(m['hr'], 71.0)  # heart_rate, bukan bpm (100.0 = tempo drum)
        self.assertAlmostEqual(m['q'], 0.875)

    def test_band_alpha_beta_theta_diteruskan(self):
        p = default_payload()
        p.update(alpha=0.7, beta=0.2, theta=0.55)
        m = adapter.to_mind(p)
        self.assertEqual((m['alpha'], m['beta'], m['theta']), (0.7, 0.2, 0.55))

    def test_band_dijepit_ke_0_1_dan_nilai_ngawur_dibuang(self):
        p = default_payload()
        p.update(alpha=1.8, beta=-0.4, theta=float('nan'))
        m = adapter.to_mind(p)
        self.assertEqual(m['alpha'], 1.0)
        self.assertEqual(m['beta'], 0.0)
        self.assertNotIn('theta', m)
        for bad in (None, 'x', True, float('inf')):
            q = default_payload()
            q['alpha'] = bad
            self.assertNotIn('alpha', adapter.to_mind(q), bad)

    def test_band_dihilangkan_bila_server_tidak_mengirimnya(self):
        p = default_payload()
        for k in ('alpha', 'beta', 'theta'):
            del p[k]
        m = adapter.to_mind(p)
        self.assertTrue(all(k not in m for k in ('alpha', 'beta', 'theta')))

    def test_hr_dihilangkan_bila_none_atau_nol(self):
        for hr in (None, 0, -3):
            p = default_payload()
            p['heart_rate'] = hr
            self.assertNotIn('hr', adapter.to_mind(p))

    def test_q_dihilangkan_bila_channel_quality_tidak_ada(self):
        p = default_payload()
        p['channel_quality'] = None
        self.assertNotIn('q', adapter.to_mind(p))

    def test_tidak_dikirim_saat_noSignal(self):
        for key, value in (('eeg_active', False), ('warming_up', True), ('muse', 'disconnected'), ('muse', 'unavailable'),
                           ('spectrum_pos', None), ('spectrum_pos', '0.5'), ('spectrum_pos', True)):
            p = default_payload()
            p[key] = value
            self.assertIsNone(adapter.to_mind(p), (key, value))
        self.assertIsNone(adapter.to_mind(None))
        self.assertIsNone(adapter.to_mind({}))

    def test_missing_fields(self):
        p = default_payload()
        del p['spectrum_pos']
        del p['muse']
        self.assertEqual(adapter.missing_fields(p), ['spectrum_pos', 'muse'])
        self.assertEqual(adapter.missing_fields(default_payload()), [])


class AdapterFlowTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.received = []

        async def ws_handler(request):
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    self.received.append(json.loads(msg.data))
            return ws

        app = web.Application()
        app.router.add_get('/ws', ws_handler)
        self.bridge = web.AppRunner(app)
        await self.bridge.setup()
        await web.TCPSite(self.bridge, '127.0.0.1', 0).start()
        bridge_port = self.bridge.addresses[0][1]
        self.eeg = FakeEEG(hz=20)
        eeg_port = await self.eeg.start()
        self.logs = []
        self.adapter = adapter.Adapter(f'http://127.0.0.1:{eeg_port}', f'ws://127.0.0.1:{bridge_port}/ws', log=self.logs.append)
        self.task = asyncio.create_task(self.adapter.run())

    async def asyncTearDown(self):
        self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
        try:
            await self.adapter.sio.disconnect()
        except (Exception, asyncio.CancelledError):  # task baca klien ikut dibatalkan bersama task adapter
            pass
        await self.eeg.stop()
        await self.bridge.cleanup()

    async def wait_for(self, pred, timeout=8.0):
        end = asyncio.get_running_loop().time() + timeout
        while not pred():
            if asyncio.get_running_loop().time() > end:
                self.fail('timeout menunggu kondisi')
            await asyncio.sleep(0.02)

    async def test_meneruskan_mind_sekitar_5hz_dengan_field_benar(self):
        await self.wait_for(lambda: len(self.received) >= 5)
        first = self.received[0]
        self.assertEqual((first['t'], first['pos'], first['hr']), ('mind', 0.5, 71.0))
        self.assertAlmostEqual(first['q'], 0.875)
        n0 = len(self.received)
        await asyncio.sleep(1.0)
        rate = len(self.received) - n0
        self.assertTrue(3 <= rate <= 6, f'laju {rate}/detik')

    async def test_berhenti_saat_warming_up_dan_lanjut_setelahnya(self):
        await self.wait_for(lambda: len(self.received) >= 2)
        self.eeg.payload['warming_up'] = True
        await asyncio.sleep(0.5)
        n = len(self.received)
        await asyncio.sleep(0.8)
        self.assertEqual(len(self.received), n)
        self.eeg.payload['warming_up'] = False
        await self.wait_for(lambda: len(self.received) > n)

    async def test_command_mental_memicu_peringatan_dan_dibatasi(self):
        await self.wait_for(lambda: len(self.received) >= 1)
        await self.eeg.emit_command('jaw_clench')
        await self.wait_for(lambda: any('jaw_clench' in line for line in self.logs))
        n = sum('jaw_clench' in line for line in self.logs)
        await self.eeg.emit_command('jaw_clench')
        await asyncio.sleep(0.3)
        self.assertEqual(sum('jaw_clench' in line for line in self.logs), n)

    async def test_run_menutup_sesi_http_klien_saat_dibatalkan(self):
        await self.wait_for(lambda: len(self.received) >= 1)
        self.task.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
        http = self.adapter.sio.eio.http
        self.assertIsNotNone(http)
        self.assertTrue(http.closed, 'sesi HTTP engineio harus ditutup (tidak ada "Unclosed client session")')

    async def test_field_hilang_dicatat_jelas(self):
        del self.eeg.payload['spectrum_pos']
        await self.wait_for(lambda: any('spectrum_pos' in line for line in self.logs))


if __name__ == '__main__':
    unittest.main()
