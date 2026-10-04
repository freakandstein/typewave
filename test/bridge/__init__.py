import os
from pathlib import Path

# liblsl mencetak banner INFO dan "ERR Stream transmission broke off" tiap streamer palsu dimatikan; di tes itu hanya bising.
# Tes CLI membuang variabel ini dari lingkungan anaknya, supaya perilaku bawaan (tanpa konfigurasi LSL pengguna) tetap teruji.
os.environ.setdefault('LSLAPICFG', str(Path(__file__).resolve().parents[2] / 'eeg' / 'lsl_quiet.cfg'))
