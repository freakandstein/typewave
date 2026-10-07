"""Status "pikiran": normalisasi per besaran, penghalusan, ambang adaptif, dan spectrum position.
Diport dari brainflow_connector.py (normalisasi, EMA, TBR) dan eeg_engine.py (arousal, ambang adaptif, spectrum position) project EEG.
Perbedaan yang disengaja: waktu dihitung dengan jam nyata (bukan hitungan tick), ambang adaptif pertama diperbarui saat warm-up selesai
(bukan 30 detik kemudian), dan tanpa data valid selama stale_s tidak ada keluaran sama sekali (halaman jatuh ke "no signal").
"""
from __future__ import annotations

import math
import threading
from collections import deque
from statistics import median
from typing import Optional

import numpy as np

from .config import DEFAULT, Settings
from .dsp import Bands


def normalize(hist: list, value: float, maxlen: int) -> float:
    """Nilai 0..1 relatif terhadap riwayat sendiri (persentil 10..90). Riwayat pendek atau datar = netral 0,5."""
    hist.append(value)
    if len(hist) > maxlen:
        del hist[: len(hist) - maxlen]
    if len(hist) < 5:
        return 0.5
    lo = float(np.percentile(hist, 10))
    hi = float(np.percentile(hist, 90))
    if hi <= lo:
        return 0.5
    return float(np.clip((value - lo) / (hi - lo), 0.0, 1.0))


class MindState:
    def __init__(self, settings: Settings = DEFAULT) -> None:
        self.s = settings
        self._lock = threading.Lock()
        self._hist = {k: [] for k in ('alpha', 'beta', 'theta', 'tbr')}
        self._ema_a = self._ema_b = self._ema_t = self._ema_tbr = 0.5
        self._ema_tbr_raw = 1.0
        self._q = 0.0
        self._hr: Optional[float] = None
        self._pos = 0.4
        self.threshold = settings.threshold_init
        self._arousal: deque = deque(maxlen=max(60, int(settings.threshold_window_s / settings.tick_s)))
        self._t_start: Optional[float] = None  # pembaruan valid pertama: warm-up dihitung dari sini
        self._next_thr: Optional[float] = None
        self._last_valid: Optional[float] = None
        self._last_t: Optional[float] = None
        self._contact: Optional[list] = None  # kualitas per kanal (TP9, AF7, AF8, TP10), dihaluskan; terpisah dari mind
        self._contact_t: Optional[float] = None

    def levels(self) -> tuple:
        """(theta, alpha, beta) hasil penghalusan, 0..1."""
        return (self._ema_t, self._ema_a, self._ema_b)

    def set_heart_rate(self, hr: Optional[float]) -> None:
        self._hr = hr

    def lost(self) -> None:
        """Koneksi headset hilang: buang data terkini dan HR. Riwayat normalisasi dan warm-up dipertahankan."""
        with self._lock:
            self._last_valid = None
            self._last_t = None
            self._hr = None
            self._contact = None
            self._contact_t = None

    def _update_contact(self, quality: list, now: float) -> None:
        if len(quality) != 4:
            return
        if self._contact is None:
            self._contact = [float(v) for v in quality]
        else:
            k = 1.0 - math.exp(-max(1e-3, now - self._contact_t) / self.s.contact_tau_s)
            self._contact = [c + (float(v) - c) * k for c, v in zip(self._contact, quality)]
        self._contact_t = now

    def contact(self, now: float) -> Optional[list]:
        """Kualitas 0..1 per kanal untuk titik sensor, atau None bila belum ada atau basi. Tersedia walau mind belum (warm-up, tidak ada kanal valid)."""
        with self._lock:
            if self._contact is None or now - self._contact_t > self.s.stale_s:
                return None
            return [round(c, 2) for c in self._contact]

    def update(self, b: Bands, now: float) -> None:
        with self._lock:
            self._update_contact(b.quality, now)  # sebelum return di bawah: sensor yang buruk semua justru yang paling perlu terlihat
            if not b.alpha:
                return  # tidak ada kanal yang valid: jangan menyegarkan
            s = self.s
            dt = s.tick_s if self._last_t is None else max(1e-3, now - self._last_t)
            k = 1.0 - (1.0 - s.ema) ** (dt / s.tick_s)
            alpha_n = normalize(self._hist['alpha'], float(np.mean(b.alpha)), s.hist_len)
            theta_n = normalize(self._hist['theta'], float(np.mean(b.theta)), s.hist_len)
            if b.f_beta:
                tbr_raw = float(np.mean(b.f_theta)) / (float(np.mean(b.f_beta)) + 1e-6)
            elif b.beta:
                tbr_raw = float(np.mean(b.theta)) / (float(np.mean(b.beta)) + 1e-6)
            else:
                tbr_raw = self._ema_tbr_raw
            tbr_n = normalize(self._hist['tbr'], tbr_raw, s.hist_len)
            self._ema_a += (alpha_n - self._ema_a) * k
            self._ema_t += (theta_n - self._ema_t) * k
            if b.beta:  # beta tidak dipercaya saat ada EMG frontal: biarkan nilai lama
                beta_n = normalize(self._hist['beta'], float(np.mean(b.beta)), s.hist_len)
                self._ema_b += (beta_n - self._ema_b) * k
            self._ema_tbr += (tbr_n - self._ema_tbr) * k
            self._ema_tbr_raw += (tbr_raw - self._ema_tbr_raw) * k
            self._q = float(np.mean(b.quality)) if b.quality else 0.0

            arousal = 0.70 * self._ema_b - 0.10 * self._ema_a - 0.05 * self._ema_tbr
            self._arousal.append((now, arousal))
            if self._t_start is None:
                self._t_start = now
                self._next_thr = now + s.warmup_s
            if now >= self._next_thr and len(self._arousal) >= 60:
                cutoff = now - s.threshold_window_s
                self.threshold = round(median(a for t, a in self._arousal if t >= cutoff) + s.threshold_margin, 4)
                self._next_thr = now + s.threshold_every_s

            raw = min(1.0, max(0.0, ((arousal - self.threshold) / 0.15 + 1.0) / 2.0))
            self._pos += (raw - self._pos) * (1.0 - math.exp(-dt / s.pos_tau_s))
            self._last_valid = now
            self._last_t = now

    def snapshot(self, now: float) -> Optional[dict]:
        """Pesan mind siap kirim, atau None bila masih warm-up, tidak ada data, atau datanya basi."""
        with self._lock:
            if self._last_valid is None or now - self._last_valid > self.s.stale_s:
                return None
            if self._t_start is None or now - self._t_start < self.s.warmup_s:
                return None
            msg = {
                't': 'mind', 'pos': round(self._pos, 3), 'theta': round(self._ema_t, 3), 'alpha': round(self._ema_a, 3),
                'beta': round(self._ema_b, 3), 'q': round(self._q, 2),
            }
            if self._hr is not None:
                msg['hr'] = self._hr
            return msg
