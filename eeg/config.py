"""Konstanta dan pengaturan sumber EEG mandiri (Muse lewat muselsl + LSL)."""
from __future__ import annotations

from dataclasses import dataclass

SAMPLE_RATE = 256  # Hz, EEG Muse 2
PPG_SR = 64  # Hz
CHANNELS = ('TP9', 'AF7', 'AF8', 'TP10')


@dataclass(frozen=True)
class Settings:
    # --- koneksi headset (diadopsi dari brainflow_connector.py project EEG, dengan tiga perbaikan: stall, reset, rescan)
    backoff: tuple = (3.0, 5.0, 10.0, 15.0)  # detik; percobaan ke-n menunggu backoff[min(n-1, len-1)] (3, 5, 10, lalu 15 selamanya)
    lsl_wait_s: float = 25.0  # tunggu stream EEG muncul setelah streamer dijalankan
    stall_s: float = 5.0  # tanpa sampel EEG selama ini = koneksi mati diam-diam (streamer hidup tapi tidak ada data)
    stable_s: float = 30.0  # koneksi yang bertahan selama ini dianggap stabil: hitungan percobaan direset
    rescan_every: int = 3  # pindai BLE ulang setiap n kegagalan beruntun (alamat bisa berubah)
    # --- pemrosesan
    tick_s: float = 0.15  # periode loop DSP (~6,7 Hz)
    window_s: float = 2.0  # jendela EEG untuk PSD
    warmup_s: float = 15.0  # tidak mengirim mind selama warm-up pertama
    stale_s: float = 2.0  # tanpa pembaruan kanal valid selama ini = tidak ada data (halaman jatuh ke "no signal")
    hist_len: int = 120  # riwayat normalisasi (persentil 10..90) per besaran
    ema: float = 0.20  # penghalusan per tick 0,15 s
    pos_tau_s: float = 0.5  # penghalusan spectrum_pos
    threshold_init: float = 0.02
    threshold_every_s: float = 30.0  # ambang adaptif diperbarui tiap ini setelah warm-up
    threshold_window_s: float = 120.0  # median arousal dari jendela ini
    threshold_margin: float = 0.03
    hr_every_s: float = 5.0
    contact_tau_s: float = 1.5  # penghalusan kontak sensor untuk titik di halaman: kedip sesaat tidak mengubah warna
    # --- pengiriman ke bridge
    send_hz: float = 5.0
    bridge_backoff: tuple = (1.0, 2.0, 5.0)


DEFAULT = Settings()
