"""Sumber EEG mandiri TypeWave: membaca headset Muse langsung dan mengirim mind ke bridge. Tidak butuh server EEG project lain.

Reconnect otomatis: bila headset putus (keluar jangkauan, mati, Bluetooth macet) atau bridge belum menyala, sambungan diulang sendiri
dengan jeda 3, 5, 10, lalu 15 detik, tanpa batas, sampai Ctrl+C.

Pemakaian:
  .venv/bin/python -m eeg            pindai headset Muse lewat Bluetooth, sambung, dan kirim ke bridge
  .venv/bin/python -m eeg --scan     tampilkan headset Muse di sekitar lalu keluar
  .venv/bin/python -m eeg --fake     sumber palsu tanpa headset (untuk mencoba tampilan)
  .venv/bin/python -m eeg --fake --fake-degrade AF7:flat@20-40   idem, sensor AF7 kontaknya buruk dari detik 20 sampai 40

Satu instance per --state-dir (kunci eeg/.eeg.lock); instance kedua keluar dengan kode 3.
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import os
import signal
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAKE = ROOT / 'tools' / 'fake_muse_lsl.py'
LSL_QUIET_CONFIG = ROOT / 'eeg' / 'lsl_quiet.cfg'  # [log] level = -3: hanya fatal


def quiet_lsl() -> None:
    """Senyapkan log native liblsl (banner INFO dan "ERR Stream transmission broke off"): sambung ulang yang sebenarnya dicatat pengawas.

    Tidak menimpa konfigurasi LSL milik pengguna (LSLAPICFG, atau lsl_api.cfg di folder kerja, home, dan /etc) karena memuat pengaturan jaringan.
    Harus dipanggil sebelum pylsl dipakai; streamer muselsl mewarisi lingkungan ini.
    """
    if os.environ.get('LSLAPICFG'):
        return
    for path in (Path.cwd() / 'lsl_api.cfg', Path.home() / 'lsl_api' / 'lsl_api.cfg', Path('/etc/lsl_api/lsl_api.cfg')):
        if path.exists():
            return
    os.environ['LSLAPICFG'] = str(LSL_QUIET_CONFIG)


def make_factory(args, settings, log):
    from .scan import DeviceBook
    from .stream import MuseSession, streamer_command

    pidfile = args.state_dir / '.streamer.pid'
    if args.fake:
        address = 'FAKE-MUSE'
        command = [sys.executable, str(FAKE), '--address', address, '--profile', args.fake]
        for spec in args.fake_degrade or []:
            command += ['--degrade', spec]
        return lambda failures, last_error: MuseSession(command, address, settings, log, pidfile=pidfile, marker='fake_muse_lsl')
    book = DeviceBook(args.address, args.name, args.state_dir / '.device.json', log=log)

    def factory(failures, last_error):
        force = failures > 0 and failures % settings.rescan_every == 0  # alamat BLE bisa berubah: pindai ulang tiap beberapa kegagalan
        address = book.resolve(force_scan=force)
        return MuseSession(streamer_command(address, args.python), address, settings, log, pidfile=pidfile)

    return factory


def acquire_instance_lock(state_dir: Path):
    """Satu sumber EEG per state-dir: dua instance akan saling membunuh streamer lewat pidfile dan berebut satu koneksi BLE.

    Mengembalikan (berkas kunci yang harus tetap terbuka, None), atau (None, pid pemilik) bila sudah dipegang. Kunci dilepas kernel saat proses mati, juga SIGKILL."""
    state_dir.mkdir(parents=True, exist_ok=True)
    fh = open(state_dir / '.eeg.lock', 'a+')
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fh.seek(0)
        owner = fh.read().strip()
        fh.close()
        return None, owner
    fh.seek(0)
    fh.truncate()
    fh.write(str(os.getpid()))
    fh.flush()
    return fh, None


async def run(args, log=print) -> None:
    from .config import DEFAULT
    from .runner import Runner

    settings = replace(DEFAULT, warmup_s=args.warmup)
    runner = Runner(args.bridge, make_factory(args, settings, log), settings, log)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):  # SIGHUP: jendela Terminal ditutup
        loop.add_signal_handler(sig, runner.stop)
    log('sumber EEG mandiri berjalan (Ctrl+C untuk berhenti)')
    await runner.run()
    log('berhenti')


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bridge', default='ws://127.0.0.1:8770/ws', help='WebSocket bridge TypeWave')
    ap.add_argument('--address', help='alamat BLE headset (default: dipindai otomatis lalu disimpan)')
    ap.add_argument('--name', help='nama headset bila ada beberapa, mis. Muse-1A2B')
    ap.add_argument('--python', help='interpreter untuk streamer muselsl (default: Python ini)')
    ap.add_argument('--fake', nargs='?', const='mixed', choices=['relaxed', 'focused', 'tense', 'mixed'], help='sumber palsu tanpa headset')
    ap.add_argument('--fake-degrade', action='append', default=[], metavar='KANAL:JENIS@MULAI[-AKHIR]',
                    help='dengan --fake: sensor yang kontaknya buruk, mis. AF7:flat@20-40 (boleh diulang; lihat tools/fake_muse_lsl.py)')
    ap.add_argument('--warmup', type=float, default=15.0, help='detik warm-up sebelum mengirim (default 15)')
    ap.add_argument('--scan', action='store_true', help='tampilkan headset Muse di sekitar lalu keluar')
    ap.add_argument('--state-dir', type=Path, default=ROOT / 'eeg', help='folder cache alamat headset (.device.json) dan pidfile streamer (.streamer.pid)')
    args = ap.parse_args(argv)
    if args.fake_degrade and not args.fake:
        ap.error('--fake-degrade hanya berlaku bersama --fake')
    quiet_lsl()
    if args.fake_degrade:
        from tools.fake_muse_lsl import parse_degrade  # setelah quiet_lsl: modul ini memuat pylsl

        try:
            for spec in args.fake_degrade:
                parse_degrade(spec)
        except ValueError as exc:
            print(exc, file=sys.stderr)
            return 2
    if not args.fake:
        try:
            import muselsl  # noqa: F401
        except ImportError:
            print('muselsl belum terpasang: jalankan .venv/bin/pip install -r eeg/requirements.txt', file=sys.stderr)
            return 2
    if args.scan:
        from .scan import scan_muse_devices

        try:
            devices = scan_muse_devices()
        except Exception as exc:
            print(f'pemindaian gagal: {exc} (izin Bluetooth untuk Terminal sudah diberikan?)', file=sys.stderr)
            return 1
        for name, address in devices:
            print(f'{name}\t{address}')
        if not devices:
            print('tidak ada headset Muse ditemukan: menyala, dan Bluetooth aktif?', file=sys.stderr)
        return 0 if devices else 1
    lock, owner = acquire_instance_lock(args.state_dir)
    if lock is None:
        pid = f' (pid {owner})' if owner else ''
        print(f'sumber EEG sudah berjalan{pid} dengan state-dir {args.state_dir}: hentikan yang lama dulu', file=sys.stderr)
        return 3
    try:
        asyncio.run(run(args, lambda m: print(m, flush=True)))
    except KeyboardInterrupt:
        pass
    finally:
        lock.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
