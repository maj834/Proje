---
name: koloni-oyun-hissi
description: Koloni'de oyun hissi (juice), akicilik, geri bildirim, kamera, hedef/ilerleme ve surukleyicilik ekleme ya da iyilestirme islerinde kullan.
---

# Koloni oyun hissi (juice) rehberi

## Ilkeler
- **Her oyuncu eylemi 100 ms icinde 3 kanaldan geri bildirim alir:** gorsel (parcacik/halka), hareket (tween/olcek), ses.
- **Hicbir sey anlik degismez:** sayilar tween ile sayar, kamera `lerp` ile yaklasir, paneller kayarak/solarak gelir. Varsayilan egri `Tween.TRANS_QUART` + `EASE_OUT`, 0.25–0.4 sn.
- **Kare hizindan bagimsiz yumusatma:** `x = lerp(x, hedef, 1.0 - exp(-hiz * delta))`. Asla `lerp(x, hedef, 0.1)`.
- **Squash & stretch:** yeni yiyecek/olay ogesi 0 -> 1.15 -> 1.0 olcek "pop" ile belirir.
- **Ritim:** onemli an (kilometre tasi, dogum dalgasi) ekran ortasinda kisa toast + ses + hafif kamera nabzi (zoom %2, 0.2 sn). Ekran sarsintisi yalnizca tehdit/olumsuz olaylarda.

## Surukleyicilik dongusu
1. **Kisa hedef** (30-90 sn): bir sonraki kilometre tasi her zaman HUD'da gorunur, ilerleme cubuguyla.
2. **Orta hedef:** kilometre taslari yeni bir sey acar (yeni yetenek, kaynak turu, gorsel degisim).
3. **Merak:** haritada henuz kesfedilmemis kaynaklar; ilk kesifte "Yeni kaynak bulundu!" toast'i.
4. **Oyuncu ajansi:** oyuncu izleri boyayabilir (feromon fircasi) ve yiyecek birakabilir; sonucu birkac saniyede gorur.

## Akicilik kontrol listesi
- `_process` icinde tahsis yok (Array/Dictionary olusturma donguleri disinda tutulur).
- Simulasyon adimi sabit `dt`; gorsel interpolasyon kare basina.
- 60 FPS sabit; `Engine.max_fps = 60`, vsync acik.
- Kamera sinirlari yumusak (hedef sinirlanir, kamera hedefe yaklasir).

## Dogrulama
Yeni geri bildirimi ekran goruntusunde degil, akisinda dusun: tetikleyen kod yolu `tests/` altinda en az bir olay uretiyor mu (or. `sim.events` icinde "pickup")?
