"""Pengawas koneksi headset: loop reconnect tanpa batas dengan backoff, bisa dibatalkan kapan saja.

Diadopsi dari _connect_thread di brainflow_connector.py project EEG: percobaan tanpa batas, backoff 3, 5, 10, lalu 15 detik, status
connecting/connected/reconnecting, dan jeda tunggu yang bisa dibatalkan. Perbaikan atas aslinya: hitungan percobaan direset setelah koneksi
bertahan stable_s (aslinya tidak pernah reset, jadi setelah beberapa kali putus semua jeda menjadi 15 detik), dan jeda tunggu memakai
Event.wait sehingga pembatalan berlaku seketika.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

from .config import DEFAULT, Settings


class StreamLost(Exception):
    """Koneksi headset hilang atau tidak pernah terbentuk."""


class Supervisor:
    def __init__(self, open_session: Callable, settings: Settings = DEFAULT, on_status: Optional[Callable] = None,
                 log: Callable = print, clock: Callable = time.monotonic, wait: Optional[Callable] = None) -> None:
        """open_session(failures, last_error) -> sesi dengan start(cancel) dan close(); wait(detik, cancel) -> True bila dibatalkan."""
        self.open_session = open_session
        self.s = settings
        self.on_status = on_status
        self.log = log
        self.clock = clock
        self.wait = wait or (lambda seconds, cancel: cancel.wait(seconds))
        self._cancel = threading.Event()
        self.status = 'idle'

    def cancel(self) -> None:
        self._cancel.set()

    def _set(self, status: str, **info) -> None:
        self.status = status
        if self.on_status:
            try:
                self.on_status(status, info)
            except Exception:
                pass

    def run(self, work: Callable) -> None:
        """Sambung, jalankan work(sesi, cancel), dan sambung ulang bila gagal atau putus. Kembali hanya saat dibatalkan atau work selesai."""
        s = self.s
        failures = 0
        last_error: Optional[str] = None
        while not self._cancel.is_set():
            if failures == 0 and last_error is None:
                self._set('connecting')
            session = None
            connected_at = None
            delay = 0.0
            try:
                session = self.open_session(failures, last_error)
                session.start(self._cancel)
                connected_at = self.clock()
                self._set('connected')
                work(session, self._cancel)
                break  # kembali normal: selesai atau dibatalkan
            except Exception as exc:  # apa pun penyebabnya (putus, gagal mulai, bug): sambung ulang
                if self._cancel.is_set():
                    break
                last_error = str(exc) or type(exc).__name__
                stable = connected_at is not None and self.clock() - connected_at >= s.stable_s
                failures = 1 if stable else failures + 1
                delay = s.backoff[min(failures - 1, len(s.backoff) - 1)]
                self.log(f'koneksi headset putus: {last_error}; mencoba lagi dalam {delay:g} detik (percobaan {failures})')
                self._set('reconnecting', error=last_error, retry_in=delay, attempt=failures)
            finally:
                if session is not None:
                    try:
                        session.close()
                    except Exception:
                        pass
            if self._cancel.is_set() or self.wait(delay, self._cancel):
                break
        self._set('stopped')
