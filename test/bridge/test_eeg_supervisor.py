import threading
import time
import unittest
from dataclasses import replace

from eeg.config import DEFAULT
from eeg.supervisor import StreamLost, Supervisor


class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class FakeSession:
    def __init__(self, start_error=None):
        self.start_error = start_error
        self.started = False
        self.closed = 0

    def start(self, cancel):
        if self.start_error is not None:
            raise self.start_error
        self.started = True

    def close(self):
        self.closed += 1


class Harness:
    """Supervisor dengan sesi, jam, dan penantian palsu; mencatat semua yang terjadi."""

    def __init__(self, settings=DEFAULT, sessions=None, cancel_wait_at=None):
        self.clock = FakeClock()
        self.sessions = list(sessions or [])
        self.opened = []  # (failures, last_error)
        self.waits = []
        self.statuses = []
        self.logs = []
        self.cancel_wait_at = cancel_wait_at  # nomor penantian (mulai 1) yang dibatalkan
        self.sup = Supervisor(self.open_session, settings, on_status=lambda s, info: self.statuses.append((s, dict(info))),
                              log=self.logs.append, clock=self.clock, wait=self.wait)

    def open_session(self, failures, last_error):
        self.opened.append((failures, last_error))
        return self.sessions.pop(0) if self.sessions else FakeSession()

    def wait(self, seconds, cancel):
        self.waits.append(seconds)
        self.clock.t += seconds
        if self.cancel_wait_at == len(self.waits):
            self.sup.cancel()
        return cancel.is_set()

    @property
    def names(self):
        return [s for s, _ in self.statuses]


class SupervisorTest(unittest.TestCase):
    def test_jalur_normal_connecting_connected_stopped(self):
        h = Harness(sessions=[FakeSession()])
        h.sup.run(lambda session, cancel: None)  # kembali normal = selesai atau dibatalkan
        self.assertEqual(h.names, ['connecting', 'connected', 'stopped'])
        self.assertEqual(h.waits, [])

    def test_gagal_memulai_berulang_memakai_backoff_3_5_10_15_15_lalu_berhasil(self):
        sessions = [FakeSession(StreamLost('tidak ditemukan')) for _ in range(5)] + [FakeSession()]
        h = Harness(sessions=sessions)
        h.sup.run(lambda session, cancel: None)
        self.assertEqual(h.waits, [3.0, 5.0, 10.0, 15.0, 15.0])
        self.assertEqual(h.names[0], 'connecting')
        self.assertEqual(set(h.names[1:6]), {'reconnecting'})
        self.assertEqual(h.names[-2:], ['connected', 'stopped'])
        self.assertEqual(h.statuses[1][1]['retry_in'], 3.0)
        self.assertIn('tidak ditemukan', h.statuses[1][1]['error'])
        self.assertTrue(all(s.closed == 1 for s in sessions), 'tiap sesi ditutup tepat sekali')

    def test_putus_saat_berjalan_sebelum_stabil_meningkatkan_backoff(self):
        h = Harness(sessions=[FakeSession(), FakeSession(), FakeSession(), FakeSession()])
        runs = []

        def work(session, cancel):
            runs.append(session)
            h.clock.t += 5.0  # bertahan hanya 5 detik: belum stabil
            if len(runs) < 4:
                raise StreamLost('putus')

        h.sup.run(work)
        self.assertEqual(h.waits, [3.0, 5.0, 10.0])

    def test_putus_setelah_stabil_mereset_hitungan_ke_backoff_pertama(self):
        stable = DEFAULT.stable_s + 1.0
        sessions = [FakeSession(StreamLost('x')) for _ in range(3)] + [FakeSession(), FakeSession()]
        h = Harness(sessions=sessions)
        runs = []

        def work(session, cancel):
            runs.append(session)
            if len(runs) == 1:
                h.clock.t += stable
                raise StreamLost('putus setelah lama tersambung')

        h.sup.run(work)
        self.assertEqual(h.waits, [3.0, 5.0, 10.0, 3.0], 'setelah sesi stabil putus, tunggu 3 detik lagi, bukan 15')

    def test_pembatalan_saat_menunggu_tidak_mencoba_lagi(self):
        sessions = [FakeSession(StreamLost('x')), FakeSession()]
        h = Harness(sessions=sessions, cancel_wait_at=1)
        h.sup.run(lambda session, cancel: None)
        self.assertEqual(len(h.opened), 1)
        self.assertEqual(h.names[-1], 'stopped')
        self.assertEqual(sessions[0].closed, 1)

    def test_pembatalan_saat_berjalan_menutup_sesi(self):
        s = FakeSession()
        h = Harness(sessions=[s])
        h.sup.run(lambda session, cancel: h.sup.cancel())
        self.assertEqual(s.closed, 1)
        self.assertEqual(h.names[-1], 'stopped')

    def test_error_saat_pembatalan_bukan_koneksi_putus_dan_tidak_dicatat(self):
        h = Harness(sessions=[FakeSession()])

        def work(session, cancel):
            h.sup.cancel()
            raise StreamLost('streamer dimatikan karena berhenti')  # efek samping penutupan, bukan kegagalan

        h.sup.run(work)
        self.assertNotIn('reconnecting', h.names)
        self.assertEqual(h.names[-1], 'stopped')
        self.assertEqual(h.logs, [], 'penutupan normal tidak boleh mencetak "koneksi putus"')

    def test_jenis_error_apa_pun_memicu_reconnect_bukan_hanya_streamlost(self):
        h = Harness(sessions=[FakeSession(), FakeSession()])
        runs = []

        def work(session, cancel):
            runs.append(session)
            if len(runs) == 1:
                raise ValueError('bug di loop pemrosesan')

        h.sup.run(work)
        self.assertEqual(len(runs), 2)
        self.assertEqual(h.waits, [3.0])
        self.assertIn('bug di loop pemrosesan', h.statuses[2][1]['error'])

    def test_close_yang_error_tidak_menghentikan_supervisor(self):
        class Bad(FakeSession):
            def close(self):
                super().close()
                raise RuntimeError('close gagal')

        h = Harness(sessions=[Bad(StreamLost('x')), FakeSession()])
        h.sup.run(lambda session, cancel: None)
        self.assertEqual(h.names[-1], 'stopped')

    def test_callback_status_yang_error_tidak_menghentikan_supervisor(self):
        sup = Supervisor(lambda f, e: FakeSession(), DEFAULT, on_status=lambda s, i: 1 / 0, log=lambda m: None,
                         clock=FakeClock(), wait=lambda s, c: c.is_set())
        sup.run(lambda session, cancel: None)

    def test_pabrik_sesi_menerima_jumlah_kegagalan_beruntun_dan_error_terakhir(self):
        h = Harness(sessions=[FakeSession(StreamLost('a')), FakeSession(StreamLost('b')), FakeSession()])
        h.sup.run(lambda session, cancel: None)
        self.assertEqual([f for f, _ in h.opened], [0, 1, 2])
        self.assertIsNone(h.opened[0][1])
        self.assertIn('a', h.opened[1][1])
        self.assertIn('b', h.opened[2][1])

    def test_log_menyebut_sebab_dan_waktu_tunggu(self):
        h = Harness(sessions=[FakeSession(StreamLost('headset mati')), FakeSession()])
        h.sup.run(lambda session, cancel: None)
        text = '\n'.join(h.logs)
        self.assertIn('headset mati', text)
        self.assertIn('3', text)

    def test_penantian_nyata_bisa_dibatalkan_segera(self):
        slow = replace(DEFAULT, backoff=(30.0,))
        sup = Supervisor(lambda f, e: FakeSession(StreamLost('x')), slow, log=lambda m: None)
        t = threading.Thread(target=sup.run, args=(lambda s, c: None,), daemon=True)
        t0 = time.monotonic()
        t.start()
        time.sleep(0.3)
        sup.cancel()
        t.join(2.0)
        self.assertFalse(t.is_alive(), 'tidak boleh tidur 30 detik penuh')
        self.assertLess(time.monotonic() - t0, 2.0)


if __name__ == '__main__':
    unittest.main()
