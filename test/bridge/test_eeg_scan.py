import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import bleak

from eeg.scan import DeviceBook, scan_muse_devices
from eeg.supervisor import StreamLost


def tmp_cache():
    return Path(tempfile.mkdtemp()) / 'device.json'


class Scanner:
    def __init__(self, devices):
        self.devices = devices
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return list(self.devices)


class DeviceBookTest(unittest.TestCase):
    def book(self, scan, **kw):
        kw.setdefault('cache_path', tmp_cache())
        return DeviceBook(scan=scan, log=lambda m: None, **kw)

    def test_alamat_eksplisit_dipakai_tanpa_memindai(self):
        scan = Scanner([('Muse-1', 'AA')])
        self.assertEqual(self.book(scan, address='XX').resolve(), 'XX')
        self.assertEqual(self.book(scan, address='XX').resolve(force_scan=True), 'XX')
        self.assertEqual(scan.calls, 0)

    def test_memindai_sekali_lalu_memakai_cache_dan_force_memindai_ulang(self):
        scan = Scanner([('Muse-1', 'AA')])
        b = self.book(scan)
        self.assertEqual(b.resolve(), 'AA')
        self.assertEqual(b.resolve(), 'AA')
        self.assertEqual(scan.calls, 1, 'cache dipakai')
        scan.devices = [('Muse-1', 'BB')]  # alamat berubah (mis. headset diganti atau diatur ulang)
        self.assertEqual(b.resolve(force_scan=True), 'BB')
        self.assertEqual(b.resolve(), 'BB', 'cache diperbarui')
        self.assertEqual(scan.calls, 2)

    def test_cache_bertahan_antar_proses(self):
        path = tmp_cache()
        self.book(Scanner([('Muse-9', 'ZZ')]), cache_path=path).resolve()
        self.assertEqual(json.loads(path.read_text()), {'address': 'ZZ', 'name': 'Muse-9'})
        scan = Scanner([])
        self.assertEqual(self.book(scan, cache_path=path).resolve(), 'ZZ')
        self.assertEqual(scan.calls, 0)

    def test_pilih_menurut_nama_atau_yang_pertama(self):
        devices = [('Muse-A', 'A1'), ('Muse-B', 'B1')]
        self.assertEqual(self.book(Scanner(devices)).resolve(), 'A1')
        self.assertEqual(self.book(Scanner(devices), name='Muse-B').resolve(), 'B1')

    def test_nama_yang_diminta_tidak_ada_melempar_streamlost(self):
        with self.assertRaises(StreamLost) as cm:
            self.book(Scanner([('Muse-A', 'A1')]), name='Muse-Z').resolve()
        self.assertIn('Muse-Z', str(cm.exception))

    def test_tidak_ada_headset_memberi_petunjuk(self):
        with self.assertRaises(StreamLost) as cm:
            self.book(Scanner([])).resolve()
        msg = str(cm.exception)
        self.assertIn('tidak ditemukan', msg)
        self.assertIn('Bluetooth', msg)

    def test_cache_rusak_diabaikan(self):
        path = tmp_cache()
        path.write_text('{bukan json')
        scan = Scanner([('Muse-1', 'AA')])
        self.assertEqual(self.book(scan, cache_path=path).resolve(), 'AA')
        self.assertEqual(scan.calls, 1)

    def test_error_pemindaian_dibungkus_streamlost(self):
        def boom():
            raise OSError('Bluetooth mati')

        with self.assertRaises(StreamLost) as cm:
            self.book(boom).resolve()
        self.assertIn('Bluetooth mati', str(cm.exception))


class ScanTimeoutTest(unittest.TestCase):
    def test_pemindaian_yang_macet_dibatalkan_bukan_menunggu_selamanya(self):
        # bleak menunggu keadaan Bluetooth tanpa batas selama dialog izin tertunda; thread pengawas tidak boleh ikut macet
        async def hang(*args, **kwargs):
            await asyncio.sleep(3600)

        t0 = time.monotonic()
        with mock.patch.object(bleak.BleakScanner, 'discover', staticmethod(hang)):
            with self.assertRaises(TimeoutError):
                scan_muse_devices(timeout=0.1, grace=0.2)
        self.assertLess(time.monotonic() - t0, 3.0)


if __name__ == '__main__':
    unittest.main()
