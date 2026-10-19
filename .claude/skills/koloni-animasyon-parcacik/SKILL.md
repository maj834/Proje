---
name: koloni-animasyon-parcacik
description: Koloni'de karinca animasyonu (bacak/yurume), parcacik efektleri, atmosfer (ates bocegi, toz, yaprak) ve vertex shader animasyonu islerinde kullan.
---

# Koloni animasyon ve parcacik rehberi

## Karinca animasyonu (GPU'da, CPU maliyeti sifir)
- Karinca mesh'i tek yuzey; **bacak koseleri vertex renginin alfa kanalinda isaretlenir** (govde a=1, sol bacak a=0.5, sag bacak a=0.0 gibi) ve UV.x'te bacak ucu agirligi tasinir.
- Vertex shader bacaklari `sin(TIME * adim_hizi + faz)` ile ileri-geri doner; sol/sag tripod ters fazda (gercek karinca yurumesi: 3'lu tripod).
- Karinca basina faz `INSTANCE_CUSTOM.x`, hiz `INSTANCE_CUSTOM.y` (MultiMesh `use_custom_data = true`). Duran karinca bacak sallamaz.
- Govde hafifce yalpalar (abdomen +-0.3 px). Fazla abartma: 9-14 px karincada 1 px okunur.

## Parcacik butcesi
| Efekt | Dugum | Adet | Not |
|---|---|---|---|
| Yiyecek alma kivilcimi | CPUParticles2D havuzu (16) | 8 | 0.5 sn, altin |
| Dogum halkasi + kivilcim | ayni havuz | 12 | mavi |
| Ates bocegi (gece) | 1 CPUParticles2D, dunya boyu | 40 | alfa gece faktoruyle |
| Toz zerresi (gunduz) | 1 CPUParticles2D | 30 | yavas suzulme, ışıkta parlar |
| Tiklama halkasi | Line2D/draw_arc + tween | 1 | 0.4 sn genisler ve solar |

- Her zaman `CPUParticles2D` (GPUParticles derleme takilmasi ve entegre GPU maliyeti yok).
- Surekli efektlerde `local_coords = false`, `preprocess` ile sahne acilisinda dolu gorunsun.
- Parcacik dokusu: tek seferlik uretilen 16x16 yumusak daire (`Image` -> `ImageTexture`), tum efektler paylasir.

## Tween animasyonlari
- Yiyecek birakma: olcek pop 0 -> 1.15 -> 1.
- Dogum: yuvada genisleyen halka (`draw_arc`), 0.5 sn.
- HUD sayaclari: deger tween ile sayar.

## Dogrulama
Animasyon icin iki farkli `TIME`'da ekran goruntusu almak yerine shader kodunu oku: faz ve hiz `INSTANCE_CUSTOM`'dan mi geliyor, duran karinca icin hiz 0 mi?
