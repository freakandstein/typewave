"""Pemrosesan sinyal EEG dan PPG (diport dari brainflow_connector.py project EEG; fungsi murni, tanpa I/O).

Band: theta 4-8 Hz, alpha 8-13 Hz, beta 13-25 Hz. PSD Welch (nfft 256, overlap 128, jendela Blackman-Harris) lewat BrainFlow DataFilter,
sama seperti aslinya supaya angkanya setara dengan yang dikalibrasi di project EEG.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from brainflow.data_filter import DataFilter, DetrendOperations, FilterTypes, WindowOperations

from .config import PPG_SR, SAMPLE_RATE

AF7, AF8 = 1, 2  # indeks kanal frontal (urutan: TP9, AF7, AF8, TP10)


@dataclass
class Bands:
    alpha: list = field(default_factory=list)  # kekuatan alpha per kanal yang lolos (µV²)
    beta: list = field(default_factory=list)
    theta: list = field(default_factory=list)
    f_alpha: list = field(default_factory=list)  # hanya AF7/AF8, dan hanya bila tidak ada EMG frontal
    f_beta: list = field(default_factory=list)
    f_theta: list = field(default_factory=list)
    frontal_emg: bool = False
    quality: list = field(default_factory=list)  # kualitas kanal (salinan masukan)


def channel_quality(win) -> list:
    """Kualitas 0..1 per kanal dari simpangan baku: datar (< 3) atau liar (> 400) = 0, sangat berisik (> 300) = 0,25."""
    out = []
    for ch in range(4):
        std = float(np.std(win[ch]))
        if std < 3.0 or std > 400.0:
            q = 0.0
        elif std > 300.0:
            q = 0.25
        elif std < 8.0:
            q = std / 8.0 * 0.6
        else:
            q = 1.0
        out.append(round(q, 2))
    return out


def _copy(x) -> np.ndarray:
    return np.ascontiguousarray(x, dtype=np.float64).copy()


def _psd(x):
    return DataFilter.get_psd_welch(x, SAMPLE_RATE, SAMPLE_RATE // 2, SAMPLE_RATE, WindowOperations.BLACKMAN_HARRIS.value)


def _bandpass(x) -> None:
    DataFilter.perform_bandpass(x, SAMPLE_RATE, 0.5, 40.0, 4, FilterTypes.BUTTERWORTH.value, 0)


def band_powers(win, quality) -> Bands:
    q = list(quality)
    out = Bands(quality=q)

    # Pass 1: otot frontal (EMG) memengaruhi beta, jadi dicek dulu di AF7 dan AF8.
    for ch in (AF7, AF8):
        if q[ch] < 0.25:
            continue
        fd = _copy(win[ch])
        DataFilter.detrend(fd, DetrendOperations.CONSTANT.value)
        _bandpass(fd)
        psd = _psd(fd)
        lo = DataFilter.get_band_power(psd, 13.0, 25.0)
        hi = DataFilter.get_band_power(psd, 25.0, 40.0)
        if float(np.ptp(fd)) > 150.0 or hi / (lo + 1e-6) > 0.80:
            out.frontal_emg = True

    # Pass 2: kekuatan band per kanal yang cukup bagus (kualitas marjinal merusak band power).
    for ch in range(4):
        if q[ch] < 0.65:
            continue
        data = _copy(win[ch])
        DataFilter.detrend(data, DetrendOperations.CONSTANT.value)
        raw = _psd(data.copy())
        pln = DataFilter.get_band_power(raw, 48.0, 52.0)
        total = DataFilter.get_band_power(raw, 1.0, 45.0)
        if ch in (AF7, AF8) and pln / (total + 1e-10) > 0.30 and pln > 5.0:
            continue  # listrik 50 Hz mendominasi frontal: lewati, kualitas kanal tetap
        _bandpass(data)
        if float(np.ptp(data)) > 300.0:
            continue  # artefak (kedip, gerakan)
        psd = _psd(data)
        beta = DataFilter.get_band_power(psd, 13.0, 25.0)
        theta = DataFilter.get_band_power(psd, 4.0, 8.0)
        alpha = DataFilter.get_band_power(psd, 8.0, 13.0)
        out.alpha.append(alpha)
        out.theta.append(theta)
        if not out.frontal_emg:
            out.beta.append(beta)
            if ch in (AF7, AF8):
                out.f_alpha.append(alpha)
                out.f_beta.append(beta)
                out.f_theta.append(theta)
    return out


def _find_peaks(signal: np.ndarray, min_distance: int) -> list:
    threshold = float(np.std(signal)) * 0.3
    peaks: list = []
    for i in range(1, len(signal) - 1):
        if signal[i] > signal[i - 1] and signal[i] > signal[i + 1] and signal[i] > threshold:
            if not peaks or (i - peaks[-1]) >= min_distance:
                peaks.append(i)
            elif signal[i] > signal[peaks[-1]]:
                peaks[-1] = i
    return peaks


def heart_rate(ppg, sr: int = PPG_SR) -> Optional[float]:
    """Detak jantung (bpm) dari sinyal PPG: puncak denyut, median selang antar puncak. None bila data kurang atau tidak ada denyut."""
    ppg = np.asarray(ppg, dtype=float)
    if len(ppg) < sr * 4:
        return None
    sig = ppg[-sr * 10:].astype(float)
    sig = sig - np.mean(sig)
    w = max(1, int(sr * 0.08))
    sig = np.convolve(sig, np.ones(w) / w, mode='same')
    peaks = _find_peaks(sig, int(sr * 0.33))
    if len(peaks) < 3:
        return None
    intervals = np.diff(peaks) / float(sr)
    intervals = intervals[(intervals > 0.33) & (intervals < 1.7)]
    if len(intervals) < 2:
        return None
    return float(round(60.0 / float(np.median(intervals))))
