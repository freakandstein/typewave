import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import aiohttp
from aiohttp.test_utils import AioHTTPTestCase

from bridge.bridge import BRIDGE_KEY, create_app


def make_root() -> Path:
    d = Path(tempfile.mkdtemp())
    (d / 'index.html').write_text('<h1>typewave</h1>')
    (d / 'src').mkdir()
    (d / 'src' / 'app.js').write_text('export {}')
    (d / 'bridge').mkdir()
    (d / 'bridge' / 'secret.py').write_text('SECRET')
    return d


class BridgeTest(AioHTTPTestCase):
    async def get_application(self):
        return create_app(make_root())

    @property
    def bridge(self):
        return self.app[BRIDGE_KEY]

    async def ws(self, **kw):
        return await self.client.ws_connect('/ws', **kw)

    async def recv(self, ws, timeout=1.0):
        msg = await ws.receive(timeout=timeout)
        return json.loads(msg.data)

    async def test_hello_dan_status(self):
        ws = await self.ws()
        self.assertEqual(await self.recv(ws), {'t': 'hello', 'keys': False, 'paused': False, 'secure': False})
        body = await (await self.client.get('/status')).json()
        self.assertEqual((body['clients'], body['listener'], body['paused'], body['keys_forwarded']), (1, 'off', False, 0))
        self.assertNotIn('code', json.dumps(body))
        await ws.close()

    async def test_relay_ke_klien_lain_tanpa_echo_dan_dibersihkan(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        await a.send_str(json.dumps({'t': 'key', 'code': 'KeyA', 'at': 1, 'rep': False, 'mods': ['shift', 'bogus']}))
        self.assertEqual(await self.recv(b), {'t': 'key', 'code': 'KeyA', 'at': 1, 'rep': False, 'mods': ['shift']})
        with self.assertRaises(asyncio.TimeoutError):
            await a.receive(timeout=0.2)
        await a.send_str(json.dumps({'t': 'mind', 'pos': 0.4, 'hr': 'abc', 'q': 0.9, 'extra': 1}))
        self.assertEqual(await self.recv(b), {'t': 'mind', 'pos': 0.4, 'q': 0.9})

    async def test_mind_meneruskan_band_numerik_saja(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        await a.send_str(json.dumps({'t': 'mind', 'pos': 0.4, 'alpha': 0.7, 'beta': 'x', 'theta': 0.2, 'gamma': 0.9}))
        self.assertEqual(await self.recv(b), {'t': 'mind', 'pos': 0.4, 'alpha': 0.7, 'theta': 0.2})

    async def test_headset_diteruskan_tanpa_echo_dengan_bidang_tervalidasi_dan_tanpa_teks_galat(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        await a.send_str(json.dumps({'t': 'headset', 'state': 'connected', 'contact': [1, 0.5, 0.25, 0]}))
        self.assertEqual(await self.recv(b), {'t': 'headset', 'state': 'connected', 'contact': [1.0, 0.5, 0.25, 0.0]})
        with self.assertRaises(asyncio.TimeoutError):
            await a.receive(timeout=0.2)
        await a.send_str(json.dumps({'t': 'headset', 'state': 'reconnecting', 'attempt': 2, 'error': 'Failed to connect to AA:BB:CC (rahasia)', 'x': 1}))
        got = await self.recv(b)
        self.assertEqual(got, {'t': 'headset', 'state': 'reconnecting', 'attempt': 2})
        self.assertNotIn('AA:BB', json.dumps(got), 'layar siaran tidak boleh memuat teks galat')

    async def test_headset_kontak_dijepit_dan_yang_salah_dibuang_tanpa_menjatuhkan_status(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        await a.send_str(json.dumps({'t': 'headset', 'state': 'connected', 'contact': [2, -1, 0.5, 1]}))
        self.assertEqual((await self.recv(b))['contact'], [1.0, 0.0, 0.5, 1.0])
        for bad in ([1, 1, 1], [1, 1, 1, 1, 1], [1, 'x', 1, 1], [1, None, 1, 1], 'abcd', 5, {'a': 1}):
            await a.send_str(json.dumps({'t': 'headset', 'state': 'connected', 'contact': bad}))
            self.assertEqual(await self.recv(b), {'t': 'headset', 'state': 'connected'}, bad)
        for bad in (True, 'x', None, [1]):
            await a.send_str(json.dumps({'t': 'headset', 'state': 'reconnecting', 'attempt': bad}))
            self.assertEqual(await self.recv(b), {'t': 'headset', 'state': 'reconnecting'}, f'percobaan {bad!r} dibuang')
        for sent, want in ((-3, 0), (1e12, 9999), (2.6, 3), (4, 4)):
            await a.send_str(json.dumps({'t': 'headset', 'state': 'reconnecting', 'attempt': sent}))
            self.assertEqual((await self.recv(b))['attempt'], want, sent)

    async def test_headset_status_tidak_dikenal_dibuang_dan_dihitung(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        for bad in ['{"t":"headset"}', '{"t":"headset","state":"hacked"}', '{"t":"headset","state":7}', '{"t":"headset","state":null}']:
            await a.send_str(bad)
        await a.send_str(json.dumps({'t': 'key', 'code': 'KeyZ', 'at': 5}))
        self.assertEqual((await self.recv(b))['code'], 'KeyZ', 'tidak ada headset yang lolos sebelum key ini')
        self.assertEqual(self.bridge.dropped, 4)

    async def test_frame_rusak_tidak_menjatuhkan_bridge(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        for bad in ['not json', '{"t":"nope"}', '[1,2]', '{"t":"key"}', '{"t":"key","code":""}',
                    '{"t":"mind","pos":"x"}', '{"t":"key","code":"' + 'x' * 40 + '"}']:
            await a.send_str(bad)
        await a.send_str(json.dumps({'t': 'key', 'code': 'KeyZ', 'at': 5}))
        self.assertEqual((await self.recv(b))['code'], 'KeyZ')
        self.assertEqual(self.bridge.dropped, 7)

    async def test_frame_terlalu_besar_menutup_koneksi_itu_saja(self):
        a, b = await self.ws(), await self.ws()
        await self.recv(a)
        await self.recv(b)
        await a.send_str('x' * 10000)
        msg = await a.receive(timeout=1.0)
        self.assertIn(msg.type, (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED))
        c = await self.ws()
        await self.recv(c)
        await c.send_str(json.dumps({'t': 'key', 'code': 'KeyQ', 'at': 9}))
        self.assertEqual((await self.recv(b))['code'], 'KeyQ')

    async def test_hotkey_pause_dan_klien_yang_terlambat(self):
        a = await self.ws()
        await self.recv(a)
        self.assertEqual(await self.bridge.on_key('KeyP', 1, False, ['ctrl', 'alt']), 'hotkey')
        self.assertEqual(await self.recv(a), {'t': 'ctl', 'pause': True})
        self.assertEqual(await self.bridge.on_key('KeyA', 2, False, []), 'paused')
        with self.assertRaises(asyncio.TimeoutError):
            await a.receive(timeout=0.2)
        late = await self.ws()
        self.assertEqual(await self.recv(late), {'t': 'hello', 'keys': False, 'paused': True, 'secure': False})
        with self.assertRaises(asyncio.TimeoutError):
            await late.receive(timeout=0.2)
        await self.bridge.on_key('KeyP', 3, False, ['ctrl', 'alt'])
        self.assertEqual(await self.recv(a), {'t': 'ctl', 'pause': False})
        self.assertEqual(await self.recv(late), {'t': 'ctl', 'pause': False})
        self.assertEqual(await self.bridge.on_key('KeyA', 4, False, []), 'sent')
        self.assertEqual((await self.recv(a))['code'], 'KeyA')

    async def test_hotkey_laporan_dan_chord_ditahan_tidak_menjadi_key(self):
        a = await self.ws()
        await self.recv(a)
        self.assertEqual(await self.bridge.on_key('KeyR', 1, False, ['ctrl', 'alt', 'shift']), 'hotkey')
        self.assertEqual(await self.recv(a), {'t': 'ctl', 'report': True})
        self.assertEqual(await self.bridge.on_key('KeyR', 2, True, ['ctrl', 'alt']), 'hotkey')
        self.assertEqual(await self.bridge.on_key('KeyP', 3, True, ['ctrl', 'alt']), 'hotkey')
        with self.assertRaises(asyncio.TimeoutError):
            await a.receive(timeout=0.2)
        self.assertEqual((self.bridge.keys_forwarded, self.bridge.paused), (0, False))

    async def test_status_listener_memperbarui_hello_dan_secure(self):
        a = await self.ws()
        await self.recv(a)
        await self.bridge.set_listener_status('ok')
        self.assertEqual(await self.recv(a), {'t': 'hello', 'keys': True, 'paused': False, 'secure': False})
        await self.bridge.set_listener_status('secure-input')
        self.assertEqual(await self.recv(a), {'t': 'ctl', 'secure': True})
        late = await self.ws()
        self.assertEqual(await self.recv(late), {'t': 'hello', 'keys': True, 'paused': False, 'secure': True})
        await self.bridge.set_listener_status('no-permission')
        self.assertEqual(await self.recv(a), {'t': 'hello', 'keys': False, 'paused': False, 'secure': False})
        self.assertEqual(await self.recv(a), {'t': 'ctl', 'secure': False})
        body = await (await self.client.get('/status')).json()
        self.assertEqual(body['listener'], 'no-permission')

    async def test_klien_baru_selalu_menerima_status_pause_terkini(self):
        # Bridge yang di-restart mulai tidak paused; klien yang tersambung ulang harus langsung tahu (bukan mewarisi status basi).
        await self.bridge.set_paused(True)
        c1 = await self.ws()
        self.assertEqual((await self.recv(c1))['paused'], True)
        await self.bridge.set_paused(False)
        c2 = await self.ws()
        self.assertEqual(await self.recv(c2), {'t': 'hello', 'keys': False, 'paused': False, 'secure': False})

    async def test_origin_dan_host_asing_ditolak(self):
        with self.assertRaises(aiohttp.WSServerHandshakeError) as cm:
            await self.client.ws_connect('/ws', headers={'Origin': 'https://evil.example'})
        self.assertEqual(cm.exception.status, 403)
        with self.assertRaises(aiohttp.WSServerHandshakeError) as cm:
            await self.client.ws_connect('/ws', headers={'Host': 'evil.example'})
        self.assertEqual(cm.exception.status, 403)
        self.assertEqual((await self.client.get('/', headers={'Host': 'evil.example'})).status, 403)
        self.assertEqual((await self.client.get('/', headers={'Origin': 'null'})).status, 403)
        ws = await self.client.ws_connect('/ws', headers={'Origin': f'http://127.0.0.1:{self.server.port}'})
        await ws.close()

    async def test_static_hanya_direktori_yang_diizinkan(self):
        r = await self.client.get('/')
        self.assertEqual(r.status, 200)
        self.assertIn('typewave', await r.text())
        r = await self.client.get('/src/app.js')
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers['Cache-Control'], 'no-store')
        for path in ['/bridge/secret.py', '/src/../bridge/secret.py', '/%2e%2e/bridge/secret.py', '/index.html', '/.venv/x']:
            r = await self.client.get(path)
            self.assertIn(r.status, (403, 404), path)


if __name__ == '__main__':
    unittest.main()
