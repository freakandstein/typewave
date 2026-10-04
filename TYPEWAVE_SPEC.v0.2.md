# TypeWave: visualisasi reaktif ketikan + EEG

Design spec untuk fase development. Proyek mandiri, terpisah dari project EEG yang sudah ada.
Status: draft v0.2, 3 Oktober 2026. Nama proyek: TypeWave (typing + brainwave). Di dalam spec ini, elemen visual utamanya tetap disebut "pita" (ribbon).

---

## 1. Tujuan

Membuat satu visualisasi realtime untuk konten typing + ASMR keyboard mechanical. Visual bereaksi ke dua sumber:

1. **Ketikan** dari keyboard (global, termasuk saat mengetik di aplikasi lain).
2. **Kondisi otak** dari EEG (nilai `spectrum_pos` 0..1 dan heart rate), dengan sumber simulator dulu.

Output dipakai sebagai OBS Browser Source (stream/rekaman) dan bisa juga tampil di monitor kecil di atas keyboard.

### Non-goals

- Tidak mengubah atau bergantung pada kode project EEG yang ada (hanya menyiapkan kontrak data supaya bisa disambung nanti).
- Tidak ada audio dari visualisasi. Satu-satunya suara adalah keyboard.
- Tidak menampilkan teks yang diketik, dan tidak mencatat teks ke disk.
- Tidak menampilkan merek headset EEG di layar.

---

## 2. Konsep

Satu pita cahaya mengalir melintasi layar.

- **Ketebalan dan kecepatan pita** mengikuti gaya mengetik (WPM, kerapatan ketikan).
- **Tekstur tepi pita** mengikuti otak: halus seperti sutra saat calm dan flow, makin bergerigi saat tense.
- **Seluruh frame ikut berganti suhu warna** (color grade) mengikuti `spectrum_pos`.

Elemen yang harus paling diingat penonton adalah color grade seluruh frame + pita. Semua elemen lain sengaja tenang supaya tidak bersaing dengan suara keyboard. Tidak ada riak neon per tombol, tidak ada bloom global, tidak ada partikel dekoratif.

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

### 3.2 Tipografi

Satu family: **Anybody** (variable font, lisensi OFL, sumbu `wdth` 50 sampai 150, `wght` 100 sampai 900). File woff2 di-bundle lokal di `assets/fonts/` supaya aman di OBS tanpa internet.

Sumbu mengikuti state:

```
wdth = lerp(130, 70, pos)     // calm lebar, tense padat
wght = lerp(300, 700, pos)    // calm tipis, tense tebal
```

Aturan teks:

- Semua huruf kecil / sentence case: `calm`, `flow`, `tense`, `74 wpm`.
- Tanpa label kecil di atas konten, tanpa huruf kapital semua, tanpa ornamen.
- Ukuran referensi di canvas 1080 tinggi: state word 96 px, angka WPM 64 px, teks kecil (HR, timer) 28 px. Skala proporsional dengan tinggi canvas.

---

## 4. Layout

Satu scene, dua layout. Dipilih lewat `?layout=wide|tall|auto` (auto = dari rasio viewport).

```
wide 16:9 (default, canvas OBS 1920x1080)        tall 9:16 (TikTok)
┌───────────────────────────────────────┐        ┌─────────────────┐
│ flow                          68  14:20│        │ flow            │
│ 74 wpm                                 │        │ 74 wpm          │
│                                        │        │                 │
│  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  │        │       ┃         │
│  pita mengalir kiri ke kanan,          │        │       ┃ pita    │
│  bead jatuh di kolom tombol            │        │       ┃ naik    │
│                                        │        │  ┌─────────┐    │
│     ┌ keyboard footprint (25%) ┐       │        │  │footprint│    │
│     └──────────────────────────┘       │        │  └─────────┘    │
└───────────────────────────────────────┘        │  (zona UI TikTok)│
                                                 └─────────────────┘
```

- Rata kiri untuk teks. Pita memenuhi lebar (wide) atau tinggi (tall).
- **Safe zone tall:** sisakan kira-kira 20% bawah dan 15% kanan bebas dari elemen penting (tertutup UI TikTok). Verifikasi ulang dengan screenshot sebelum rilis.
- **Wide:** HUD di pojok atas, keyboard footprint di sepertiga bawah.
- `?transparent=1` menghilangkan ground sehingga bisa ditumpuk di atas feed kamera.

---

## 5. Input dan kontrak data

Transport: WebSocket ke `ws://127.0.0.1:8770/ws`. Semua sumber mengirim JSON per baris ke bridge, bridge me-relay ke semua klien halaman.

```json
{"t":"key","code":"KeyA","at":1759480000123}
{"t":"mind","pos":0.42,"hr":71,"q":0.9}
{"t":"ctl","pause":true}
{"t":"ctl","report":true}
```

| Pesan | Field | Catatan |
|---|---|---|
| `key` | `code` (nilai `KeyboardEvent.code`), `at` (epoch ms) | Kode fisik saja, tidak pernah karakter. Hanya key-down. Modifier-only diabaikan |
| `mind` | `pos` 0..1 (calm ke tense), `hr` bpm (opsional), `q` 0..1 (opsional, default 1) | Target 5 Hz. Boleh tidak ada sama sekali |
| `ctl` | `pause`, `report`, `suppress_ms` | `suppress_ms`: bridge membuang key event selama jendela itu (lihat bagian 11) |

Sumber input (semua menghasilkan pesan di atas):

| Sumber | Fungsi |
|---|---|
| `browserkeys.js` | `keydown` di halaman, untuk pengembangan |
| `sim.js` | slider `pos`/`hr`, mode auto-wander, tombol "ketik otomatis" |
| `replay.js` | memutar `replay/*.json` (rekaman sesi) dengan timeline asli |
| `bridge.py` | key global via pynput + relay `mind` dari adapter EEG |

Klien WebSocket reconnect otomatis dengan backoff 1 s, 2 s, 5 s (maksimum 5 s).

### 5.1 Metrik turunan (`core/metrics.js`)

| Metrik | Definisi |
|---|---|
| IKI | Selisih waktu antar key karakter (huruf, angka, simbol, space). IKI > 3000 ms dianggap jeda, tidak masuk statistik |
| WPM | Jumlah key karakter dalam 10 detik terakhir / 5 × 6. Backspace tidak dihitung |
| density | keys per detik, EMA dengan tau 1.5 s |
| idle | `now - lastKey > 3000 ms` |
| noSignal | `now - lastMind > 5000 ms` atau belum pernah ada `mind` |
| pos, wpm, hr (render) | Dihaluskan dengan critically damped spring (omega 5 rad/s). Nilai yang dirender tidak boleh melompat |

Referensi virtual key macOS (untuk `bridge.py`, mapping ke `KeyboardEvent.code`): A=0x00, S=0x01, D=0x02, F=0x03, H=0x04, G=0x05, Z=0x06, X=0x07, C=0x08, V=0x09, B=0x0B, Q=0x0C, W=0x0D, E=0x0E, R=0x0F, Y=0x10, T=0x11, 1=0x12, 2=0x13, 3=0x14, 4=0x15, 6=0x16, 5=0x17, Equal=0x18, 9=0x19, 7=0x1A, Minus=0x1B, 8=0x1C, 0=0x1D, RightBracket=0x1E, O=0x1F, U=0x20, LeftBracket=0x21, I=0x22, P=0x23, Return=0x24, L=0x25, J=0x26, Quote=0x27, K=0x28, Semicolon=0x29, Backslash=0x2A, Comma=0x2B, Slash=0x2C, N=0x2D, M=0x2E, Period=0x2F, Tab=0x30, Space=0x31, Grave=0x32, Delete(Backspace)=0x33, Escape=0x35. Verifikasi dengan keyboard sungguhan di fase 3.

---

## 6. Pemetaan input ke visual

Angka dalam px mengacu ke canvas tinggi 1080, skalakan proporsional.

| Input | Efek | Parameter |
|---|---|---|
| `pos` | Warna ground dan ink | Lihat 3.1 |
| `pos` | Lebar dan berat huruf | Lihat 3.2 |
| `pos` | Kekasaran tepi pita | `r = smoothstep(0.5, 1.0, pos)`; amplitudo noise tepi = `r × 5 px`; r = 0 berarti tepi mulus |
| `hr` | Ground "bernapas" | Faktor luminansi `1 + 0.03 × sin(phase)`, `phase += 2π × hr/60 × dt` (integrasikan fase, jangan hitung dari waktu absolut, supaya tidak loncat saat hr berubah) |
| `wpm` | Ketebalan pita | `lerp(2, 28, clamp(wpm/120))` px |
| `density` | Amplitudo gelombang pita | `lerp(8, 120, clamp(density/8))` px |
| `density` | Kecepatan scroll pita | `lerp(40, 420, clamp(density/10))` px/detik |
| key karakter | Bead | Lihat 6.1 |
| Backspace | Bead mundur | Bergerak melawan arah scroll dengan 40% kecepatan, ink dikurangi saturasinya, larut 700 ms |
| Space | Batang pendek | 40 × 3 px, memanjang di sepanjang pita selama 400 ms |
| Enter | Garis sapuan | Garis tipis 1 px menyapu seluruh lebar frame 600 ms, alpha 0.35 |
| idle | Pita istirahat | Setelah 3 s, kecepatan dan amplitudo menurun halus ke garis yang "bernapas"; EEG tetap menggerakkan warna dan tepi |
| noSignal | Grade netral | Ground turun ke Batu, teks `no signal` kecil muncul, mode ketikan-saja tetap jalan |

Pita dirender dari ring buffer: satu sampel `(y, thickness, roughness, color)` per 8 px lebar, sehingga ~240 titik untuk 1920 px. Digambar sebagai strip polygon dengan gradient alpha dari ekor ke kepala.

### 6.1 Bead

- Posisi x ditentukan kolom tombol pada layout ANSI 75% (`data/layout-ansi75.js`, kolom 0..14 dipetakan ke 10%..90% lebar).
- Spawn di y = 25% tinggi, jatuh ke y pita pada x itu dengan ease-in 280 ms.
- Mendarat: ring kecil (radius 0 ke 18 px, alpha 0.5 ke 0, 500 ms). Ini satu-satunya tempat glow dipakai.
- Setelah itu ikut terbawa scroll pita dan memudar maksimum 8 detik atau saat keluar frame.
- Radius: `3 + 7 × clamp((IKI - 120) / 800, 0, 1)` px. Tombol pertama setelah diam jadi besar, saat burst jadi kecil dan rapat.
- Batas 400 bead aktif, recycle yang tertua.

### 6.2 Keyboard footprint

- Siluet keyboard ANSI 75% pada alpha 25%, digambar sebagai rounded rect.
- Mode `exact`: tombol yang ditekan menyala alpha 1.0 lalu memudar ke 0 dalam 450 ms.
- Mode `zone`: yang menyala adalah zona (tangan kiri/kanan × 4 baris = 8 zona), bukan tombol persis.

### 6.3 HUD

- Kiri atas: state word (`calm` / `flow` / `tense`), di bawahnya `NN wpm`. WPM hanya tampil saat mengetik: fade in 400 ms, fade out 1.5 s setelah idle.
- Kanan atas: HR (`68 bpm`) dan timer sesi `mm:ss`, ukuran kecil.
- Label state dalam bahasa Inggris huruf kecil; `?lang=id` menggantinya menjadi `tenang`, `mengalir`, `tegang`.

---

## 7. Kartu laporan sesi

Ditampilkan 8 sampai 10 detik, dipicu tombol `R` di halaman atau `{"t":"ctl","report":true}`; `Esc` menutup.

- **Strip sesi:** satu strip horizontal berwarna (warna = state per detik) dengan garis WPM di atasnya.
- **Angka:** durasi, WPM rata-rata (hanya saat mengetik) dan puncak, menit di flow (waktu `pos` di 0.35..0.65), jeda terpanjang, jumlah backspace.
- Data diambil dari log `{t, pos, wpm, hr}` per 1 detik (4 jam = 14.400 sampel, ringan di memori).
- Ekspor PNG 1920×1080 dan 1080×1920 (`canvas.toBlob`) dengan tombol di halaman.
- Teks hook dibuat otomatis dari angka, contoh: `flow selama 14 menit 20 detik`.

---

## 8. Arsitektur

```
pynput (global) ──┐
browser keydown ──┤
simulator/replay ─┼─> bridge.py (aiohttp: http + ws, port 8770) ─> index.html (OBS Browser Source)
adapter EEG ──────┘
```

Bridge juga menyajikan file statis supaya OBS memakai `http://127.0.0.1:8770/` (menghindari masalah CORS pada ES modules dari `file://` di CEF).

### 8.1 Struktur file

```
typewave/
  index.html
  src/
    main.js              bootstrap, config dari URL, render loop
    input/
      ws.js              klien WebSocket + reconnect
      browserkeys.js
      sim.js
      replay.js
    core/
      metrics.js         IKI, WPM, density, session log
      color.js           OKLab mix, smoothstep
      spring.js          critically damped spring
    render/
      ribbon.js
      beads.js
      keyboard.js
      hud.js
      report.js
    data/
      layout-ansi75.js
  assets/fonts/Anybody-VF.woff2
  bridge/
    bridge.py
    requirements.txt     aiohttp, pynput
  adapters/
    eeg_socketio.py      fase 4
  replay/
    sample-session.json
  TYPEWAVE_SPEC.md
```

Tanpa bundler dan tanpa framework: ES modules polos, Canvas 2D.

### 8.2 Konfigurasi URL

| Param | Nilai | Default |
|---|---|---|
| `layout` | `wide`, `tall`, `auto` | `auto` |
| `transparent` | `0`, `1` | `0` |
| `privacy` | `zone`, `exact` | `zone` |
| `sim` | `0`, `1` | `0` |
| `lang` | `en`, `id` | `en` |
| `ws` | URL WebSocket | `ws://127.0.0.1:8770/ws` |

### 8.3 Pengaturan OBS

Browser Source: URL `http://127.0.0.1:8770/?layout=wide`, lebar 1920, tinggi 1080, FPS 60, "Control audio via OBS" mati. Opsi "Shutdown source when not visible" dimatikan supaya statistik sesi tidak ter-reset.

---

## 9. Privasi dan keamanan

- Yang dikirim hanya kode tombol fisik. Urutan kode secara teori tetap bisa direkonstruksi menjadi teks, karena itu default `privacy=zone`. Mode `exact` dipilih sengaja untuk konten ASMR yang keyboard-nya memang tampil di kamera.
- macOS memblokir listener global di kolom password (secure input), jadi isinya tidak ikut terkirim.
- Hotkey jeda `ctrl+alt+p` di bridge: berhenti meneruskan key dan mengirim `{"t":"ctl","pause":true}`; tekan lagi untuk lanjut. Saat pause, halaman menampilkan indikator kecil.
- Bridge hanya listen di `127.0.0.1`. Tidak ada penyimpanan key ke disk.
- Listener global butuh izin Input Monitoring untuk aplikasi terminal yang menjalankan bridge (System Settings, Privacy & Security, Input Monitoring). Jalankan dari Terminal.app, bukan dari terminal editor yang bisa mematikan proses saat idle.

---

## 10. Performa dan kompatibilitas

- Target frame time ≤ 8 ms di 1920×1080 pada M4 Max, 60 fps stabil di Browser Source OBS (CEF).
- Tanpa alokasi objek di hot path render (pool untuk bead dan titik pita).
- Canvas diatur ke piksel CSS (devicePixelRatio dibatasi 1) agar konsisten di OBS.
- Tanpa WebGL dan tanpa shader berat. Font lokal. Tidak ada request jaringan keluar.

---

## 11. Integrasi EEG (fase 4)

- `adapters/eeg_socketio.py` (python-socketio client) berlangganan ke server EEG yang sudah ada (port 8765) dan meneruskan `{"t":"mind","pos","hr","q"}` ke bridge sekitar 5 Hz.
- **Cek dulu nama field yang benar-benar dikirim `eeg_server.py`** (nilai `spectrum_pos`, HR, kualitas sinyal) sebelum menulis adapter. Jangan berasumsi dari dokumentasi.
- **Bentrok keystroke buatan:** mental command EEG yang aktif menembak keystroke OS (lewat pynput), dan listener global bisa ikut membacanya sebagai ketikan. Dua mitigasi, pilih saat fase 4:
  1. "Typing mode": command dinonaktifkan atau hanya menjadi efek visual.
  2. Adapter mengirim `{"t":"ctl","suppress_ms":150}` setiap command menembak; bridge membuang key event dalam jendela itu.
- Drum engine sebaiknya di-mute saat merekam ASMR, karena mic menangkap suara keyboard.

---

## 12. Fase build dan acceptance criteria

### Fase 1: prototipe visual 16:9 dengan simulator
- Halaman terbuka di `?sim=1&layout=wide` tanpa error konsol.
- Slider `pos` mengubah ground, ink, tepi pita, dan lebar huruf secara halus, tanpa kedip atau lompat.
- Mengetik di halaman memunculkan bead; backspace, space, dan Enter tampil berbeda.
- Idle 3 detik membuat pita istirahat; menghentikan `mind` 5 detik menghasilkan grade netral.
- 60 fps di Chrome pada M4 Max (diukur lewat `requestAnimationFrame`).

### Fase 2: layout 9:16 dan kartu laporan
- `?layout=tall` rapi di 1080×1920 dan elemen penting berada di luar safe zone.
- Kartu laporan tampil dengan angka yang benar untuk sesi replay yang diketahui.
- Ekspor PNG kedua rasio berhasil.

### Fase 3: bridge key global
- Ketikan di aplikasi lain muncul di halaman dengan latensi di bawah 50 ms (subjektif lewat rekaman layar, atau diukur dengan timestamp).
- Hotkey pause bekerja dan terlihat di halaman.
- Reconnect otomatis setelah bridge direstart.
- README singkat berisi langkah izin Input Monitoring.

### Fase 4: adapter EEG dan replay
- Adapter meneruskan data nyata dari server EEG; warna mengikuti kondisi otak.
- `replay/sample-session.json` memutar sesi tanpa headset.
- Mitigasi keystroke buatan dipilih dan diuji.

### Fase 5: uji di OBS dan TikTok Live Studio, tuning
- 60 fps di Browser Source OBS; tampilan sesuai di TikTok Live Studio.
- Tuning parameter bagian 6 berdasarkan rekaman nyata.

---

## 13. Rencana tes

- **Unit (metrics):** timeline sintetis untuk memeriksa WPM, IKI, density, deteksi idle.
- **Visual:** Playwright screenshot per kombinasi `pos` ∈ {0.1, 0.5, 0.9} × layout {wide, tall}, dibandingkan manual terhadap token warna.
- **Integrasi:** kirim pesan `key`/`mind` palsu ke bridge dan pastikan klien menerimanya.
- **Manual:** satu sesi ketik 10 menit; periksa kebocoran memori (heap stabil) dan frame time.

---

## 14. Keputusan terbuka

| Keputusan | Default saat ini |
|---|---|
| Layout yang dibangun lebih dulu | 16:9 (canvas OBS 1920×1080), 9:16 menyusul |
| Privasi default | `zone`; `exact` opsional per sesi |
| Bahasa label | Inggris huruf kecil, `?lang=id` untuk Indonesia |
| Hotkey pause | `ctrl+alt+p` |
| Mitigasi keystroke buatan dari mental command | Ditentukan di fase 4 |
| Drum engine saat rekaman ASMR | Di-mute |
