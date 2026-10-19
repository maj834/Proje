---
name: koloni-godot
description: Koloni karinca oyununda (koloni/ klasoru, Godot 4) ozellik ekleme, gorsel/shader degisikligi, performans ayari veya test calistirma isteklerinde kullan.
---

# Koloni'de calisma

1. Once `koloni/CLAUDE.md` ve gerekirse `koloni/docs/GDD.md` oku (mimari, performans butcesi, kilometre taslari).
2. Davranis degisikligi -> `scripts/colony_sim.gd` (saf, deterministik). Once `tests/test_sim.gd`'ye bir `_test_...` ekle, sonra uygula.
3. Gorsel degisiklik -> `scripts/world.gd` + `shaders/`. Karinca basina Node ekleme; MultiMesh ornek verisi kullan.
4. Dogrula:
   - `cd koloni && ./tools/check.sh` temiz olmali (lint, bicim, testler, sahne).
   - Gorsel degistiyse `./tools/screenshot.sh /tmp/koloni.png` ve PNG'ye Read ile bak; begenirsen `docs/ekran.png`'yi yenile.
5. Performans: GDD §7 butcesi. Yeni tam ekran shader, gercek zamanli golge, GPUParticles ya da 10 Hz'den sik izgara islemi eklemeden once butceyi tartis.
6. Kilometre tasi tamamlandiysa GDD §4 tablosunu ve §9'u guncelle.

Godot yolu: `$GODOT` (bulutta oturum kancasi kurar). Yerelde `GODOT=/Applications/Godot.app/Contents/MacOS/Godot`.
