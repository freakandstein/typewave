import asyncio
import json
import socket
import unittest
from dataclasses import replace

import aiohttp
from aiohttp import web

from bridge.bridge import create_app
from eeg.bridge_link import BridgeLink
from eeg.config import DEFAULT
from test.bridge.test_bridge import make_root

FAST = replace(DEFAULT, bridge_backoff=(0.1, 0.2))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


async def start_bridge(port):
    runner = web.AppRunner(create_app(make_root()), shutdown_timeout=0.2)  # bridge yang mati mendadak menutup soket seketika
    await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', port).start()
    return runner


async def until(cond, timeout=5.0):
    t = asyncio.get_running_loop().time()
    while asyncio.get_running_loop().time() - t < timeout:
        if cond():
            return True
        await asyncio.sleep(0.05)
    return False


class BridgeLinkTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.port = free_port()
        self.url = f'ws://127.0.0.1:{self.port}/ws'
        self.runner = None
        self.tasks = []

    async def asyncTearDown(self):
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.runner is not None:
            await self.runner.cleanup()

    def link(self):
        link = BridgeLink(self.url, FAST, log=lambda m: None)
        self.tasks.append(asyncio.create_task(link.run()))
        return link

    async def receiver(self):
        session = aiohttp.ClientSession()
        ws = await session.ws_connect(self.url)
        await ws.receive(timeout=2)  # hello
        return session, ws

    async def test_send_sebelum_tersambung_dibuang_tanpa_antrean(self):
        link = BridgeLink(self.url, FAST, log=lambda m: None)
        self.assertFalse(await link.send({'t': 'mind', 'pos': 0.5}))
        self.assertFalse(link.connected)

    async def test_tersambung_dan_pesan_sampai_ke_klien_lain(self):
        self.runner = await start_bridge(self.port)
        session, rx = await self.receiver()
        link = self.link()
        self.assertTrue(await until(lambda: link.connected))
        self.assertTrue(await link.send({'t': 'mind', 'pos': 0.5, 'alpha': 0.7}))
        msg = json.loads((await rx.receive(timeout=2)).data)
        self.assertEqual(msg, {'t': 'mind', 'pos': 0.5, 'alpha': 0.7})
        await rx.close()
        await session.close()

    async def test_bridge_belum_menyala_lalu_menyala_tersambung_sendiri(self):
        link = self.link()
        await asyncio.sleep(0.4)
        self.assertFalse(link.connected)
        self.runner = await start_bridge(self.port)
        self.assertTrue(await until(lambda: link.connected), 'harus tersambung sendiri setelah bridge menyala')

    async def test_reconnect_setelah_bridge_mati_dan_pesan_kembali_mengalir(self):
        self.runner = await start_bridge(self.port)
        link = self.link()
        self.assertTrue(await until(lambda: link.connected))
        await self.runner.cleanup()
        self.runner = None
        self.assertTrue(await until(lambda: not link.connected), 'terputus terdeteksi')
        self.assertFalse(await link.send({'t': 'mind', 'pos': 0.1}), 'selama putus, pesan dibuang')
        self.runner = await start_bridge(self.port)
        self.assertTrue(await until(lambda: link.connected, 6.0), 'tersambung ulang otomatis')
        self.assertEqual(link.connects, 2)
        session, rx = await self.receiver()
        self.assertTrue(await link.send({'t': 'mind', 'pos': 0.9}))
        self.assertEqual(json.loads((await rx.receive(timeout=2)).data)['pos'], 0.9)
        await rx.close()
        await session.close()

    async def test_dibatalkan_dengan_bersih(self):
        self.runner = await start_bridge(self.port)
        link = BridgeLink(self.url, FAST, log=lambda m: None)
        task = asyncio.create_task(link.run())
        self.assertTrue(await until(lambda: link.connected))
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertFalse(link.connected)


if __name__ == '__main__':
    unittest.main()
