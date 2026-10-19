---
name: koloni-gorsel-stil
description: Koloni oyununda zemin, karinca, yuva, yiyecek, isik veya shader gorunumunu degistirirken/iyilestirirken kullan; sanat yonu, palet ve hafif shader kurallari.
---

# Koloni gorsel stil rehberi

## Sanat yonu: "makro fotograf, sicak orman zemini"
Kamera topraga 10 cm'den bakan bir makro lens gibi. Okunurluk > gerceklik.
- **Deger hiyerarsisi:** zemin orta-koyu ve dusuk kontrast; karincalar en koyu deger + ince parlak kenar; yiyecek ve feromon en parlak ve doygun ogeler. Oyuncunun gozu once izlere, sonra yiyecege, sonra karincaya gitmeli.
- **Palet** (lineer degil, sRGB):
  - Toprak: `#2a1c12` (golge) `#4a3322` (orta) `#6e5034` (isik)
  - Yosun/cimen: `#3d4a1f` `#5f7a2a`
  - Karinca: `#140d08` govde, `#5a3a22` parlak kenar; yuklu karinca `#d9a441` yuk
  - Yiyecek izi: `#ffb53a` | Yuva izi: `#4aa3ff` | Dogum: `#9fe8ff`
  - Gece tonu `#3a4778`, gun batimi `#ffc49a`
- **Isik yonu sabit:** sol-ust (`vec2(-0.6,-0.8)`). Tum prosedurel golge ve parlaklar buna uyar; golgeler sag-alta duser (+1.5,+2 px).
- **Katmanlar (z):** zemin -10, dekor (yaprak/dal/tas) -8, feromon -5, yiyecek 0, yuva 0, golge 1, karinca 2, parcacik 3, kanopi golgesi 5, ekran efektleri (CanvasLayer).

## Kalite icin ucuz hileler
1. **Derinlik:** her nesneye yumusak golge (ofsetli, %25-35 siyah). Tek MultiMesh kopyasi = bedava golge.
2. **Kenar isigi (rim):** govde ustune isik yonunde 1 px acik ton; shader'da `dot(normal_yaklasik, isik)`.
3. **Ortam kapatma (AO):** yuva cevresi, taslarin dibi koyulasir — radyal gradyan, ek gecis yok.
4. **Kanopi golgesi:** ekran boyu animasyonlu gurultu ile carpma (`blend_mul`) — sahneye "canli" hissi verir, tek gecis.
5. **Vinyet:** `blend_mul` tek gecis, ekran okumasi yok; kenarlar ~%30 koyu ve hafif soguk.
6. **Dekor bir kez cizilir:** yaprak, dal, tas `_draw` ile bir kez; `queue_redraw` cagirma.

## Performans siniri (MacBook Neo)
- Tam ekran gecis en fazla 4 (zemin, feromon, kanopi, vinyet); hicbiri ekran dokusu okumaz. Shader'da dongu <= 4 oktav.
- Doku olusturmak yerine prosedurel; gerekiyorsa tek seferlik `Image` uret, `ImageTexture` olarak sakla.
- Gercek zamanli `LightOccluder2D` golgesi yok.

## Dogrulama
`cd koloni && ./tools/screenshot.sh /tmp/k.png` ve Read ile bak. Kontrol listesi: izler zeminden ayriliyor mu, karinca 100% zoom'da sekli okunuyor mu, gece de okunurluk korunuyor mu.
