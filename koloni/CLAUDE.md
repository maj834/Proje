# Koloni (Godot 4) — Claude için notlar

Bu klasör, depodaki Electron uygulamasından (kök dizin) bağımsız bir Godot 4.4 oyunudur. Kökteki JS dosyalarına dokunma.
Kullanıcıyla Türkçe konuş; kod yorumları Türkçe, ASCII (ş/ğ yerine s/g) — mevcut stile uy. Oyuncuya görünen metinler ise gerçek Türkçe karakterlerle ve doğal dille yazılır (bkz. koloni-arayuz-ses).

## Komutlar (koloni/ içinden)
- `./tools/check.sh` — gdformat --check, gdlint, `tests/test_sim.gd`, ana sahnenin 300 kare hatasız dönmesi. Her değişiklikten sonra çalıştır.
- `gdformat scripts tests tools` — biçimlendir.
- `godot --headless --path . --fixed-fps 60 --script res://tests/autoplay.gd` — bot demoyu baştan sona oynar; denge değişikliğinden sonra çalıştır (birkaç dakika sürer).
- `godot --headless --path . --export-release macOS build/Koloni-macOS.zip` — Mac demosu (export şablonları gerekir).
- `./tools/screenshot.sh /tmp/x.png` — görsel değişiklikten sonra ekran görüntüsü al ve Read ile bak.
- Bulut oturumunda Godot `$GODOT` değişkenindedir (oturum kancası kurar).

## Skill'ler (ilgili iste once yukle)
- `koloni-godot` genel akis ve dogrulama
- `koloni-gorsel-stil` palet, isik yonu, katmanlar, shader butcesi
- `koloni-oyun-hissi` geri bildirim, kamera, hedefler
- `koloni-animasyon-parcacik` yurume animasyonu, parcacik butcesi
- `koloni-arayuz-ses` HUD, bildirim, ses uretimi (`tools/gen_audio.py`)

## Mimari
- `scripts/colony_sim.gd` — saf simülasyon (RefCounted, tohumla deterministik). Node'a, çizime bağımlı olmamalı; testler onu doğrudan çalıştırır.
- `scripts/pheromone_field.gd` — iki katmanlı float ızgara.
- `scripts/progression.gd` — 5 demo bolumu (saf veri). `scripts/economy.gd` — kiler harcamalari.
- `scripts/spider_view.gd` — orumcek cizimi; orumcek ve asker mantigi colony_sim.gd icinde.
- `scripts/world.gd` — simulasyonu ilerletir, katmanlari kurar, sim olaylarini efekt/ses/bildirime cevirir.
- Gorsel katmanlar: `ant_swarm.gd` (MultiMesh + tampon), `decor.gd`, `food_layer.gd`, `fx.gd` (parcacik, halka, yazi, atmosfer), `audio.gd`, `hud.gd` (arayuz kodla kurulur).
- `scenes/main.tscn` — yalnizca World, Camera, HUD.
- `class_name` kullanma; `preload` sabitleri kullan (başsız testler global sınıf önbelleğine güvenmesin).

## Performans kuralları (MacBook Neo, fansız, entegre GPU)
- Karıncalar tek tek Node olmaz; MultiMesh örneğidir. Karınca başına Node/Sprite ekleme.
- Gerçek zamanlı gölgeli ışık, GPUParticles, ekran okuyan post-process ekleme; gölge = kaydırılmış ikinci MultiMesh. Tam ekran geçiş en fazla 4.
- Shader'larda sabit döngü sayısı; float dokuda donanım filtresine güvenme (pheromone.gdshader elle bilinear yapar).
- Feromon ızgarası işlemleri 10 Hz; karınca başına iş O(1) kalmalı (yiyecek listesi küçük tutulur).
- Bütçe tablosu: `docs/GDD.md` §7. Bütçeyi aşan değişiklikte GDD'yi güncelle.
