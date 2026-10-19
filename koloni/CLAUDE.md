# Koloni (Godot 4) — Claude için notlar

Bu klasör, depodaki Electron uygulamasından (kök dizin) bağımsız bir Godot 4.4 oyunudur. Kökteki JS dosyalarına dokunma.
Kullanıcıyla Türkçe konuş; kod yorumları Türkçe, ASCII (ş/ğ yerine s/g) — mevcut stile uy.

## Komutlar (koloni/ içinden)
- `./tools/check.sh` — gdformat --check, gdlint, `tests/test_sim.gd`, ana sahnenin 300 kare hatasız dönmesi. Her değişiklikten sonra çalıştır.
- `gdformat scripts tests tools` — biçimlendir.
- `./tools/screenshot.sh /tmp/x.png` — görsel değişiklikten sonra ekran görüntüsü al ve Read ile bak.
- Bulut oturumunda Godot `$GODOT` değişkenindedir (oturum kancası kurar).

## Mimari
- `scripts/colony_sim.gd` — saf simülasyon (RefCounted, tohumla deterministik). Node'a, çizime bağımlı olmamalı; testler onu doğrudan çalıştırır.
- `scripts/pheromone_field.gd` — iki katmanlı float ızgara.
- `scripts/world.gd` — simülasyonu ilerletir, tüm görsel düğümleri kodla kurar (MultiMesh, shader'lar, ışık, parçacık havuzu).
- `scenes/main.tscn` — yalnızca World, Camera, HUD. Yeni görsel katmanlar world.gd'de kurulur.
- `class_name` kullanma; `preload` sabitleri kullan (başsız testler global sınıf önbelleğine güvenmesin).

## Performans kuralları (MacBook Neo, fansız, entegre GPU)
- Karıncalar tek tek Node olmaz; MultiMesh örneğidir. Karınca başına Node/Sprite ekleme.
- Gerçek zamanlı gölgeli ışık, GPUParticles, tam ekran post-process ekleme; gölge = kaydırılmış ikinci MultiMesh.
- Shader'larda sabit döngü sayısı; float dokuda donanım filtresine güvenme (pheromone.gdshader elle bilinear yapar).
- Feromon ızgarası işlemleri 10 Hz; karınca başına iş O(1) kalmalı (yiyecek listesi küçük tutulur).
- Bütçe tablosu: `docs/GDD.md` §7. Bütçeyi aşan değişiklikte GDD'yi güncelle.
