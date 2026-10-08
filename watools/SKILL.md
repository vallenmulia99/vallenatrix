---
name: whatsapp
category: messaging
description: Use when user wants to setup, connect, start, stop, check status, or send messages via WhatsApp. Manages WhatsApp daemon and pairing.
---

# WhatsApp Agent Skill (Vallenatrix)

Kontrol WhatsApp dua arah untuk Vallenatrix Agent menggunakan arsitektur Hermes bridge (Baileys/Ourin).

Tool path utama:
`/home/vallenganteng/Destop/vallenatrix/watools/wa-client.js`

Folder sesi:
`~/.vallenatrix/skills/whatsapp/session/`

---

## Aturan Agen (Agent Rules)

1. **JANGAN re-install / uninstall dependencies jika sudah ada**:
   Folder `/home/vallenganteng/Destop/vallenatrix/tools/whatsapp/node_modules` sudah terinstall lengkap dan berfungsi. Jangan pernah jalankan `npm install` atau `npm uninstall` kecuali file `node_modules` benar-benar hilang.

2. **Prosedur Pairing / Sambungkan Nomor Baru**:
   Jika user meminta: *"setup wa"*, *"pasang nomor ini <nomor>"*, atau *"sambungkan wa <nomor>"*:
   - Jalankan perintah:
     ```bash
     node /home/vallenganteng/Destop/vallenatrix/watools/wa-client.js connect <nomor>
     ```
   - Beritahu user kode pairing kustom: **`VALLENMX`**.
   - Berikan instruksi jelas:
     *"Buka WhatsApp di HP > Pengaturan / Titik Tiga > Perangkat Tertaut > Tautkan Perangkat > Tautkan dengan nomor telepon saja > Masukkan kode: VALLENMX"*.
   - **TUNGGU** sampai perintah selesai dan menampilkan status `✅ WHATSAPP TERHUBUNG!`. Jangan tutup giliran sebelum berhasil atau timeout.
   - Konfirmasi ke user begitu terhubung.

3. **Prosedur Start Bot / Daemon**:
   Jika user meminta: *"start bot wa"*, *"nyalakan wa"*, *"aktifkan bot wa"*:
   - Jalankan:
     ```bash
     node /home/vallenganteng/Destop/vallenatrix/watools/wa-client.js start
     ```
   - Lakukan verifikasi cepat status dengan:
     ```bash
     node /home/vallenganteng/Destop/vallenatrix/watools/wa-client.js status
     ```
   - Laporkan ke user: Daemon aktif (PID) dan bot siap menerima perintah dari WhatsApp via prefix `.vallen <prompt>`.

4. **Prosedur Stop Bot / Daemon**:
   Jika user meminta: *"stop bot wa"*, *"matikan wa"*, *"hentikan bot wa"*:
   - Jalankan:
     ```bash
     node /home/vallenganteng/Destop/vallenatrix/watools/wa-client.js stop
     ```
   - Konfirmasi ke user bahwa bot WhatsApp sudah dimatikan.

5. **Prosedur Cek Status / Troubleshooting Pintar**:
   Jika user meminta: *"cek wa"*, *"status wa"*, *"bot wa nyala ga"*:
   - Jalankan:
     ```bash
     node /home/vallenganteng/Destop/vallenatrix/watools/wa-client.js status
     ```
   - Analisis output secara cerdas:
     - **Daemon RUNNING & Session PAIRED**: Beritahu user bot aktif normal beserta nomornya.
     - **Daemon STOPPED tapi Session PAIRED**: Beritahu user sesi ada tapi bot belum dinyalakan, tawarkan untuk `start`.
     - **Session NOT PAIRED**: Beritahu user nomor belum ditautkan, tawarkan untuk jalankan `connect <nomor>`.
     - **Jika ada error log**: Buka `~/.vallenatrix/skills/whatsapp/bridge.log` dan jelaskan penyebab errornya ke user dengan bahasa santai.

6. **Kirim Pesan / Notifikasi**:
   Jika user meminta: *"kirim wa ke <nomor> <pesan>"*:
   - Jalankan:
     ```bash
     node /home/vallenganteng/Destop/vallenatrix/watools/wa-client.js send <nomor> "<pesan>"
     ```
   - Format nomor: sertakan kode negara tanpa spasi/tanda plus (contoh: `6285184755270`).
   - Laporkan ke user bahwa pesan sukses terkirim.
