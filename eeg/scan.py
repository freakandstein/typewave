"""Pemindaian BLE untuk menemukan headset Muse, dengan cache alamat terakhir yang berhasil.

scan_muse_devices diport dari brainflow_connector.py project EEG. Tanpa --address, alamat dipakai dari cache dan baru memindai ulang bila
perlu (pertama kali, atau setiap beberapa kegagalan beruntun karena alamat BLE bisa berubah).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

from .supervisor import StreamLost


def scan_muse_devices(timeout: float = 5.0, grace: float = 10.0) -> list:
    """Pindai BLE dan kembalikan [(nama, alamat)] untuk perangkat yang namanya memuat "muse".

    bleak menunggu keadaan Bluetooth tanpa batas selama dialog izin tertunda, jadi seluruh pemindaian dibatasi timeout + grace detik:
    tanpa itu thread pengawas macet dan Ctrl+C ikut menggantung."""
    import asyncio

    from bleak import BleakScanner

    async def _scan():
        try:
            devices = await asyncio.wait_for(BleakScanner.discover(timeout=timeout), timeout + grace)
        except TimeoutError:
            raise TimeoutError(f'pemindaian Bluetooth tidak selesai dalam {timeout + grace:g} detik (izin Bluetooth sudah diberikan?)') from None
        return [(d.name or 'Muse', d.address) for d in devices if d.name and 'muse' in d.name.lower()]

    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_scan())
    finally:
        loop.close()


class DeviceBook:
    def __init__(self, address: Optional[str] = None, name: Optional[str] = None, cache_path=None,
                 scan: Optional[Callable] = None, log: Callable = print) -> None:
        self.address = address
        self.name = name
        self.cache_path = Path(cache_path) if cache_path else None
        self.scan = scan or scan_muse_devices
        self.log = log

    def resolve(self, force_scan: bool = False) -> str:
        """Alamat headset: eksplisit, atau dari cache, atau hasil pindai (yang pertama, atau yang namanya cocok)."""
        if self.address:
            return self.address
        if not force_scan:
            cached = self._load()
            if cached:
                return cached['address']
        self.log('memindai headset Muse lewat Bluetooth...')
        try:
            devices = list(self.scan())
        except Exception as exc:
            raise StreamLost(f'pemindaian Bluetooth gagal: {exc}')
        if self.name:
            devices = [d for d in devices if d[0] == self.name]
            if not devices:
                raise StreamLost(f'headset bernama {self.name} tidak ditemukan')
        if not devices:
            raise StreamLost('headset Muse tidak ditemukan: menyala, Bluetooth aktif, dan Terminal sudah diberi izin Bluetooth?')
        name, address = devices[0]
        self.log(f'headset ditemukan: {name} ({address})')
        self._save({'address': address, 'name': name})
        return address

    def _load(self) -> Optional[dict]:
        if self.cache_path is None:
            return None
        try:
            data = json.loads(self.cache_path.read_text())
            return data if isinstance(data, dict) and data.get('address') else None
        except Exception:
            return None

    def _save(self, data: dict) -> None:
        if self.cache_path is None:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(data))
        except OSError:
            pass
