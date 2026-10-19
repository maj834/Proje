# Koloni

MacBook Neo için tasarlanan, üstten görünümlü karınca kolonisi simülasyonu (Godot 4.4+).
Tasarım belgesi: [docs/GDD.md](docs/GDD.md).

![Ekran](docs/ekran.png)

## Çalıştırma
1. [Godot 4.4+](https://godotengine.org/download/macos/) indirin.
2. Godot'da **Import** → bu klasördeki `project.godot`.
3. F5 ile oynatın.

Kontroller: sol tık yiyecek bırak, Shift+sürükle (veya F) feromon fırçası, P izler, Boşluk duraklat, Q/E hız, WASD / sağ tık / trackpad kamera, H ipuçları.

## Geliştirme
```bash
./tools/check.sh        # gdformat + gdlint + simülasyon testleri + sahne kontrolü
./tools/screenshot.sh   # docs/ekran.png'yi yeniler (2. argüman: günün saati, 0.04 = gece)
python3 tools/gen_audio.py  # audio/*.wav seslerini yeniden üretir
```
`GODOT` ortam değişkeni Godot çalıştırılabilir dosyasını gösterir (varsayılan `godot`). Lint için `pip install "gdtoolkit==4.*"`.
