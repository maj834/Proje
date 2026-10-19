---
name: koloni-arayuz-ses
description: Koloni'de HUD, menu, bildirim (toast), ikon, yazi tipi ve ses efekti/ambiyans ekleme veya duzenleme islerinde kullan.
---

# Koloni arayuz ve ses rehberi

## Arayuz
- **Dil:** Turkce, kisa. Sayilar `1.234` bicimi (binlik nokta).
- **Yerlesim:** sol ust kaynak paneli (karinca, depo, dakika basina gelir), ust orta kilometre tasi kartlari ve ilerleme cubugu, alt orta kontrol ipuclari (ilk 20 sn gorunur, sonra solar; H ile geri gelir), sag ust hiz/duraklat gostergesi.
- **Gorunum:** koyu yari saydam paneller (`#0d0906` %75), 10 px kose yuvarlama, 1 px sicak kenar (`#ffb53a` %25). Vurgu rengi altin `#ffb53a`, ikincil mavi `#4aa3ff`. Metin `#f5e6c8`.
- **Ikonlar:** dosya yerine `_draw` ile basit sekiller (karinca silueti, yiyecek tanesi) — net ve olceklenebilir.
- **Toast:** ekran ortasi ustte, 2.5 sn, kayarak gelir ve solar; ayni anda en fazla 1 (kuyruk).
- Retina: `canvas_items` stretch, yazilar en az 14 px.

## Ses
- Sesler `koloni/audio/` altinda WAV (22.05 kHz, mono; efekt < 100 KB, 6 sn ambiyans dongusu < 300 KB). `tools/gen_audio.py` ile prosedurel uretilir; elle duzenleme yok, betigi degistir ve yeniden uret.
- Ses havuzu: 6 `AudioStreamPlayer`, ayni ses 80 ms icinde tekrar calmaz (spam engeli), her calista perde +-%8 rastgele.
- Seviyeler: ambiyans -18 dB, olay sesi -10 dB, UI -8 dB, kilometre tasi -6 dB.
- Ambiyans: gunduz ruzgar/yaprak hisirtisi, gece cirdir bocegi; gece faktoruyle capraz gecis.
- Ses yoksa (bulut/CI) oyun hata vermeden calismali.

## Dogrulama
`./tools/check.sh` (ses dosyalari eksikse sahne hata verir). Panel yerlesimini ekran goruntusunde 1280x720'de kontrol et; hicbir panel ust uste binmemeli.
