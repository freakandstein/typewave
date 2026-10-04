# TypeWave: visualisasi reaktif ketikan + EEG

Design spec untuk development. Proyek mandiri: tidak bergantung pada project EEG yang sudah ada; headset Muse dibaca langsung oleh paket `eeg/` di proyek ini.
Status: draft v0.3, 3 Oktober 2026, direvisi 4 Oktober 2026: siluet keyboard tidak tampil secara default (bagian 4, 6.2, 8.2), ditambah ilustrasi otak dengan tiga kelompok garis untuk level gelombang EEG (bagian 2, 4, 5, 6.4, 8.2, 11), dan sumber EEG dibuat mandiri di dalam proyek dengan sambung ulang otomatis, tanpa server EEG lain (bagian 1, 5, 8, 11, 12, 13, 14); v0.2 tersimpan di `TYPEWAVE_SPEC.v0.2.md`. Nama proyek: TypeWave (typing + brainwave). Di dalam spec ini, elemen visual utamanya tetap disebut "pita" (ribbon).
Dibangun dan diserahkan sebagai satu kesatuan, tanpa fase. Semua bagian di bawah harus ada, dan "selesai" berarti seluruh Definition of Done (bagian 12) terpenuhi.

---

## 1. Tujuan

Membuat satu visualisasi realtime untuk konten typing + ASMR keyboard mechanical. Visual bereaksi ke dua sumber:

1. **Ketikan** dari keyboard (global, termasuk saat mengetik di aplikasi lain).
2. **Kondisi otak** dari EEG (nilai `spectrum_pos` 0..1, level gelombang, dan heart rate), dibaca langsung dari headset Muse oleh sumber EEG mandiri di proyek ini (`eeg/`, bagian 11), atau dari simulator/replay bila tanpa headset.

Output dipakai sebagai OBS Browser Source (stream/rekaman) dan bisa juga tampil di monitor kecil di atas keyboard. OBS hanya menampilkan URL lokal sebagai Browser Source.

### Prinsip utama: setiap ketikan terefleksi

Setiap key-down fisik di keyboard, di aplikasi mana pun, menghasilkan satu reaksi visual di halaman yang dipasang sebagai Browser Source di OBS. Tidak ada tombol yang dibuang di jalur input: modifier, panah, F-key, dan auto-repeat ikut diteruskan. Yang boleh berbeda hanya bentuk reaksinya dan apakah tombol itu masuk statistik (WPM, IKI). Pengecualian: ketikan yang diblok macOS (secure input, bagian 9), hotkey kontrol TypeWave sendiri, dan saat mode pause aktif.

### Non-goals

- Tidak bergantung pada server atau kode project EEG yang lain: headset Muse dibaca langsung oleh paket `eeg/` di proyek ini (bagian 11), termasuk sambung ulang otomatis saat koneksi terputus. Cara kerja akuisisi dan sambung ulang diadopsi dari project EEG lalu ditulis ulang di sini; tidak ada impor dari project itu. Adapter socket.io ke server EEG lama tetap ada sebagai opsi, bukan syarat.
- Tidak ada mental command atau kontrol keyboard dari EEG: sumber EEG hanya membaca dan tidak pernah menembakkan keystroke.
- Tidak ada audio dari visualisasi. Satu-satunya suara adalah keyboard.
- Tidak menampilkan teks yang diketik, dan tidak mencatat teks ke disk.
- Tidak menampilkan merek headset EEG di layar.
- Tidak ada integrasi atau kontrol OBS (tanpa obs-websocket).

---

## 2. Konsep

Satu pita cahaya mengalir melintasi layar.

- **Ketebalan, tinggi gelombang, dan kecepatan pita** mengikuti gaya mengetik (WPM, kerapatan ketikan).
- **Bentuk gelombang dan tekstur tepi pita** mengikuti otak: saat calm gelombangnya panjang dan mulus, makin rapat dan patah saat tense; tepinya halus seperti sutra saat calm dan flow, makin bergerigi saat tense.
- **Seluruh frame ikut berganti suhu warna** (color grade) mengikuti `spectrum_pos`.
- **Ilustrasi otak** di atas tengah (bagian 6.4): garis tipis otak yang ikut warna frame, lipatannya makin gelisah saat tense, dan tiap ketikan menjalarkan satu percikan di sepanjang lipatan. Tiga jenis garis (panjang, sedang, pendek) mewakili gelombang lambat (theta), alpha, dan cepat (beta): terangnya mengikuti level tiap gelombang dari EEG. Ini hiasan, bukan peta aktivitas otak.

Elemen yang harus paling diingat penonton adalah color grade seluruh frame + pita; ilustrasi otak menjadi pendukung kedua dengan garis tipis dan alpha rendah. Semua elemen lain sengaja tenang supaya tidak bersaing dengan suara keyboard. Tidak ada riak neon per tombol, tidak ada bloom global, tidak ada partikel dekoratif (percikan otak bukan dekorasi: tepat satu per ketikan).

---

## 3. Design tokens

### 3.1 Warna

| State | Ground | Ink |
|---|---|---|
| calm | Laut dalam `#0F2B33` | Es `#8ED8D0` |
| flow | Jati `#2D2112` | Madu `#F2B24E` |
| tense | Anggur `#2B0F1E` | Bara `#FF5E72` |
| tanpa sinyal EEG | Batu `#2A2D31` | Kapas `#ECE7DC` |

Kapas `#ECE7DC` juga warna semua teks HUD.

Interpolasi di ruang OKLab (implementasi sendiri, ~30 baris, tanpa dependency). Dengan `p = pos` yang sudah di-smooth:

```
p <= 0.35        : mix(calm, flow,  smoothstep(0.15, 0.35, p))
0.35 < p < 0.65  : flow                         // plateau zona flow
p >= 0.65        : mix(flow, tense, smoothstep(0.65, 0.85, p))
```

Kualitas sinyal `q` (0..1) menskalakan saturasi ink: `sat = lerp(0.5, 1.0, q)`.

Kata state (`calm` / `flow` / `tense`) memakai ambang yang sama dengan project EEG asal pemrosesan sinyalnya (bagian 11): `calm` bila `p < 0.35`, `flow` bila `0.35 <= p <= 0.65`, `tense` bila `p > 0.65`. Kandidat baru harus bertahan 500 ms sebelum kata berganti (hysteresis), supaya label tidak berkedip di sekitar ambang.

Pada `?transparent=1` ground dihilangkan, sehingga color grade tidak tampil; ink dan sumbu huruf tetap berubah.

### 3.2 Tipografi

Satu family: **Anybody** (variable font, lisensi OFL, sumbu `wdth` 50 sampai 150, `wght` 100 sampai 900). File woff2 di-bundle lokal di `assets/fonts/` (beserta `OFL.txt`) supaya aman di OBS tanpa internet.

Sumbu mengikuti state:

```
wdth = lerp(130, 70, pos)     // calm lebar, tense padat
wght = lerp(300, 700, pos)    // calm tipis, tense tebal
```

Aturan teks:

- Semua huruf kecil / sentence case: `calm`, `flow`, `tense`, `74 wpm`.
- Tanpa label kecil di atas konten, tanpa huruf kapital semua, tanpa ornamen.
- Ukuran referensi di canvas 1080 tinggi: state word 96 px, angka WPM 64 px, teks kecil (HR, timer) 28 px. Skala proporsional dengan lebar (wide: lebar / 1920) atau sisi pendek (tall).

Rendering: HUD berupa elemen DOM di atas canvas dan memakai `font-variation-settings`, karena Canvas 2D tidak bisa mengatur sumbu `wdth` secara kontinu. Kartu laporan digambar di canvas dengan sumbu statis (`wdth` 100, `wght` 500) supaya tampilan di layar dan ekspor PNG sama. Render menunggu `document.fonts.ready`.

---

## 4. Layout

Satu scene, dua layout. Dipilih lewat `?layout=wide|tall|auto` (default `wide`; auto = dari rasio viewport: tall bila jendela lebih tinggi daripada lebar). Scene digambar di panggung wide (bawaan 21:9; `?ratio=` 16:9 sampai 3:1, dan 16:9 dengan `?keyboard=1`) atau tall (9:16) yang utuh dan terpusat di jendela (`?fit=contain`, default), jadi komposisinya sama dengan di OBS apa pun bentuk jendelanya; sisa jendela berupa bilah hitam (transparan dengan `?transparent=1`). `?fit=fill` memenuhi jendela dengan geometri diregangkan mengikuti bentuk jendela.

```
wide 21:9 (default, canvas OBS 1920x823)          tall 9:16 (TikTok)
┌────────────────────────────────────────┐        ┌─────────────────┐
│ flow                          68  14:20│        │ flow            │
│ 74 wpm       ╭───────────╮             │        │ 74 wpm          │
│              (    otak   )             │        │       ┃ ╭─────╮ │
│              ╰───────────╯             │        │       ┃ ( otak) │
│                                        │        │       ┃ ╰─────╯ │
│  bead jatuh di kolom tombol            │        │       ┃ pita    │
│  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │        │       ┃ naik    │
│  pita mengalir kiri ke kanan           │        │       ┃         │
└────────────────────────────────────────┘        │       ┃         │
                                                  │ (zona UI TikTok)│
                                                  └─────────────────┘
```

- Rata kiri untuk teks. Pita memenuhi lebar (wide) atau tinggi (tall).
- **Safe zone tall:** sisakan kira-kira 20% bawah, 15% kanan, dan 10% atas bebas dari elemen penting (tertutup UI TikTok). Angka ini perkiraan; verifikasi ulang dengan screenshot dari TikTok LIVE Studio sebelum rilis.
- **Wide:** HUD di pojok atas dan ilustrasi otak (6.4) di atas tengah. Bingkai bawaan 21:9 (tinggi 24% lebih pendek daripada 16:9). Tata letak ringkas (`CONFIG.compact`): skala dari lebar jadi elemen tetap seukuran, bead jatuh dari tepat di bawah otak, dan pita selalu 200 px dari dasar bingkai (cukup untuk simpangan terbesarnya), sehingga tidak ada ruang kosong yang terbuang; otak mengecil sebanding bila bingkai lebih pendek dari 21:9. Pada 16:9 (`?ratio=16:9`) hasilnya sama dengan tata letak lama (pita di 58% tinggi, bead dari 31%). Siluet keyboard (footprint, 6.2) tidak tampil secara default; `?keyboard=1` menyalakannya, mengembalikan bingkai ke 16:9 dan pita ke tengah (50%), dan mengecilkan otak sedikit.
- **Tall:** HUD rata kiri, mulai di bawah zona atas 10% (state word, `NN wpm`, lalu HR dan timer berukuran kecil di bawahnya); kolom kanan 15% tetap kosong. Ilustrasi otak di kanan kolom HUD, di dalam safe zone. Gambar di atas skematis.
- `?transparent=1` menghilangkan ground sehingga bisa ditumpuk di atas feed kamera.

### 4.1 Geometri

Tall adalah scene wide yang diputar: sumbu sepanjang pita jadi vertikal, sumbu silang jadi horizontal. Semua angka ada di `src/config.js`.

| | wide (lebar 1920, bawaan 1920×823) | tall (1080×1920) |
|---|---|---|
| Bentuk bingkai | 21:9; `?ratio=` 16:9 sampai 3:1 (16:9 dengan `?keyboard=1`) | 9:16 |
| Garis tengah pita | y = 200 px dari dasar bingkai, paling bawah 58% tinggi di 16:9 (623 px di 21:9); 50% tinggi dengan `?keyboard=1` | x = 42% lebar |
| Arah aliran | kiri ke kanan (`RIBBON_DIR`) | bawah ke atas |
| Posisi bead sepanjang pita | x = posisi tombol, 10%..90% lebar | y = posisi tombol, dipetakan ke 24%..86% tinggi diukur dari bawah (di luar zona tidak aman) |
| Spawn bead | y = tepat di bawah otak (334,8 px pada skala 1, sama dengan 31% tinggi di 16:9); 25% tinggi dengan `?keyboard=1` | x = 12% lebar |
| Ilustrasi otak | pusat x = 50%, tepi atas 33,6 px; tinggi 300 px pada skala 1, mengecil sebanding bila tinggi bingkai di bawah 823 px (pusat y = 13,5% dan tinggi 245 px dengan `?keyboard=1`) | pusat x = 64% lebar, y = 19% tinggi; tinggi 280 px; di dalam safe zone dan di kanan kolom HUD |
| Footprint (hanya dengan `?keyboard=1`) | lebar 80% (10%..90%), di sepertiga bawah | lebar 76% (6%..82%), tinggi ±17%, tepi bawah di 22% dari bawah (tepat di atas zona tidak aman) |

---

## 5. Input dan kontrak data

Transport: WebSocket ke `ws://127.0.0.1:8770/ws`. Sumber di luar halaman mengirim JSON per baris ke bridge (listener global berjalan di dalam proses bridge; sumber EEG dan tools simulator lewat WebSocket), dan bridge me-relay ke semua klien halaman. Di dalam halaman, semua sumber menulis ke event bus lokal (`core/bus.js`); `ws.js` hanya salah satu sumbernya, jadi halaman tetap berfungsi penuh tanpa bridge (`?ws=off`).

```json
{"t":"hello","keys":true,"paused":false,"secure":false}
{"t":"key","code":"KeyA","at":1759480000123,"rep":false,"mods":["shift"]}
{"t":"mind","pos":0.42,"hr":71,"q":0.9,"theta":0.3,"alpha":0.5,"beta":0.7}
{"t":"ctl","pause":true}
{"t":"ctl","report":true}
{"t":"ctl","secure":true}
```

| Pesan | Field | Catatan |
|---|---|---|
| `hello` | `keys`, `paused`, `secure` (bool) | Snapshot status bridge, dikirim ke klien yang baru tersambung dan setiap kali status listener berubah. Klien menyinkronkan pause dan secure dari sini supaya tidak mewarisi status basi setelah bridge di-restart. `keys` = listener global aktif; bila `true`, `browserkeys.js` dimatikan supaya ketikan tidak terhitung dobel |
| `key` | `code` (nilai `KeyboardEvent.code`), `at` (epoch ms), `rep` (bool, default false), `mods` (modifier yang sedang ditahan: `shift`, `ctrl`, `alt`, `cmd`; default kosong) | Kode fisik saja, tidak pernah karakter. Hanya key-down. Semua tombol diteruskan, termasuk modifier (`ShiftLeft`, `MetaLeft`, dst.), panah, F-key, dan auto-repeat (`rep: true`). Kode yang tak dikenal diteruskan sebagai `Vk<hex>` (mis. `Vk0A`) |
| `mind` | `pos` 0..1 (calm ke tense), `hr` bpm (opsional), `q` 0..1 (opsional, default 1), `theta`, `alpha`, `beta` 0..1 (opsional) | Target 5 Hz. Boleh tidak ada sama sekali. `theta`/`alpha`/`beta` adalah level gelombang relatif terhadap riwayat user sendiri beberapa detik terakhir (sumber EEG sudah menormalisasinya); dijepit ke 0..1, dan tanpa field ini ilustrasi otak memakai level netral 0,5 |
| `ctl` | `pause`, `report`, `secure` | `pause`: jeda aktif atau tidak (saat aktif bridge berhenti meneruskan key). `report`: tampil atau tutup kartu laporan. `secure`: macOS secure input aktif sehingga ketikan tidak terbaca (hanya ditampilkan dengan `?debug=1`) |

Sumber input (semua menghasilkan pesan di atas):

| Sumber | Fungsi |
|---|---|
| listener global (`bridge/listener.py`) | Semua key-down di sistem |
| `eeg/` (`python -m eeg`) | `mind` dari headset Muse yang dibaca langsung, dengan sambung ulang otomatis (bagian 11.1) |
| `adapters/eeg_socketio.py` | `mind` dari server EEG lama; opsional (bagian 11.2) |
| `ws.js` | Menerima pesan dari bridge ke dalam halaman |
| `browserkeys.js` | `keydown` di halaman (`rep` dari `event.repeat`), untuk pengembangan. Aktif hanya bila `sim=1` dan bridge tidak melaporkan listener global |
| `sim.js` | Panel dengan slider `pos`/`hr`/`q` dan level gelombang `theta`/`alpha`/`beta` (default 0,5 = netral), mode auto-wander, dan tombol "ketik otomatis" (menghasilkan `key` palsu). Aktif bila `sim=1`. Menulis `mind` hanya saat slider digerakkan atau auto-wander menyala |
| `replay.js` | `?replay=nama` memutar `replay/nama.json` (key dan mind) dengan timeline asli. Eksklusif: sumber lain dimatikan selama replay |
| `tools/inject.py` | Mengirim `key` palsu ke bridge lewat WebSocket. Menguji bridge sampai halaman, tanpa izin macOS |
| `tools/autotype.py` | Menembakkan tombol sungguhan lewat OS. Menguji listener sampai halaman |

Klien WebSocket reconnect otomatis dengan backoff 1 s, 2 s, 5 s (maksimum 5 s). Sumber EEG (`eeg/bridge_link.py`) memakai backoff yang sama ke bridge dan membuang pesan selama putus (data EEG basi tidak berguna dan tidak boleh menumpuk).

### 5.1 Metrik turunan (`core/metrics.js`)

| Metrik | Definisi |
|---|---|
| Kelas tombol | `karakter`: huruf, angka, simbol, Space (dan angka/operator numpad). `backspace`: `Backspace`. `enter`: `Enter`, `NumpadEnter`. `lain`: semua sisanya (Tab, Esc, modifier, panah, navigasi, F-key, CapsLock, `Vk..`) |
| Tombol yang dihitung | Key-down dengan `rep` false dan tanpa `ctrl`/`cmd` di `mods` (shortcut bukan mengetik). Berlaku untuk IKI, WPM, dan density. `shift` dan `alt` tidak mengecualikan |
| Burst | Rangkaian key `karakter` tanpa jeda lebih dari 3000 ms; awal burst = key `karakter` pertama setelah idle |
| IKI | Selisih waktu antar key `karakter` yang dihitung. IKI > 3000 ms dianggap jeda, tidak masuk statistik |
| WPM | Jumlah key `karakter` yang dihitung dalam jendela / 5 × (60 / jendela detik). Jendela = clamp(waktu sejak awal burst, 3 s, 10 s), supaya WPM tidak terlalu rendah di detik-detik awal; pada jendela penuh 10 detik hasilnya sama dengan karakter / 5 × 6. Backspace tidak dihitung |
| density | Key-down yang dihitung (modifier tidak termasuk) per detik, EMA dengan tau 1.5 s |
| idle | `now - lastKey > 3000 ms`, dengan `lastKey` = key-down apa pun (termasuk auto-repeat dan modifier) |
| noSignal | `now - lastMind > 5000 ms` atau belum pernah ada `mind` |
| pos, wpm, hr (render) | Dihaluskan dengan critically damped spring (omega 5 rad/s). Nilai yang dirender tidak boleh melompat |
| Jam | Semua fungsi metrics menerima `now` sebagai parameter (jam bisa disuntik) supaya bisa dites dan di-replay. `at` pada `key` dipakai sebagai waktu kejadian |

Referensi virtual key macOS (untuk `bridge/keymap.py`, mapping ke `KeyboardEvent.code`): A=0x00, S=0x01, D=0x02, F=0x03, H=0x04, G=0x05, Z=0x06, X=0x07, C=0x08, V=0x09, B=0x0B, Q=0x0C, W=0x0D, E=0x0E, R=0x0F, Y=0x10, T=0x11, 1=0x12, 2=0x13, 3=0x14, 4=0x15, 6=0x16, 5=0x17, Equal=0x18, 9=0x19, 7=0x1A, Minus=0x1B, 8=0x1C, 0=0x1D, RightBracket=0x1E, O=0x1F, U=0x20, LeftBracket=0x21, I=0x22, P=0x23, Return=0x24, L=0x25, J=0x26, Quote=0x27, K=0x28, Semicolon=0x29, Backslash=0x2A, Comma=0x2B, Slash=0x2C, N=0x2D, M=0x2E, Period=0x2F, Tab=0x30, Space=0x31, Grave=0x32, Delete(Backspace)=0x33, Escape=0x35.

Nama macOS di atas dipetakan ke `KeyboardEvent.code`: huruf jadi `KeyX`, angka jadi `DigitN`, Return jadi `Enter`, Delete jadi `Backspace`, Grave jadi `Backquote`, LeftBracket/RightBracket jadi `BracketLeft`/`BracketRight`; sisanya sama (`Minus`, `Equal`, `Quote`, `Semicolon`, `Backslash`, `Comma`, `Slash`, `Period`, `Tab`, `Space`, `Escape`). Tambahan yang juga wajib dipetakan, karena setiap tombol harus terefleksi:

- Modifier: Command kiri/kanan=0x37/0x36 (`MetaLeft`/`MetaRight`), Shift kiri/kanan=0x38/0x3C (`ShiftLeft`/`ShiftRight`), Option kiri/kanan=0x3A/0x3D (`AltLeft`/`AltRight`), Control kiri/kanan=0x3B/0x3E (`ControlLeft`/`ControlRight`), CapsLock=0x39 (`CapsLock`), Fn=0x3F (`Fn`). Modifier terdeteksi dari event `flagsChanged`: key-down bila bit modifier itu menyala.
- F-key: F1..F12 = 0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F; F13..F20 = 0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F, 0x50, 0x5A.
- Panah dan navigasi: Left/Right/Down/Up = 0x7B/0x7C/0x7D/0x7E (`ArrowLeft`/`ArrowRight`/`ArrowDown`/`ArrowUp`), Home=0x73, End=0x77, PageUp=0x74, PageDown=0x79, ForwardDelete=0x75 (`Delete`), Help/Insert=0x72 (`Insert`).
- Numpad (`Numpad0..9`, `NumpadEnter`, dst.), `NumLock`, dan tombol ISO `IntlBackslash` (0x0A) juga dipetakan.
- Kode lain: `Vk<hex>`.

---

## 6. Pemetaan input ke visual

Angka dalam px mengacu ke canvas 1920 lebar (wide) atau 1080 lebar (tall): skala = lebar / 1920 untuk wide ringkas, sisi pendek / 1080 untuk tall (dan wide dengan `?keyboard=1` atau `?fit=fill`); keduanya sama pada 16:9. Tall adalah wide yang diputar, jadi ukuran px sama di kedua layout. Semua angka di bagian 3 dan 6 ada di `src/config.js`.

| Input | Efek | Parameter |
|---|---|---|
| `pos` | Warna ground dan ink | Lihat 3.1 |
| `pos` | Lebar dan berat huruf | Lihat 3.2 |
| `pos` | Kekasaran tepi pita | `r = smoothstep(0.5, 1.0, pos)`; amplitudo noise tepi = `r × 5 px`; r = 0 berarti tepi mulus |
| `pos` | Panjang gelombang dan kehalusan pita | Panjang gelombang `lerp(640, 200, pos)` px dan bobot harmonik 2.3× `lerp(0.15, 0.45, pos)`: tenang = ayunan panjang hampir sinus murni, tegang = lebih rapat dan lebih patah. Titik tengah (0.5) = 420 px dan 0.30. Saat noSignal kembali ke bentuk netral (pos 0.5) |
| `hr` | Ground "bernapas" | Faktor luminansi `1 + 0.03 × sin(phase)`, `phase += 2π × hr/60 × dt` (integrasikan fase, jangan hitung dari waktu absolut, supaya tidak loncat saat hr berubah) |
| `wpm` | Ketebalan pita | `lerp(2, 28, clamp(wpm/120))` px |
| `density` | Amplitudo gelombang pita | `lerp(8, 120, clamp(density/8))` px |
| `density` | Kecepatan scroll pita | `lerp(40, 420, clamp(density/10))` px/detik |
| key karakter | Bead | Lihat 6.1 |
| Backspace | Bead mundur | Bergerak melawan arah scroll dengan 40% kecepatan, ink dikurangi saturasinya, larut 700 ms |
| Space | Batang pendek | 40 × 3 px, memanjang di sepanjang pita selama 400 ms |
| Enter | Garis sapuan | Garis tipis 1 px menyapu seluruh frame searah aliran pita selama 600 ms, alpha 0.35 |
| tombol lain (modifier, panah, F-key, Tab, Esc, `Vk..`) | Bead netral | Radius 3 px, alpha 0.6, tanpa ring pendaratan. Footprint (bila `?keyboard=1`) tetap menyala |
| ketikan (semua kelas) | Percikan otak | Satu percikan bergerak di lipatan otak dan menyalakan lipatan di dekatnya; Enter menyalakan semua lipatan sebentar. Lihat 6.4 |
| auto-repeat (`rep`) | Bead ringan | Radius 3 px, alpha 0.5, maksimum 12 bead per detik; sisanya tidak digambar sendiri (tombol yang ditahan tetap tampak sebagai aliran 12 bead per detik, dan tetap membangunkan pita dari idle). Dengan `?keyboard=1` sisanya menyalakan footprint |
| idle | Pita istirahat | Setelah 3 s, kecepatan dan amplitudo menurun halus ke garis yang "bernapas"; EEG tetap menggerakkan warna dan tepi |
| noSignal | Grade netral | Ground turun ke Batu, teks `no signal` kecil muncul, mode ketikan-saja tetap jalan |
| pause | Indikator | Teks `paused` kecil muncul; key tidak diteruskan bridge, `mind` tetap berjalan |

Shortcut (tombol dengan `ctrl`/`cmd` di `mods`) tetap menghasilkan reaksi sesuai kelas tombolnya, tetapi tidak masuk WPM, IKI, dan density (bagian 5.1).

Pita dirender dari ring buffer: satu sampel `(y, thickness, roughness, color)` per 8 px lebar, sehingga ~240 titik untuk 1920 px. Digambar sebagai strip polygon dengan gradient alpha dari ekor ke kepala.

### 6.1 Bead

- Posisi sepanjang pita (x pada wide, y pada tall) ditentukan posisi tombol pada layout ANSI 75% (`data/layout-ansi75.js`: posisi tengah tombol dalam unit tombol, dinormalisasi ke 10%..90% lebar; untuk tall lihat 4.1). Pada `privacy=zone`, posisi diacak seragam di dalam rentang tangan: tangan kiri 10%..48%, tangan kanan 52%..90%, Space 40%..60%. Kolom persis tidak pernah tampil pada mode ini.
- Spawn tepat di bawah otak (y = 334,8 px pada skala 1; 25% tinggi dengan `?keyboard=1`), jatuh ke y pita pada x itu dengan ease-in 280 ms.
- Mendarat: ring kecil (radius 0 ke 18 px, alpha 0.5 ke 0, 500 ms). Ini satu-satunya tempat glow dipakai.
- Setelah itu ikut terbawa scroll pita dan memudar maksimum 8 detik atau saat keluar frame.
- Radius: `3 + 7 × clamp((IKI - 120) / 800, 0, 1)` px. Tombol pertama setelah diam jadi besar, saat burst jadi kecil dan rapat.
- Batas 400 bead aktif, recycle yang tertua.

### 6.2 Keyboard footprint

Opsional: tidak digambar secara default, hanya dengan `?keyboard=1` (8.2). Tanpa footprint, `privacy` hanya memengaruhi posisi bead (6.1). Selebihnya bagian ini berlaku bila footprint dinyalakan.

- Siluet keyboard ANSI 75% pada alpha 25%, digambar sebagai rounded rect dari data tombol di `data/layout-ansi75.js` (`code`, posisi, ukuran, tangan, baris). Lebarnya sejajar dengan rentang posisi bead. Tinggi 1u = 0,6 × lebar 1u (tombol agak pipih supaya footprint selebar 80% tetap muat di sepertiga bawah).
- Mode `exact`: setiap key-down pada tombol yang ada di layout (termasuk modifier, panah, F-key) menyala alpha 1.0 lalu memudar ke 0 dalam 450 ms. Kode yang tidak ada di layout tidak menyalakan footprint, tetapi tetap menghasilkan bead netral.
- Mode `zone`: yang menyala adalah zona (tangan kiri/kanan × 4 baris = 8 zona), bukan tombol persis. Baris F dan angka masuk baris 0, Tab/QWERTY baris 1, Caps/home baris 2, Shift/ZXCV dan baris bawah (Space, modifier, panah) baris 3. Tangan mengikuti pembagian touch typing standar (kiri sampai 5/T/G/B, kanan mulai 6/Y/H/N); Space menyalakan zona kedua tangan.

### 6.3 HUD

HUD adalah elemen DOM di atas canvas (lihat 3.2).

- Kiri atas: state word (`calm` / `flow` / `tense`), di bawahnya `NN wpm`. WPM hanya tampil saat mengetik: fade in 400 ms, fade out 1.5 s setelah idle.
- Kanan atas (wide) atau di bawah `NN wpm` (tall): HR (`68 bpm`, disembunyikan bila `hr` tidak ada) dan timer sesi `mm:ss`, ukuran kecil. Timer mulai saat halaman dimuat.
- Teks status kecil di dekat timer: `no signal` (saat noSignal) dan `paused` (saat jeda). Dengan `?debug=1` ditambah fps, jumlah key diterima, kode terakhir, dan status listener (`ok`, `no-permission`, `secure-input`).
- Label state dalam bahasa Inggris huruf kecil; `?lang=id` menggantinya menjadi `tenang`, `mengalir`, `tegang`, `tanpa sinyal`, `jeda`.

### 6.4 Ilustrasi otak

Garis tipis otak tampak samping (kontur cerebrum, cerebellum, batang otak, dua celah utama, dan lipatan korteks) di atas tengah layar. Digambar di Canvas dengan warna ink grade, hanya dengan alpha dan lebar garis (tanpa glow: ring pendaratan bead tetap satu-satunya glow, 6.1). Ini ilustrasi, bukan peta aktivitas otak: sumber EEG hanya mengirim angka gabungan, bukan data per area, jadi titik yang menyala saat mengetik tidak menunjukkan area otak yang sebenarnya.

Bentuknya dibuat saat pengembangan oleh `tools/gen_brain.mjs` (siluet berupa spline, lipatan dari pola reaksi-difusi Gray-Scott yang dibatasi siluet, seed tetap) dan disimpan sebagai data vektor di `data/brain.js` (sekitar 1000 titik). Saat berjalan halaman hanya menggambar garis, tanpa alokasi per frame.

**Tiga kelompok garis.** Lipatan korteks dibagi tiga menurut panjangnya, dan tiap kelompok membawa sekitar sepertiga dari panjang total garis: yang terpanjang mewakili gelombang lambat (theta), yang sedang alpha, dan yang terpendek gelombang cepat (beta). Secara umum gelombang lambat dikaitkan dengan koordinasi area yang luas dan gelombang cepat dengan kerja yang lokal, jadi garis panjang untuk yang lambat dan garis pendek untuk yang cepat dipakai sebagai metafora, bukan pemetaan anatomi: letak garis tidak mewakili area otak. Garis otak kecil (cerebellum, bertanda `cb` di data) tidak ikut kelompok dan terangnya tetap.

Level tiap gelombang (0..1, dari `mind.theta`, `mind.alpha`, `mind.beta`) dihaluskan dengan konstanta waktu 1,2 detik supaya tidak berkedip, lalu mengatur terang dasar kelompoknya (opasitas garis 0,10 pada level 0 sampai 0,74 pada level 1; 0,42 pada level 0,5, sama dengan tanpa data) dan kelompok mana yang dinyalakan percikan ketikan. Tanpa data (field tidak ada, atau noSignal) ketiga level jatuh ke 0,5. Sumber EEG menormalisasi tiap gelombang terhadap riwayat user sendiri (persentil 10..90 dari sekitar 18 detik terakhir), jadi terang berarti "sedang tinggi dibanding barusan", bukan kekuatan absolut.

| Sumber | Reaksi |
|---|---|
| `spectrum_pos` | Agitasi lipatan lewat kisi pergeseran halus. Tenang: amplitudo kecil (±1,5 satuan desain) dan lambat (0,35 rad/detik). Tegang: ±6 dan cepat (2,4 rad/detik), ditambah komponen kasar mulai pos 0,5. Warna mengikuti grade seperti pita |
| `hr` | Tidak memengaruhi otak: ukuran dan terang garis tetap, tanpa denyut (disengaja: denyut membuat otak terlihat zoom in dan zoom out). Detak jantung hanya menggerakkan latar "bernapas" |
| `density` | Terang dasar: opasitas 0,8× sampai 1× |
| `theta`, `alpha`, `beta` | Terang dasar tiga kelompok lipatan (panjang, sedang, pendek) dan kelompok yang dinyalakan percikan ketikan; lihat di atas |
| ketikan | Satu percikan per key-down: kepala titik dengan ekor bergerak di sepanjang satu lipatan sekitar 0,9 detik, dan lipatan sekelompok di dekatnya menyala lalu memudar dalam 700 ms. Posisi horizontal mengikuti kolom tombol (sama dengan bead, jadi `privacy=zone` mengacak di dalam rentang tangan); posisi vertikal acak. Kelompok garis dipilih menurut level theta, alpha, beta (bobot = 0,15 + level), dan kecepatan serta panjang ekor mengikuti kelompok: theta 0,55× dan 1,3×, alpha 1× dan 1×, beta 1,6× dan 0,7× |
| Backspace, Space, tombol lain | Backspace bergerak mundur dan lebih redup; Space lebih panjang dan lebih lambat; modifier, panah, dan F-key pendek dan redup |
| Enter | Semua lipatan menyala sebentar (tidak diulang saat Enter ditahan) |
| auto-repeat | Dibatasi 12 percikan per detik, batas yang sama dengan bead |
| noSignal | Redup (opasitas 35%) dan diam, tanpa agitasi; percikan ketikan tetap jalan |
| pause | Tidak ada ketikan yang diteruskan, jadi tidak ada percikan |

Batas 48 percikan aktif (yang tertua didaur ulang). Kontur luar tidak bergerak; lipatan makin diam makin dekat ke kontur dan celah supaya bentuk otak tetap utuh. `?brain=0` mematikan seluruh ilustrasi. Dengan `?keyboard=1` otak mengecil sedikit supaya tetap di atas titik jatuh bead.

---

## 7. Kartu laporan sesi

Dipicu tombol `R` di halaman (hanya bila halaman sedang fokus), `{"t":"ctl","report":true}`, atau hotkey global `ctrl+alt+r` di bridge. Hotkey global adalah satu-satunya cara saat halaman berada di OBS, karena Browser Source tidak menerima keyboard. Tampil 9 detik lalu menutup sendiri; `Esc` atau pemicu kedua menutup lebih awal. Saat tampil, scene di belakangnya diredupkan 60% dan HUD disembunyikan supaya teksnya tidak menumpuk dengan kartu.

- **Strip sesi:** satu strip horizontal berwarna (warna = state per detik) dengan garis WPM di atasnya.
- **Angka:** durasi, WPM rata-rata (hanya saat mengetik) dan puncak, menit di flow (waktu `pos` di 0.35..0.65), jeda terpanjang, jumlah backspace.
- Data: log `{t, pos, wpm, hr}` per 1 detik, dicatat berdasarkan timestamp (bukan hitungan tick) dan celah diisi nilai terakhir bila timer tertahan, ditambah penghitung berjalan (jumlah backspace, jeda terpanjang, puncak WPM, detik mengetik, detik di flow). 4 jam = 14.400 sampel, ringan di memori.
- Ekspor PNG 1920×1080 dan 1080×1920 (`canvas.toBlob`) dengan tombol di kartu, tampil hanya bila `?controls=1` (dipakai pada tab di monitor kecil, bukan di OBS). Tab itu harus dibuka sebelum sesi mulai supaya datanya sama dengan yang di OBS.
- Teks hook dibuat otomatis dari angka, contoh: `flow selama 14 menit 20 detik` (`?lang=en`: `14 min 20 s in flow`). Bila menit di flow nol, hook memakai state dominan, mis. `dominan calm selama 8 menit`.

---

## 8. Arsitektur

```
listener global (tap Quartz) ──┐
sumber EEG (eeg/) ─────────────┼─> bridge.py (aiohttp: http + ws, port 8770) ─> halaman (OBS Browser Source / tab biasa)
tools/inject.py ───────────────┘                                                  ▲
                      sim.js / replay.js / browserkeys.js ─ (event bus lokal) ────┘
```

Sumber EEG berjalan sebagai proses terpisah dari bridge. `npm start` (`tools/start.py`) menjalankan keduanya dan menghidupkan ulang yang mati, jadi crash atau macet di sisi Bluetooth tidak menjatuhkan bridge dan listener ketikan.

Bridge juga menyajikan file statis supaya OBS memakai `http://127.0.0.1:8770/` (menghindari masalah CORS pada ES modules dari `file://` di CEF), mengelola hotkey global, dan menyediakan `GET /status` untuk diagnosis (JSON: `listener` = `ok` / `no-permission` / `secure-input`, `clients`, `keys_forwarded`).

- **Listener:** tap Quartz listen-only (`pyobjc-framework-Quartz`) untuk event `keyDown` dan `flagsChanged`. Hanya membaca keycode, flag auto-repeat, dan flag modifier; tidak pernah menerjemahkan keycode ke karakter. Callback hanya memasukkan event ke antrean asyncio (`call_soon_threadsafe`).
- **Izin:** bila izin Input Monitoring belum ada, bridge mencetak instruksi yang jelas, `/status.listener = no-permission`, `hello.keys = false`, dan mencoba lagi tiap 3 detik tanpa crash.
- **Hotkey:** `ctrl+alt+p` (pause) dan `ctrl+alt+r` (laporan). Listener hanya membaca, jadi chord hotkey tetap sampai ke aplikasi yang sedang fokus; pilih aplikasi yang tidak memakai chord itu.
- **Secure input:** bila tersedia, bridge memantau `IsSecureEventInputEnabled()` tiap detik; saat aktif, `/status.listener = secure-input` dan mengirim `ctl.secure`.
- **Python:** venv khusus di `.venv/`. Pakai versi Python terbaru yang bisa memasang `aiohttp`, `pyobjc-framework-Quartz`, dan dependensi `eeg/requirements.txt` (`muselsl`, `bleak`, `pylsl`, `brainflow`, `numpy`, `scipy`; versinya dipin dan butuh Python 3.12+).

### 8.1 Struktur file

```
typewave/
  index.html
  package.json             devDependencies saja (playwright) dan skrip npm (start, start:fake, eeg, bridge, test*); aplikasi tanpa dependency runtime
  README.md                izin macOS dan Bluetooth, menjalankan bridge dan sumber EEG, setup OBS, typing mode (hanya dengan server EEG lama)
  src/
    main.js                bootstrap
    app.js                 perakit utama: input -> bus -> metrics -> render, render loop, API debug
    params.js              parameter URL (bagian 8.2)
    debug.js               statistik dan API debug (?debug=1)
    config.js              semua konstanta bagian 3 dan 6 (satu tempat untuk tuning)
    input/
      ws.js                klien WebSocket + reconnect
      browserkeys.js
      sim.js
      replay.js
    core/
      bus.js               event bus lokal
      metrics.js           IKI, WPM, density, session log
      keys.js              klasifikasi tombol (karakter/backspace/enter/lain)
      text.js              label en/id, sumbu font, format timer/durasi
      placement.js         posisi bead (exact/zone, wide/tall)
      color.js             OKLab mix, smoothstep
      spring.js            critically damped spring
    render/
      scene.js             geometri (s,c) ke kanvas untuk wide/tall
      ribbon.js
      beads.js
      keyboard.js
      brain.js             ilustrasi otak: kontur, lipatan, percikan
      hud.js               elemen DOM
      report.js
    data/
      layout-ansi75.js
      brain.js             kontur dan lipatan otak, dihasilkan tools/gen_brain.mjs
  assets/fonts/
    Anybody-VF.woff2
    OFL.txt
  bridge/
    bridge.py              aiohttp: static + ws relay + hotkey + /status
    listener.py            tap Quartz listen-only
    keymap.py              virtual key macOS ke KeyboardEvent.code
    decode.py              decoder event Quartz ke KeyEvent (murni, tanpa Quartz)
    requirements.txt       aiohttp, pyobjc-framework-Quartz
  eeg/                     sumber EEG mandiri (bagian 11.1)
    __main__.py            CLI: python -m eeg [--fake] [--scan] [--address] [--name] [--python] [--bridge] [--warmup] [--state-dir]
    config.py              Settings: backoff, jendela, warm-up, laju kirim
    scan.py                pindai BLE (bleak) dan cache alamat headset
    stream.py              MuseSession: streamer muselsl di subprocess -> LSL (pylsl), deteksi putus dan stall, pidfile
    muse_streamer.py       streamer di subprocess: muselsl.stream dengan penyesuaian CoreBluetooth, tanpa watchdog bawaan, keluar bila induknya mati
    supervisor.py          loop sambung ulang tanpa batas dengan backoff
    dsp.py                 kualitas kanal, band power theta/alpha/beta, EMG frontal, detak jantung dari PPG
    state.py               normalisasi, penghalusan, ambang adaptif, spectrum_pos, warm-up
    bridge_link.py         WebSocket ke bridge dengan sambung ulang
    runner.py              perakit: supervisor + dsp + state + pengiriman 5 Hz
    requirements.txt       muselsl, bleak, pylsl, brainflow, numpy, scipy
    lsl_quiet.cfg          konfigurasi liblsl yang menyenyapkan log native (dipakai lewat LSLAPICFG)
  adapters/                opsional: server EEG lama (bagian 11.2)
    eeg_socketio.py
    requirements.txt       python-socketio[client]
  tools/
    start.py               menjalankan bridge + sumber EEG sekaligus, masing-masing diawasi (npm start)
    inject.py              key palsu lewat WebSocket
    autotype.py            tombol sungguhan lewat OS
    gen_session.mjs        generator sesi sintetis untuk replay
    gen_brain.mjs          generator kontur dan lipatan otak (reaksi-difusi, seed tetap)
    fake_muse_lsl.py       streamer Muse palsu (stream LSL) untuk tes dan demo tanpa headset
    fake_eeg_server.py     meniru event state_update server EEG lama
  replay/
    sample-session.json
  test/
    unit/                  node --test (core/*, data/*)
    bridge/                unittest (keymap, relay, hello, origin, hotkey, dan seluruh paket eeg/ dan tools/start.py); fake_ble.py = emulator BLE Muse untuk muselsl asli
    e2e/                   Playwright (zero-drop, latensi, visual, fps, soak)
  TYPEWAVE_SPEC.md
  TYPEWAVE_SPEC.v0.2.md
```

Tanpa bundler dan tanpa framework: ES modules polos, Canvas 2D untuk pita/bead/footprint/laporan, DOM untuk HUD.

### 8.2 Konfigurasi URL

| Param | Nilai | Default |
|---|---|---|
| `layout` | `wide`, `tall`, `auto` | `wide` |
| `fit` | `contain`, `fill` | `contain` |
| `ratio` | `W:H` atau desimal, dijepit 16:9..3:1; hanya wide | 21:9 (16:9 dengan `keyboard=1`) |
| `transparent` | `0`, `1` | `0` |
| `privacy` | `zone`, `exact` | `zone` |
| `sim` | `0`, `1` | `0` |
| `replay` | nama file di `replay/` (tanpa `.json`) | kosong |
| `lang` | `en`, `id` | `en` |
| `ws` | URL WebSocket, atau `off` | WebSocket di origin halaman (halaman dari bridge default: `ws://127.0.0.1:8770/ws`) |
| `debug` | `0`, `1` | `0` |
| `controls` | `0`, `1` | `0` |
| `keyboard` | `0`, `1` (siluet keyboard di bawah pita, 6.2) | `0` |
| `brain` | `0`, `1` (ilustrasi otak, 6.4) | `1` |

### 8.3 Pengaturan OBS

Browser Source: URL `http://127.0.0.1:8770/?layout=wide`, lebar 1920, tinggi 823 (bingkai 21:9; 1080 dengan `&ratio=16:9`, 640 dengan `&ratio=3:1`), FPS 60, "Control audio via OBS" mati. Opsi "Shutdown source when not visible" dimatikan supaya statistik sesi tidak ter-reset. Browser Source tidak menerima keyboard, jadi kartu laporan dipicu hotkey global (bagian 7).

---

## 9. Privasi dan keamanan

- Yang dikirim hanya kode tombol fisik; listener tidak pernah menerjemahkan keycode ke karakter. Urutan kode secara teori tetap bisa direkonstruksi menjadi teks, karena itu default `privacy=zone`: posisi bead dan percikan otak diacak di dalam rentang tangan (dan footprint, bila dinyalakan, hanya menyalakan zona). Mode `exact` (kolom dan tombol persis) dipilih sengaja untuk konten ASMR yang keyboard-nya memang tampil di kamera.
- macOS memblokir listener global di kolom password (secure input), jadi isinya tidak ikut terkirim. Prompt password di terminal biasanya tidak memicu secure input kecuali "Secure Keyboard Entry" dinyalakan; tekan hotkey pause sebelum mengetik password di terminal.
- Hotkey jeda `ctrl+alt+p` di bridge: berhenti meneruskan key dan mengirim `{"t":"ctl","pause":true}`; tekan lagi untuk lanjut. Saat pause, halaman menampilkan indikator kecil.
- Bridge hanya listen di `127.0.0.1`. WebSocket hanya menerima handshake dengan `Origin` milik bridge sendiri (`http://127.0.0.1:8770` atau `http://localhost:8770`) atau tanpa `Origin` (klien non-browser seperti adapter dan tools), dan memvalidasi header `Host` (anti DNS rebinding). Tanpa ini, situs mana pun yang terbuka di browser bisa membaca aliran ketikan lewat WebSocket ke localhost. `/status` hanya memuat penghitung, tidak pernah kode tombol.
- Tidak ada penyimpanan key ke disk. File di `replay/` dibuat oleh generator sintetis (`tools/gen_session.mjs`), tidak pernah direkam dari ketikan nyata.
- Listener global butuh izin Input Monitoring untuk aplikasi yang menjalankan bridge (System Settings, Privacy & Security, Input Monitoring); `tools/autotype.py` butuh izin Accessibility. Jalankan dari Terminal.app, bukan dari terminal editor yang bisa mematikan proses saat idle.

---

## 10. Performa dan kompatibilitas

- Target frame time ≤ 8 ms di 1920×1080 (16:9, kasus terberat) pada M4 Max, 60 fps stabil di Browser Source OBS (CEF).
- Tanpa alokasi objek di hot path render (pool untuk bead dan titik pita).
- Canvas diatur ke piksel CSS (devicePixelRatio dibatasi 1) agar konsisten di OBS.
- Render loop meng-clamp `dt` ke maksimum 50 ms: tab atau jendela yang tak terlihat bisa menahan `requestAnimationFrame`, dan `dt` besar sesudahnya tidak boleh meledakkan spring atau fase.
- Pembaruan DOM HUD hanya saat nilai berubah.
- Tanpa WebGL dan tanpa shader berat. Font lokal. Tidak ada request jaringan keluar.

---

## 11. Integrasi EEG

TypeWave membaca headset Muse sendiri; tidak ada server EEG lain yang dibutuhkan (11.1). Adapter ke server EEG lama tetap ada sebagai opsi (11.2). Apa pun sumbernya, yang sampai ke bridge adalah pesan `mind` yang sama (bagian 5).

### 11.1 Sumber EEG mandiri (`eeg/`)

Proses terpisah dari bridge: `python -m eeg`, atau `npm start` yang menjalankan bridge dan sumber EEG sekaligus dan menghidupkan ulang yang mati (bagian 8). Alurnya:

```
headset Muse 2/S ─ BLE (bleak) ─> streamer muselsl (subprocess sendiri) ─ LSL ─> pylsl ─> DSP ─> MindState ─ mind 5 Hz ─> bridge
```

- **Pemindaian** (`eeg/scan.py`): memindai BLE untuk perangkat yang namanya memuat "muse" dan menyimpan alamat terakhir yang berhasil di `eeg/.device.json`. `--address` atau `--name` memilih headset bila ada beberapa; `--scan` hanya mencetak daftar.
- **Akuisisi** (`eeg/stream.py` dan `eeg/muse_streamer.py`): `eeg/muse_streamer.py` (muselsl.stream untuk satu alamat BLE, dengan PPG) berjalan di subprocess dengan sesi sendiri, dijalankan langsung oleh interpreter streamer sehingga `--python` hanya perlu punya muselsl. Dua penyesuaian atas muselsl 2.5.0: (1) muselsl mendaftarkan kanal kontrol dua kali (`connect()` lalu `refresh_subscriptions()`), dan bleak di CoreBluetooth menolak yang kedua dengan `ValueError("Characteristic notifications already started")`, jadi muselsl polos mati di setiap sambungan macOS; penolakan yang persis itu diabaikan, kesalahan lain tetap gagal terang-terangan; (2) watchdog muselsl sendiri (`AUTO_DISCONNECT_DELAY` 3 detik) memakai `last_timestamp` yang untuk PPG dihitung dari jam nominal tanpa koreksi paket hilang, jadi bisa keluar "Disconnected." padahal EEG sehat; watchdog itu dimatikan dan pengawas TypeWave menggantikannya. Streamer juga keluar sendiri (SIGINT, lalu paksa) bila proses induknya mati keras. Stream EEG (256 Hz; TP9, AF7, AF8, TP10) dan PPG (64 Hz) dicari lewat `source_id` alamat itu, jadi headset atau streamer lain yang kebetulan menyala tidak tertukar, dan ditunggu sampai 25 detik.
- **DSP** (`eeg/dsp.py`, fungsi murni, jendela 2 detik tiap 0,15 detik): kualitas kanal 0..1 dari simpangan baku (datar atau liar = 0). Otot dahi (EMG) dicek di AF7 dan AF8 (puncak ke puncak di atas 150 µV, atau energi 25 sampai 40 Hz di atas 0,8 kali energi 13 sampai 25 Hz); bila ada, beta tidak dipercaya dan nilai lamanya dipertahankan. Kanal berkualitas di bawah 0,65, berartefak di atas 300 µV, atau didominasi listrik 50 Hz (di dahi) dilewati. PSD Welch lewat BrainFlow (jendela Blackman-Harris): theta 4 sampai 8 Hz, alpha 8 sampai 13 Hz, beta 13 sampai 25 Hz. Detak jantung dari puncak PPG inframerah (median selang antar puncak) tiap 5 detik.
- **Status** (`eeg/state.py`): tiap besaran dinormalisasi ke 0..1 terhadap riwayatnya sendiri (persentil 10..90 dari 120 pembaruan terakhir, sekitar 18 detik) lalu dihaluskan (EMA 0,20 per 0,15 detik, dihitung dengan waktu nyata). Warm-up 15 detik sejak pembaruan valid pertama: belum ada `mind`. Tanpa pembaruan valid selama 2 detik juga tidak ada `mind`, jadi halaman jatuh ke noSignal setelah 5 detik, lebih jujur daripada menampilkan angka basi.
- **Pengiriman** (`eeg/bridge_link.py`): `mind` ke bridge 5 Hz; selama bridge tidak terhubung pesan dibuang.

| `mind` | Dihitung dari |
|---|---|
| `theta`, `alpha`, `beta` | rata-rata kekuatan band di kanal yang lolos, dinormalisasi dan dihaluskan seperti di atas; beta hanya dari kanal bila tidak ada EMG dahi |
| `pos` | arousal = 0,70 beta − 0,10 alpha − 0,05 rasio theta/beta (semuanya sudah dinormalisasi dan dihaluskan), dibandingkan dengan ambang adaptif (median arousal 2 menit terakhir + 0,03; diperbarui saat warm-up selesai lalu tiap 30 detik), dihaluskan dengan konstanta waktu 0,5 detik; 0 calm, 0,5 flow, 1 tense; zona 0,35/0,65 sama dengan spec |
| `hr` | detak jantung dari PPG; dihilangkan selama belum ada |
| `q` | rata-rata kualitas kanal TP9, AF7, AF8, TP10 (0..1) |

#### Sambung ulang otomatis

Diadopsi dari project EEG (`_connect_thread` dan `_launch_and_loop` di `brainflow_connector.py`: percobaan tanpa batas dengan backoff 3, 5, 10, 15 detik; BLE di subprocess; tunggu stream 25 detik; subprocess mati berarti putus) dan ditulis ulang di `eeg/supervisor.py` dan `eeg/stream.py`, tanpa mengimpor kode project itu. Perbaikan atas aslinya ditandai (+):

| Perilaku | Aturan |
|---|---|
| Percobaan | Tanpa batas. Jeda `backoff[min(n-1, 3)]` = 3, 5, 10, 15, 15, ... detik. Status `connecting`, `connected`, `reconnecting`, `stopped` |
| Dianggap putus | Streamer mati (300 karakter terakhir keluarannya, stdout dan stderr, ikut dicatat; muselsl asli mencetak sebabnya ke stdout dan keluar dengan kode 0); stream tidak muncul dalam 25 detik (keluaran streamer ikut dicatat, karena muselsl asli bisa butuh 2 x 30 detik untuk gagal tersambung); (+) **stall**: streamer hidup tetapi tidak ada sampel EEG selama 5 detik; error apa pun di loop pemrosesan |
| Reset hitungan | (+) Sambungan yang bertahan 30 detik dianggap stabil: putus berikutnya kembali menunggu 3 detik, bukan 15 |
| Alamat berubah | (+) Tiap 3 kegagalan beruntun alamat dipindai ulang |
| Pembatalan | (+) Jeda tunggu memakai `Event.wait`, jadi Ctrl+C, SIGTERM, dan SIGHUP (jendela Terminal ditutup) berlaku seketika; error akibat penutupan tidak dicatat sebagai putus |
| Pembersihan | Sesi selalu ditutup (inlet LSL, lalu `killpg` streamer: TERM, lalu KILL). (+) Pid streamer disimpan di `eeg/.streamer.pid` dan hanya dihapus bila masih berisi pid sendiri; streamer yatim dari sesi yang mati mendadak dimatikan saat start berikutnya, hanya bila perintahnya memuat penanda yang benar. (+) Streamer keluar sendiri bila induknya mati keras. (+) Satu instance per state-dir lewat kunci `eeg/.eeg.lock` (`fcntl.flock`, dilepas kernel walau SIGKILL); instance kedua keluar dengan kode 3, jadi dua instance tidak saling membunuh streamer |
| Data saat putus | (+) Tidak ada `mind` basi dan HR dibuang; riwayat normalisasi dan warm-up dipertahankan, jadi tidak ada warm-up ulang setelah tersambung kembali |
| Ke bridge | Bridge mati lalu hidup lagi: backoff 1, 2, 5 detik; koneksi headset tidak terganggu |
| Peluncur | `tools/start.py`: bridge dan sumber EEG masing-masing diawasi; proses yang mati dijalankan ulang (jeda 1, 2, 5 detik; direset setelah stabil 30 detik). Saat Ctrl+C, yang dijalankan belakangan dimatikan lebih dulu (sumber EEG sebelum bridge), jadi tidak ada galat "bridge hilang" |

Batasan:

- Muse hanya melayani satu klien BLE: tutup aplikasi Muse dan server EEG lama yang memakai headset yang sama.
- Butuh izin Bluetooth untuk Terminal.app.
- Sumber ini hanya membaca dan tidak pernah menembakkan keystroke, jadi typing mode tidak diperlukan.
- `--python` memilih interpreter untuk streamer bila `muselsl` bermasalah di Python venv; interpreter itu hanya perlu punya `muselsl`.
- Muse 2 (dan Muse S generasi lama dengan protokol yang sama). Muse S Athena memakai kelas protokol lain di muselsl 2.5.0 dan belum diuji.
- Pemindaian BLE dibatasi waktu (timeout + 10 detik): bleak menunggu tanpa batas selama dialog izin Bluetooth tertunda, dan tanpa batas itu pengawas ikut macet.
- Yang terbukti hanya sampai emulator BLE (aturan CoreBluetooth dan paket berformat Muse). Radio Bluetooth dan asumsi muselsl di macOS yang tidak ditiru emulator (mis. pemetaan handle karakteristik bleak) hanya terbukti dengan headset sungguhan (butir 33).
- `--fake [relaxed|focused|tense|mixed]` memakai `tools/fake_muse_lsl.py`: stream LSL sintetis (EEG 5 kanal 256 Hz dan PPG) dengan gangguan yang bisa disuntik untuk tes (berhenti, crash, stall, lambat tersambung, gagal tersambung).
- Log native liblsl (banner INFO dan "ERR Stream transmission broke off") disenyapkan lewat `eeg/lsl_quiet.cfg`, kecuali pengguna punya konfigurasi LSL sendiri (`LSLAPICFG`, atau `lsl_api.cfg` di folder kerja, home, atau /etc) yang tidak boleh ditimpa; sambung ulang yang sebenarnya dicatat pengawas.
- Drum engine sebaiknya di-mute saat merekam ASMR, karena mic menangkap suara keyboard.

### 11.2 Adapter server EEG lama (opsional)

Server EEG lama (`eeg_server.py`, Flask-SocketIO di `127.0.0.1:8765`) mengirim event `state_update` setiap 100 ms ke semua klien. Nama field di bawah sudah dicek langsung ke kode server pada 3 Oktober 2026. Adapter ini tidak dibutuhkan oleh 11.1, dan tidak boleh berjalan bersamaan dengannya untuk headset yang sama (satu klien BLE per headset).

- `adapters/eeg_socketio.py` (python-socketio client) berlangganan `state_update` dan meneruskan `{"t":"mind","pos","hr","q","theta","alpha","beta"}` ke bridge 5 Hz (setiap payload kedua).

| `mind` | Sumber di `state_update` | Catatan |
|---|---|---|
| `pos` | `spectrum_pos` | 0..1; 0 calm, 0.5 flow, 1 tense; zona 0.35/0.65 sama dengan spec |
| `hr` | `heart_rate` | Bisa `None`; bila `None`, field `hr` dihilangkan. Jangan pakai `bpm`: itu tempo drum engine, bukan detak jantung |
| `q` | rata-rata `channel_quality` (TP9, AF7, AF8, TP10) | Tiap kanal 0..1 |
| `theta`, `alpha`, `beta` | `theta`, `alpha`, `beta` | 0..1; satu angka gabungan semua sensor yang sudah dinormalisasi server terhadap riwayat user sendiri (bukan per area); dijepit ke 0..1, dihilangkan bila tidak ada atau bukan angka |

- **Kapan berhenti mengirim:** bila `eeg_active` false, `warming_up` true, atau `muse` bukan `connected`. Halaman lalu jatuh ke noSignal setelah 5 detik, lebih jujur daripada menampilkan `spectrum_pos` default (0.4) yang belum terkalibrasi.
- Adapter reconnect otomatis (backoff 1 s, 2 s, 5 s) dan mencatat jelas bila field yang diharapkan tidak ada (nama field bisa berubah di server).
- **Keystroke buatan (hanya dengan server EEG lama):** `keymap.json` project EEG memetakan mental command ke huruf biasa (`a d e q s w x`), dan sebagian ditembak lewat Quartz HID tap yang meniru hardware, jadi tidak bisa dibedakan dari ketikan asli di sisi bridge. Keputusan: typing mode, yaitu command mental dimatikan di sisi EEG saat TypeWave dipakai merekam typing (langkahnya ada di README). Adapter berlangganan event command (`eyebrow_raise`, `jaw_clench`, `double_jaw`, `tilt_left`, `tilt_right`, `tilt_up`, `tilt_down`) hanya untuk mencetak peringatan bila ada yang menembak.
- `tools/fake_eeg_server.py` meniru event `state_update` dengan nama field yang sama untuk tes dan demo adapter ini tanpa headset.

---

## 12. Definition of Done

Satu daftar, tanpa fase. Semua butir harus terpenuhi. Penanda: **[otomatis]** dibuktikan tes yang bisa dijalankan ulang; **[kamu]** butuh mata atau perangkat kamu (izin macOS, headset, aplikasi streaming). Butir 1 dan 5 memakai event OS sungguhan dan baru bisa jalan setelah izin macOS diberikan; sebelum itu logika bridge dites dengan event sintetis.

**Ketikan sampai ke halaman**

1. [otomatis] Ketikan di aplikasi lain muncul di halaman. `tools/autotype.py` menembakkan 200 tombol dengan irama acak (burst sampai 15 tombol/detik): halaman menerima 200 event dengan urutan sama, tidak ada yang hilang, dan tidak ada yang dobel saat `sim=1` dan halaman sedang fokus.
2. [otomatis] Latensi dari timestamp `at` sampai event diterima halaman: p95 di bawah 50 ms.
3. [otomatis] Setiap jenis tombol (huruf, angka, simbol, Space, Enter, Backspace, Tab, Esc, modifier, panah, F-key, auto-repeat, kode tak dikenal) menghasilkan reaksi sesuai bagian 6, dan pemetaan `keymap.py` lengkap tanpa kode ganda.
4. [kamu] Setiap tombol pada keyboard asli yang dipakai menghasilkan kode yang dikenal (tidak ada `Vk..`), dicek lewat `?debug=1`.
5. [otomatis] Hotkey `ctrl+alt+p` menghentikan penerusan key dan menampilkan indikator `paused`; tekan lagi untuk lanjut. `ctrl+alt+r` menampilkan dan menutup kartu laporan.
6. [otomatis] Klien reconnect otomatis setelah bridge di-restart, dan `hello` dikirim ulang.
7. [otomatis] WebSocket menolak handshake dengan `Origin` atau `Host` asing; `/status` tidak memuat kode tombol.
8. [otomatis] Tanpa izin Input Monitoring, bridge mencetak instruksi, melaporkan `/status.listener = no-permission`, dan tidak crash (dites dengan mock).
9. [kamu] Ketikan nyata di aplikasi mana pun tampil di Browser Source OBS.

**Tampilan**

10. [otomatis] `?sim=1&layout=wide` terbuka tanpa error konsol, dengan bridge maupun `?ws=off`.
11. [otomatis] Slider `pos` mengubah ground, ink, tepi pita, dan lebar huruf secara halus, tanpa kedip atau lompat (selisih nilai render antar frame di bawah ambang).
12. [otomatis] Bead muncul per ketikan; backspace, space, Enter, dan tombol lain tampil berbeda; idle 3 detik membuat pita istirahat; menghentikan `mind` 5 detik menghasilkan grade netral.
13. [otomatis] Warna ground dan ink di `pos` 0.1, 0.5, 0.9 cocok dengan token bagian 3 (sampel piksel, toleransi kecil), untuk wide dan tall.
14. [otomatis] `?layout=tall` di 1080×1920: HUD di luar safe zone (cek bounding box, screenshot disimpan untuk review). `?transparent=1` menghilangkan ground. `?lang=id` mengganti label.
15. [otomatis] 60 fps stabil di Chrome pada M4 Max: frame time p95 ≤ 8 ms dan rata-rata fps ≥ 58 selama 60 detik dengan ketikan simulasi 8 tombol/detik.
16. [kamu] 60 fps di Browser Source OBS (lihat overlay `?debug=1` di preview OBS), dan tampilan sesuai di TikTok LIVE Studio.

**Kartu laporan**

17. [otomatis] Untuk sesi sintetis dengan statistik yang diketahui (`tools/gen_session.mjs`), kartu laporan menampilkan durasi, WPM rata-rata dan puncak, menit di flow, jeda terpanjang, dan jumlah backspace yang benar.
18. [otomatis] Ekspor PNG 1920×1080 dan 1080×1920 berhasil (dimensi dan file valid).

**EEG**

19. [otomatis] Adapter server EEG lama (opsional, 11.2), terhadap `tools/fake_eeg_server.py` (field persis seperti `eeg_server.py`), meneruskan `mind` 5 Hz dengan `pos`, `hr`, `q`, dan level `theta`/`alpha`/`beta` yang benar; berhenti mengirim saat `warming_up`, headset putus, atau `eeg_active` false; dan mencetak peringatan saat event command mental menembak.
20. [kamu] Dengan headset sungguhan (butir 33), warna mengikuti kondisi otak.
21. [otomatis] `replay/sample-session.json` memutar sesi tanpa headset dan tanpa bridge.

**Kualitas dan penyerahan**

22. [otomatis] Unit test (metrics, color, spring, keys, layout) dan test bridge lulus. Soak 10 menit dengan ketikan simulasi: heap stabil (pertumbuhan di bawah 5 MB setelah GC).
23. [kamu] Tuning parameter bagian 6 dari rekaman nyata lewat `src/config.js`, termasuk arah pita dan tint `transparent`.
24. README berisi: izin Input Monitoring (dan Accessibility untuk `autotype`) dan izin Bluetooth, menjalankan bridge dan sumber EEG dari Terminal.app, sambung ulang otomatis dan batasannya (satu klien BLE per headset), setup Browser Source OBS, tab monitor kecil (`?controls=1`), typing mode (hanya dengan server EEG lama), dan cara menjalankan semua tes.
25. Video demo screen recording alur nyata (simulator dan ketikan) di root project.

**Ilustrasi otak**

26. [otomatis] Ilustrasi otak tampil di atas tengah dengan warna ink grade dan hilang dengan `?brain=0`; satu percikan per ketikan (repeat dibatasi 12 per detik, kapasitas 48); tidak menabrak HUD dan berada di dalam safe zone tall; kontur tidak bergerak, dan tanpa sinyal lipatan diam; biaya gambar p95 di bawah 1 ms.
27. [kamu] Ilustrasi otak terbaca dan tidak mengganggu di Browser Source OBS dan TikTok LIVE Studio; ukuran dan posisi dituning lewat `CONFIG.layout.*.brain`.
28. [otomatis] Level `theta`/`alpha`/`beta` dari `mind` sampai ke ilustrasi otak: lipatan terbagi tiga kelompok menurut panjang (sepertiga panjang total tiap kelompok, otak kecil di luar kelompok); terang dasar tiap kelompok mengikuti levelnya dengan halus (tanpa kedip) dan jatuh ke netral 0,5 bila data hilang; percikan ketikan memilih kelompok menurut level dengan kecepatan sesuai kelompok; adapter, bridge, `inject.py`, simulator, dan replay meneruskan ketiga level.
29. [kamu] Dengan headset sungguhan, kelompok garis yang terang terasa sesuai kondisi (santai: garis panjang dan sedang terang; fokus atau tegang: garis pendek terang), dan perbedaannya terbaca di Browser Source OBS pada ukuran otak sebenarnya.


**EEG mandiri**

30. [otomatis] Sumber EEG mandiri terhadap streamer LSL palsu (`tools/fake_muse_lsl.py`): pemrosesan sinyal benar (kualitas kanal; irama 6, 10, dan 20 Hz masuk band theta, alpha, dan beta yang tepat; EMG dahi menahan beta; artefak dan listrik 50 Hz dilewati; detak jantung 72 bpm terbaca); normalisasi persentil, penghalusan, ambang adaptif, warm-up, dan kebasian data benar; pesan `mind` 5 Hz dengan `pos`, `hr`, `q`, `theta`, `alpha`, `beta` di dalam 0..1 sampai ke bridge dan ke halaman, dan level gelombang di halaman tidak macet di netral.
31. [otomatis] Sambung ulang otomatis: streamer mati, crash, stall (hidup tanpa data), gagal tersambung berulang, stream tidak muncul, dan streamer dibunuh dari luar semuanya terdeteksi dan disambung ulang tanpa batas dengan jeda 3, 5, 10, 15 detik (direset setelah sambungan stabil 30 detik); alamat dipindai ulang tiap 3 kegagalan; selama putus tidak ada data basi (halaman jatuh ke noSignal setelah 5 detik dan pulih sendiri tanpa warm-up ulang); bridge mati lalu hidup lagi tidak mengganggu koneksi headset dan pesan kembali mengalir; Ctrl+C, SIGTERM, dan SIGHUP berlaku seketika, bahkan saat menunggu jeda; streamer selalu ikut mati dan tidak ada yatim (termasuk lewat pidfile setelah mati mendadak, dan streamer keluar sendiri bila induknya mati keras); satu instance per state-dir.
32. [otomatis] CLI dan peluncur: `python -m eeg` (opsi, `--scan`, `--fake`, pesan jelas bila `muselsl` belum terpasang) dan `tools/start.py` (bridge dan sumber EEG masing-masing diawasi dan dijalankan ulang bila mati) berjalan sebagai proses sungguhan terhadap bridge sungguhan; SIGHUP pada peluncur mematikan bridge, sumber EEG, dan streamer; instance kedua dengan state-dir yang sama ditolak (kode 3) tanpa mengganggu yang pertama.
33. [kamu] Dengan headset Muse sungguhan: `npm start` memindai dan tersambung lewat Bluetooth (izin Bluetooth untuk Terminal.app sudah diberikan), warna dan level gelombang mengikuti kondisi otak; headset dimatikan atau dijauhkan lalu dinyalakan lagi: tersambung kembali sendiri tanpa menjalankan ulang apa pun; `--python` bekerja bila `muselsl` bermasalah di Python venv. Streamer menerima data dari headset (pemetaan handle muselsl di CoreBluetooth) dan tidak keluar sendiri selama sesi sejam; bila tidak, jalankan `eeg/muse_streamer.py ALAMAT` sendirian dan baca keluarannya.
34. [otomatis] muselsl ASLI di bawah emulator BLE (`test/bridge/fake_ble.py`: klien bleak palsu dengan aturan CoreBluetooth, paket EEG 12-bit dan PPG 24-bit berformat Muse): muselsl polos mati karena langganan ganda dan keluar sendiri saat PPG kehilangan paket (karakterisasi); streamer TypeWave selamat dari keduanya, EEG 4 kanal sekitar 256 Hz dengan skala mikrovolt benar, kolom PPG inframerah, dan detak jantung 72 bpm sampai ke TypeWave; kesalahan lain dari bleak tidak ikut diabaikan; satu jalur penuh `python -m eeg --address ... --python ...` (emulator, bridge, streamer dibunuh lalu pulih sendiri).

**Panggung**

35. [otomatis] Tanpa `?layout=` halaman horizontal, dan di jendela mana pun (potret, sangat lebar, persegi) scene digambar di panggung wide 21:9 atau tall 9:16 yang utuh dan terpusat dengan bilah hitam di sisanya; HUD, otak, dan kartu laporan berada di dalam panggung dan tidak saling menabrak; `?fit=fill` mengembalikan perilaku memenuhi jendela; `?ratio=16:9` mengembalikan bingkai dan tata letak lama persis; untuk setiap `?ratio=` dari 16:9 sampai 3:1 pita selalu muat di dalam bingkai (tidak keluar dari bawah, tidak menabrak otak) dan bead punya jarak jatuh; pada jendela yang memang berbentuk panggung hasilnya tanpa bilah.

---

## 13. Rencana tes

- **Unit (`node --test`):** `metrics` dengan timeline sintetis (WPM termasuk jendela awal burst, IKI, density, idle, noSignal, pengecualian auto-repeat dan chord Cmd/Ctrl, jam yang disuntik), `color` (ujung interpolasi, plateau flow, saturasi `q`), `spring` (tanpa overshoot, hasil sama untuk dt berbeda), `keys` (klasifikasi), `layout-ansi75` (zona, tangan, normalisasi posisi), hysteresis kata state, `brain` (data, geometri, pemetaan gerak, percikan, pool, kelompok garis, penghalusan level).
- **Bridge (Python `unittest`):** `keymap` (semua vk terpetakan, kode unik, tak dikenal jadi `Vk..`), relay ke banyak klien, `hello`, pause dan hotkey, penolakan `Origin`/`Host`, `/status`, perilaku saat izin tidak ada (mock).
- **Integrasi (Playwright + bridge + `tools/inject.py`):** N pesan `key` masuk semua ke halaman tanpa hilang dan berurutan, latensi, reconnect setelah restart bridge, `?ws=off` dan `?sim=1` tanpa error konsol, replay sesi sintetis menghasilkan angka laporan yang diharapkan.
- **OS (`tools/autotype.py` + bridge + Chrome headed):** butir 1 dan 5 dengan event OS sungguhan.
- **Visual:** Playwright screenshot per kombinasi `pos` ∈ {0.1, 0.5, 0.9} × layout {wide, tall}; sampel piksel dibandingkan dengan token warna, dan screenshot disimpan untuk review mata. Area otak dicek berisi garis berwarna ink grade (dan kosong dengan `?brain=0`).
- **Performa:** fps dan frame time dari render loop lewat `?debug=1` selama 60 detik; soak 10 menit dengan ketikan simulasi dan pengukuran heap lewat CDP.
- **EEG mandiri (Python `unittest`):** `dsp` (sinyal sintetis 6, 10, 20 Hz; kualitas kanal; EMG; listrik 50 Hz; artefak; detak jantung), `state` (normalisasi, penghalusan, ambang adaptif, warm-up, kebasian), `supervisor` (jam dan penantian palsu: backoff, reset, pembatalan), `stream` (proses dan LSL sungguhan dengan `tools/fake_muse_lsl.py`: mati, crash, stall, gagal mulai, lambat, dibatalkan, yatim), `scan` (cache, filter nama), `bridge_link` (bridge sungguhan dimatikan lalu dinyalakan), `runner` (end-to-end), CLI (proses `python -m eeg` sungguhan terhadap bridge sungguhan: SIGINT, SIGTERM, streamer dibunuh dari luar, streamer yang selalu gagal), dan peluncur.
- **muselsl asli di bawah emulator BLE (`test/bridge/test_eeg_muselsl.py`, `fake_ble.py`):** tes dengan streamer LSL palsu tidak bisa menangkap kelakuan muselsl sendiri, jadi kode muselsl sungguhan dijalankan di bawah klien bleak palsu: karakterisasi dua kelakuan muselsl 2.5.0 yang dikerjakan `muse_streamer.py`, lalu rantai penuh sampai ke `MuseSession` dan CLI. Emulator mengikuti sumber bleak dan muselsl yang terpasang; ia bukan bukti perilaku radio atau CoreBluetooth sungguhan.
- **EEG mandiri di halaman (Playwright + bridge + `python -m eeg --fake`):** level gelombang bergerak; streamer dibunuh, halaman jatuh ke noSignal lalu pulih sendiri.
- **Manual (kamu):** satu sesi ketik nyata di OBS dan TikTok LIVE Studio; headset sungguhan, termasuk mematikan dan menyalakan lagi headset.

---

## 14. Keputusan

| Keputusan | Nilai |
|---|---|
| Layout | wide dan tall dibangun bersamaan |
| Privasi default | `zone`; `exact` opsional per sesi |
| Bahasa label | Inggris huruf kecil, `?lang=id` untuk Indonesia |
| Hotkey | pause `ctrl+alt+p`, laporan `ctrl+alt+r` |
| Listener global | Tap Quartz listen-only via pyobjc, bukan pynput: flag auto-repeat dan modifier langsung tersedia, dan keycode tidak pernah diterjemahkan ke karakter |
| HUD | Elemen DOM; kartu laporan digambar di canvas |
| Mitigasi keystroke buatan dari mental command | Hanya relevan dengan server EEG lama (sumber mandiri tidak menembakkan keystroke). Typing mode: command mental dimatikan di sisi EEG saat merekam typing. Adapter hanya memberi peringatan; tidak ada `suppress_ms` |
| Sumber EEG | Mandiri di `eeg/` (muselsl + LSL + DSP sendiri), tanpa server EEG lain; adapter socket.io tetap opsional. Menggantikan keputusan awal "hanya adapter socket.io" atas permintaan agar proyek independen |
| Sambung ulang headset | Tanpa batas; jeda 3, 5, 10, 15 detik; reset setelah stabil 30 detik; deteksi stall 5 detik; pindai ulang tiap 3 kegagalan |
| Akuisisi BLE | Streamer `eeg/muse_streamer.py` (muselsl dengan penyesuaian) di subprocess sendiri (crash atau macet Bluetooth tidak menjatuhkan proses utama), dibaca lewat LSL; versi dependensi dipin. Watchdog bawaan muselsl dimatikan: pengawas TypeWave (proses mati, atau tanpa sampel EEG selama 5 detik) menjadi satu-satunya penentu putus |
| Peluncuran | `npm start`: bridge dan sumber EEG masing-masing diawasi dan dijalankan ulang bila mati |
| Drum engine saat rekaman ASMR | Di-mute |
| Arah pita | Kiri ke kanan pada wide (`RIBBON_DIR` di `config.js`), dinilai saat review visual |
| `transparent=1` | Tanpa tint; color grade tidak tampil pada mode ini |
| Ekspor PNG | Dari tab biasa dengan `?controls=1`, bukan dari OBS |
