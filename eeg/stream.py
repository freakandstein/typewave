"""Satu sesi koneksi ke headset Muse: streamer muselsl di proses terpisah (BLE -> LSL), dibaca lewat pylsl.

Diadopsi dari _launch_and_loop di brainflow_connector.py project EEG: BLE dijalankan di subprocess supaya crash atau macet di sisi
Bluetooth tidak menjatuhkan proses utama, stream EEG ditunggu sampai 25 detik, dan matinya subprocess dianggap koneksi putus.
Tambahan: deteksi stall (proses hidup tetapi tidak ada sampel), filter stream menurut alamat (tidak tertukar headset lain), dan
pembersihan streamer yatim lewat pidfile bila sebelumnya TypeWave mati mendadak.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from pylsl import StreamInlet, resolve_byprop

from .config import DEFAULT, Settings
from .supervisor import StreamLost


MUSE_STREAMER = Path(__file__).with_name('muse_streamer.py')


def streamer_command(address: str, python: Optional[str] = None) -> list:
    """Perintah streamer: eeg/muse_streamer.py (muselsl.stream dengan penyesuaian macOS) untuk satu alamat BLE, dengan PPG untuk detak jantung.

    Berkas dijalankan langsung, jadi interpreter dari --python hanya perlu punya muselsl."""
    return [python or sys.executable, str(MUSE_STREAMER), address]


def kill_stale(pidfile, marker: str = 'muse_streamer', log: Callable = print) -> bool:
    """Matikan streamer yatim dari sesi sebelumnya (TypeWave mati mendadak) bila pid di pidfile masih hidup dan perintahnya memuat marker."""
    path = Path(pidfile)
    try:
        pid = int(path.read_text().strip())
    except Exception:
        return False
    killed = False
    try:
        cmdline = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
    except Exception:
        cmdline = ''
    if marker in cmdline:
        try:
            os.killpg(pid, signal.SIGTERM)
        except OSError:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        for _ in range(30):
            try:
                os.kill(pid, 0)
            except OSError:
                break
            time.sleep(0.1)
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        killed = True
        log(f'streamer yatim (pid {pid}) dimatikan')
    try:
        path.unlink()
    except OSError:
        pass
    return killed


class MuseSession:
    def __init__(self, command: list, address: str, settings: Settings = DEFAULT, log: Callable = print,
                 clock: Callable = time.monotonic, pidfile=None, marker: str = 'muse_streamer') -> None:
        self.command = command
        self.address = address
        self.s = settings
        self.log = log
        self.clock = clock
        self.pidfile = Path(pidfile) if pidfile else None
        self.marker = marker
        self.source_id = f'Muse{address}'
        self._proc: Optional[subprocess.Popen] = None
        self._err = None
        self._eeg: Optional[StreamInlet] = None
        self._ppg: Optional[StreamInlet] = None
        self._last_sample = 0.0

    # --- siklus hidup -------------------------------------------------------------------------------------------
    def start(self, cancel: threading.Event) -> None:
        """Jalankan streamer dan tunggu stream EEG muncul (maks. lsl_wait_s). Melempar StreamLost bila gagal atau dibatalkan."""
        if self.pidfile:
            kill_stale(self.pidfile, self.marker, self.log)
        self._err = tempfile.TemporaryFile()  # stdout dan stderr streamer: muselsl mencetak sebab gagal/putus ke stdout ("Failed to connect to Muse.", "Disconnected.")
        self._proc = subprocess.Popen(self.command, stdout=self._err, stderr=subprocess.STDOUT, start_new_session=True,
                                      env={**os.environ, 'PYTHONUNBUFFERED': '1'})
        if self.pidfile:
            try:
                self.pidfile.parent.mkdir(parents=True, exist_ok=True)
                self.pidfile.write_text(str(self._proc.pid))
            except OSError:
                pass
        deadline = self.clock() + self.s.lsl_wait_s
        eeg_info = None
        while eeg_info is None:
            if cancel.is_set():
                raise StreamLost('dibatalkan')
            rc = self._proc.poll()
            if rc is not None:
                raise StreamLost(self._exit_message(rc))
            if self.clock() >= deadline:
                tail = self._output_tail()  # muselsl asli bisa butuh 2 x 30 detik untuk gagal tersambung: batas kita lebih dulu, jadi sebabnya diambil dari keluarannya
                hint = f' Keluaran streamer: {tail}' if tail else ''
                raise StreamLost(f'stream EEG tidak muncul dalam {self.s.lsl_wait_s:g} detik: headset menyala dan tidak sedang dipakai aplikasi lain?{hint}')
            eeg_info = self._find('EEG', 1.0, minimum=1)
        ppg_info = self._find('PPG', 3.0, minimum=2)  # menunggu EEG dan PPG sekaligus; tanpa PPG, tunggu penuh lalu lanjut tanpa HR
        try:
            # open_stream menyambung inlet sekarang; tanpa ini data baru ditampung setelah pull pertama dan sampel awal hilang
            self._eeg = StreamInlet(eeg_info, max_buflen=30, max_chunklen=0)
            self._eeg.open_stream(timeout=5.0)
            if ppg_info is not None:
                self._ppg = StreamInlet(ppg_info, max_buflen=60, max_chunklen=0)
                self._ppg.open_stream(timeout=5.0)
        except Exception as exc:
            raise StreamLost(f'gagal membuka stream LSL: {exc}')
        if ppg_info is None:
            self.log('stream PPG tidak ditemukan: detak jantung dinonaktifkan')
        self._last_sample = self.clock()

    def close(self) -> None:
        for inlet in (self._eeg, self._ppg):
            if inlet is not None:
                try:
                    inlet.close_stream()
                except Exception:
                    pass
        self._eeg = self._ppg = None
        proc = self._proc
        if proc is not None and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except OSError:
                proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except OSError:
                    proc.kill()
                proc.wait(timeout=2)
        if self._err is not None:
            try:
                self._err.close()
            except Exception:
                pass
            self._err = None
        if self.pidfile is not None and proc is not None:
            try:
                if self.pidfile.read_text().strip() == str(proc.pid):  # jangan hapus jejak streamer milik instance lain
                    self.pidfile.unlink()
            except OSError:
                pass

    # --- data ------------------------------------------------------------------------------------------------------
    def pull(self) -> tuple:
        """Sampel baru: EEG (n, 4) untuk TP9, AF7, AF8, TP10 dan PPG inframerah (m,)."""
        eeg = np.empty((0, 4))
        ppg = np.empty(0)
        try:
            chunk, _ = self._eeg.pull_chunk(timeout=0.0, max_samples=512)
            if chunk:
                eeg = np.asarray(chunk, dtype=float)[:, :4]
                self._last_sample = self.clock()
            if self._ppg is not None:
                pchunk, _ = self._ppg.pull_chunk(timeout=0.0, max_samples=256)
                if pchunk:
                    ppg = np.asarray(pchunk, dtype=float)[:, 1]  # [ambient, IR, red]: pakai IR
        except Exception as exc:
            raise StreamLost(f'stream LSL terputus: {exc}')
        return eeg, ppg

    def check(self) -> None:
        """Melempar StreamLost bila proses streamer mati atau tidak ada sampel EEG selama stall_s."""
        rc = self._proc.poll()
        if rc is not None:
            raise StreamLost(self._exit_message(rc))
        idle = self.clock() - self._last_sample
        if idle > self.s.stall_s:
            raise StreamLost(f'tidak ada sampel EEG selama {idle:.0f} detik (headset mati atau keluar jangkauan?)')

    # --- bantu -------------------------------------------------------------------------------------------------------
    def _find(self, stype: str, timeout: float, minimum: int = 1):
        # Dicari lewat source_id alamat ini: pencarian per tipe berhenti di stream pertama yang ditemukan, jadi stream
        # headset lain (mis. server EEG lama yang masih menyala) bisa menutupi stream kita.
        for info in resolve_byprop('source_id', self.source_id, minimum=minimum, timeout=timeout):
            if info.type() == stype:
                return info
        return None

    def _exit_message(self, rc: int) -> str:
        msg = f'streamer berhenti (kode {rc})'
        tail = self._output_tail()
        return f'{msg}: {tail}' if tail else msg

    def _output_tail(self) -> str:
        if self._err is None:
            return ''
        try:
            fd = self._err.fileno()  # pread: tidak menggeser posisi berkas yang dipakai bersama streamer yang masih menulis
            size = os.fstat(fd).st_size
            data = os.pread(fd, 300, max(0, size - 300))
            return data.decode('utf-8', 'replace').strip()
        except Exception:
            return ''
