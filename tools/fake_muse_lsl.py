#!/usr/bin/env python3
"""Streamer Muse palsu: menerbitkan stream LSL seperti muselsl (EEG 5 kanal 256 Hz dan PPG 3 kanal 64 Hz, source_id "Muse<alamat>")
tanpa headset, untuk tes dan demo. Isi EEG-nya sintetis dengan latar mirip EEG (spektrum 1/f) dan irama theta/alpha/beta.

Pemakaian: .venv/bin/python tools/fake_muse_lsl.py [--address ADDR] [--profile relaxed|focused|tense|mixed]
Mode gangguan untuk menguji reconnect: --exit-after S (keluar normal, seperti auto-disconnect muselsl), --crash-after S (keluar dengan
error), --stall-after S (tetap hidup tetapi berhenti mengirim data), --start-delay S (lambat tersambung), --fail-start (gagal tersambung:
mencetak ke stdout dan keluar dengan kode 0, persis muselsl asli).
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

import numpy as np
from pylsl import StreamInfo, StreamOutlet

EEG_RATE = 256
PPG_RATE = 64
CHUNK = 12  # sampel EEG per paket, seperti Muse
EEG_LABELS = ('TP9', 'AF7', 'AF8', 'TP10', 'Right AUX')
PROFILES = {  # amplitudo (µV) irama theta 6 Hz, alpha 10 Hz, beta 20 Hz
    'relaxed': (12.0, 25.0, 4.0),
    'focused': (6.0, 9.0, 11.0),
    'tense': (4.0, 6.0, 18.0),
}


def build_outlet(stype: str, n_channels: int, rate: int, address: str, labels, unit: str) -> StreamOutlet:
    info = StreamInfo('Muse', stype, n_channels, rate, 'float32', f'Muse{address}')
    info.desc().append_child_value('manufacturer', 'Muse')
    channels = info.desc().append_child('channels')
    for label in labels:
        ch = channels.append_child('channel')
        ch.append_child_value('label', label)
        ch.append_child_value('unit', unit)
        ch.append_child_value('type', stype)
    return StreamOutlet(info, CHUNK)


class Synth:
    def __init__(self, profile: str, bpm: float, seed: int = 1) -> None:
        self.profile = profile
        self.bpm = bpm
        rng = np.random.default_rng(seed)
        self.f = 1.3 + np.arange(40) * 1.1  # latar: 40 komponen dengan amplitudo ~ f^-0.75 dan fase acak per kanal
        self.a = 9.0 * self.f ** -0.75
        self.ph = rng.uniform(0, 2 * np.pi, (5, 40))
        self.ch_ph = rng.uniform(0, 2 * np.pi, (5, 3))

    def amplitudes(self, t: float):
        if self.profile != 'mixed':
            return PROFILES[self.profile]
        return (8.0 + 6.0 * math.sin(2 * math.pi * t / 53 + 1.0) ** 2 * 2,  # theta
                9.0 + 12.0 * math.sin(2 * math.pi * t / 37) ** 2 * 2,  # alpha
                6.0 + 8.0 * math.sin(2 * math.pi * t / 23 + 2.0) ** 2 * 2)  # beta

    def eeg(self, n0: int, n: int):
        t = (n0 + np.arange(n)) / EEG_RATE
        at, aa, ab = self.amplitudes(n0 / EEG_RATE)
        out = np.empty((n, 5))
        for ch in range(5):
            bg = (self.a[None, :] * np.sin(2 * np.pi * self.f[None, :] * t[:, None] + self.ph[ch][None, :])).sum(axis=1)
            sig = (at * np.sin(2 * np.pi * 6.0 * t + self.ch_ph[ch, 0]) + aa * np.sin(2 * np.pi * 10.0 * t + self.ch_ph[ch, 1])
                   + ab * np.sin(2 * np.pi * 20.0 * t + self.ch_ph[ch, 2]))
            out[:, ch] = bg + sig
        return out

    def ppg(self, n0: int, n: int):
        t = (n0 + np.arange(n)) / PPG_RATE
        hz = self.bpm / 60.0
        pulse = np.sin(2 * np.pi * hz * t) + 0.3 * np.sin(2 * np.pi * 2 * hz * t)
        return np.stack([1000 + 5 * pulse, 20000 + 400 * pulse, 18000 + 300 * pulse], axis=1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--address', default='FAKE-MUSE')
    ap.add_argument('--profile', choices=['relaxed', 'focused', 'tense', 'mixed'], default='mixed')
    ap.add_argument('--bpm', type=float, default=72.0)
    ap.add_argument('--start-delay', type=float, default=0.0)
    ap.add_argument('--exit-after', type=float, default=None)
    ap.add_argument('--crash-after', type=float, default=None)
    ap.add_argument('--stall-after', type=float, default=None)
    ap.add_argument('--fail-start', action='store_true')
    a = ap.parse_args()

    if a.fail_start:
        print('Failed to connect to Muse. (palsu)', flush=True)  # muselsl asli: print ke stdout lalu return, jadi keluar dengan kode 0
        sys.exit(0)
    if a.start_delay:
        time.sleep(a.start_delay)
    eeg = build_outlet('EEG', 5, EEG_RATE, a.address, EEG_LABELS, 'microvolts')
    ppg = build_outlet('PPG', 3, PPG_RATE, a.address, ('ppg1', 'ppg2', 'ppg3'), 'mmHg')
    synth = Synth(a.profile, a.bpm)
    print('Streaming EEG PPG... (palsu)', flush=True)
    t0 = time.monotonic()
    n_eeg = n_ppg = 0
    period = CHUNK / EEG_RATE
    nxt = t0
    while True:
        now = time.monotonic()
        el = now - t0
        if a.exit_after is not None and el >= a.exit_after:
            print('Disconnected. (palsu)', flush=True)
            os._exit(0)  # mati keras seperti proses BLE yang berhenti: teardown LSL bisa menunggu inlet yang masih tersambung
        if a.crash_after is not None and el >= a.crash_after:
            print('fake muse crashed', file=sys.stderr, flush=True)
            os._exit(1)
        if a.stall_after is None or el < a.stall_after:
            eeg.push_chunk(synth.eeg(n_eeg, CHUNK).astype('float32').tolist())
            n_eeg += CHUNK
            want_ppg = int(el * PPG_RATE) + 1
            if want_ppg > n_ppg:
                k = want_ppg - n_ppg
                ppg.push_chunk(synth.ppg(n_ppg, k).astype('float32').tolist())
                n_ppg += k
        nxt += period
        time.sleep(max(0.0, nxt - time.monotonic()))


if __name__ == '__main__':
    main()
