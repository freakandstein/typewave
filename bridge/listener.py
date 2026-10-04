"""Listener global macOS: tap Quartz listen-only. Hanya membaca keycode, flag auto-repeat, dan flag modifier;
tidak pernah menerjemahkan keycode ke karakter."""
from __future__ import annotations

import ctypes
import ctypes.util
import importlib
import threading
import time

from .decode import KEY_DOWN, decode

INSTRUCTIONS = """
[TypeWave] Izin Input Monitoring belum diberikan, jadi ketikan global belum terbaca.
  1. Buka System Settings > Privacy & Security > Input Monitoring.
  2. Tambahkan dan aktifkan aplikasi yang menjalankan bridge ini (disarankan Terminal.app).
  3. Jalankan ulang bridge. Bridge mencoba lagi tiap 3 detik, tetapi macOS sering baru berlaku setelah restart.
""".strip()


def secure_input_enabled() -> bool | None:
    """True bila macOS secure event input aktif (ketikan tidak terbaca listener). None bila tak bisa dicek."""
    try:
        path = ctypes.util.find_library('Carbon') or '/System/Library/Frameworks/Carbon.framework/Carbon'
        fn = ctypes.CDLL(path).IsSecureEventInputEnabled
        fn.restype = ctypes.c_bool
        return bool(fn())
    except Exception:
        return None


class QuartzListener:
    def __init__(self, on_key, on_status, quartz=None, retry_s: float = 3.0, secure_poll_s: float = 1.0) -> None:
        self.q = quartz
        self.on_key = on_key
        self.on_status = on_status
        self.retry_s = retry_s
        self.secure_poll_s = secure_poll_s
        self._secure_fn = secure_input_enabled
        self._stop = threading.Event()
        self._runloop = None
        self._tap = None
        self._status: str | None = None
        self._warned = False

    # --- status --------------------------------------------------------------
    def _set_status(self, status: str) -> None:
        if status != self._status:
            self._status = status
            self.on_status(status)

    def poll_secure_once(self) -> None:
        if self._status not in ('ok', 'secure-input'):
            return
        enabled = self._secure_fn()
        if enabled is True:
            self._set_status('secure-input')
        elif enabled is False:
            self._set_status('ok')

    # --- tap -----------------------------------------------------------------
    def attempt(self) -> bool:
        """Satu percobaan membuat tap. True bila tap terpasang di run loop thread ini."""
        q = self.q
        mask = q.CGEventMaskBit(q.kCGEventKeyDown) | q.CGEventMaskBit(q.kCGEventFlagsChanged)
        tap = q.CGEventTapCreate(q.kCGSessionEventTap, q.kCGHeadInsertEventTap, q.kCGEventTapOptionListenOnly,
                                 mask, self._callback, None)
        if tap is None:
            self._set_status('no-permission')
            if not self._warned:
                self._warned = True
                request = getattr(q, 'CGRequestListenEventAccess', None)
                if request is not None:
                    request()
                print(INSTRUCTIONS, flush=True)
            return False
        self._tap = tap
        source = q.CFMachPortCreateRunLoopSource(None, tap, 0)
        self._runloop = q.CFRunLoopGetCurrent()
        q.CFRunLoopAddSource(self._runloop, source, q.kCFRunLoopCommonModes)
        q.CGEventTapEnable(tap, True)
        self._set_status('ok')
        return True

    def _callback(self, proxy, etype, event, refcon):
        q = self.q
        try:
            if etype in (q.kCGEventTapDisabledByTimeout, q.kCGEventTapDisabledByUserInput):
                q.CGEventTapEnable(self._tap, True)
                return event
            vk = q.CGEventGetIntegerValueField(event, q.kCGKeyboardEventKeycode)
            flags = q.CGEventGetFlags(event)
            rep = bool(q.CGEventGetIntegerValueField(event, q.kCGKeyboardEventAutorepeat)) if etype == KEY_DOWN else False
            ev = decode(etype, vk, flags, rep, int(time.time() * 1000))
            if ev is not None:
                self.on_key(ev)
        except Exception as exc:  # callback tidak boleh melempar ke Quartz
            print('[listener] error:', exc, flush=True)
        return event

    def _poll_loop(self) -> None:
        while not self._stop.wait(self.secure_poll_s):
            self.poll_secure_once()

    def _run(self) -> None:
        if self.q is None:
            self.q = importlib.import_module('Quartz')
        threading.Thread(target=self._poll_loop, name='typewave-secure-poll', daemon=True).start()
        while not self._stop.is_set():
            if self.attempt():
                self.q.CFRunLoopRun()  # blok sampai stop() memanggil CFRunLoopStop
                if self._stop.is_set():
                    break
            self._stop.wait(self.retry_s)

    def start(self) -> None:
        threading.Thread(target=self._run, name='typewave-listener', daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        if self._runloop is not None and self.q is not None:
            self.q.CFRunLoopStop(self._runloop)
