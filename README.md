# Grafik Okuyucu

Ekrandaki fiyat grafiğini (TradingView, Matriks, broker ekranları, tarayıcı…) Claude ile okuyan macOS menü çubuğu uygulaması. Destek/direnç seviyelerini, yönü, formasyonları ve kısa bir yorumu gösterir; seviyeleri doğrudan grafiğin üstüne çizer.

![Ekran görüntüsü](docs/ekran.png)

Demo videosu: [docs/demo.mp4](docs/demo.mp4)

## Özellikler

- **⌘⇧A** ya da menü çubuğu simgesiyle tek tıkla analiz
- Fare imlecinin bulunduğu monitörü okur (çoklu monitör desteği)
- Destek/direnç çizgileri ekrana tıklamayı engellemeyen bir katman olarak çizilir
- **Canlı mod**: 15 sn – 2 dk aralıkla otomatik yeniden okur; ekran değişmediyse istek göndermez
- Model seçimi: Sonnet 5.5 (varsayılan), Opus 5.5, Haiku 5.5
- Son 20 analizin geçmişi
- API anahtarı macOS Anahtar Zinciri destekli `safeStorage` ile şifreli saklanır
- Ekran Kaydı izni yoksa açıklayıcı uyarı ve Sistem Ayarları kısayolu
- Açık/koyu tema uyumlu arayüz, sağ tık menüsü (Analiz / Çizgileri Gizle / Çıkış)

## Geliştirme

```bash
npm install
npm start          # uygulamayı çalıştır
npm run dist       # dist/ altına .dmg üret (macOS)
```

GitHub Actions her push'ta macOS için imzasız bir `.dmg` üretir (Actions › build › Artifacts).

İmzasız uygulamayı ilk açışta Finder'da sağ tık › **Aç** demen gerekir. Her yeni derlemede Ekran Kaydı iznini yeniden vermen gerekebilir.

## Dosyalar

| Dosya | Görev |
|---|---|
| `main.js` | Menü çubuğu, kısayol, ekran görüntüsü, Claude API isteği, ayarlar |
| `preload.js` | Pencerelere açılan sınırlı API |
| `popup.html` | Menü çubuğu penceresi (Analiz / Geçmiş / Ayarlar) |
| `overlay.html` | Ekrana çizilen destek/direnç katmanı |

> Bu uygulama yatırım tavsiyesi vermez; model çıktıları hatalı olabilir.
