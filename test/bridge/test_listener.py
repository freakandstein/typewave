import contextlib
import io
import unittest
from unittest.mock import MagicMock

from bridge.decode import KeyEvent
from bridge.listener import QuartzListener, secure_input_enabled


def make_quartz():
    q = MagicMock()
    q.kCGEventTapDisabledByTimeout = 0xFFFFFFFE
    q.kCGEventTapDisabledByUserInput = 0xFFFFFFFF
    return q


class ListenerTest(unittest.TestCase):
    def test_tanpa_izin_status_no_permission_tanpa_crash_dan_instruksi_sekali(self):
        q = make_quartz()
        q.CGEventTapCreate.return_value = None
        statuses, keys = [], []
        lst = QuartzListener(keys.append, statuses.append, quartz=q)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertFalse(lst.attempt())
            self.assertFalse(lst.attempt())
        self.assertEqual(out.getvalue().count('[TypeWave] Izin Input Monitoring'), 1)
        self.assertEqual(statuses, ['no-permission'])
        q.CGRequestListenEventAccess.assert_called_once()

    def test_dengan_izin_tap_dihidupkan_dan_status_ok(self):
        q = make_quartz()
        statuses = []
        lst = QuartzListener(lambda e: None, statuses.append, quartz=q)
        self.assertTrue(lst.attempt())
        q.CGEventTapEnable.assert_called_with(q.CGEventTapCreate.return_value, True)
        self.assertEqual(statuses, ['ok'])
        args = q.CGEventTapCreate.call_args[0]
        self.assertEqual(args[2], q.kCGEventTapOptionListenOnly)

    def test_callback_meneruskan_key_down_dengan_flag_dan_repeat(self):
        q = make_quartz()
        fields = {q.kCGKeyboardEventKeycode: 0x00, q.kCGKeyboardEventAutorepeat: 1}
        q.CGEventGetIntegerValueField.side_effect = lambda ev, f: fields[f]
        q.CGEventGetFlags.return_value = 0x20000  # shift
        keys = []
        lst = QuartzListener(keys.append, lambda s: None, quartz=q)
        event = object()
        self.assertIs(lst._callback(None, 10, event, None), event)
        self.assertEqual(len(keys), 1)
        ev = keys[0]
        self.assertIsInstance(ev, KeyEvent)
        self.assertEqual((ev.code, ev.rep, ev.mods), ('KeyA', True, ['shift']))

    def test_callback_menghidupkan_lagi_tap_yang_dimatikan_sistem(self):
        q = make_quartz()
        lst = QuartzListener(lambda e: None, lambda s: None, quartz=q)
        lst._tap = object()
        event = object()
        self.assertIs(lst._callback(None, 0xFFFFFFFE, event, None), event)
        q.CGEventTapEnable.assert_called_with(lst._tap, True)

    def test_callback_tidak_pernah_melempar(self):
        q = make_quartz()
        q.CGEventGetIntegerValueField.side_effect = RuntimeError('boom')
        lst = QuartzListener(lambda e: None, lambda s: None, quartz=q)
        event = object()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertIs(lst._callback(None, 10, event, None), event)
        self.assertIn('error: boom', out.getvalue())

    def test_secure_input_mengubah_status(self):
        q = make_quartz()
        statuses = []
        lst = QuartzListener(lambda e: None, statuses.append, quartz=q)
        lst.attempt()
        lst._secure_fn = lambda: True
        lst.poll_secure_once()
        lst._secure_fn = lambda: False
        lst.poll_secure_once()
        lst._secure_fn = lambda: None
        lst.poll_secure_once()
        self.assertEqual(statuses, ['ok', 'secure-input', 'ok'])

    def test_secure_input_enabled_tidak_melempar(self):
        self.assertIn(secure_input_enabled(), (True, False, None))


if __name__ == '__main__':
    unittest.main()
