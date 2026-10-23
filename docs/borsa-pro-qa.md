# Borsa Pro kontrol raporu

Bu rapor gerçek kullanıcı hesabı olmayan Linux test ortamında ve GitHub Actions macOS çalıştırıcısında yapılan kontrolleri ayırır. Test verisiyle geçen bir kontrol canlı sağlayıcı garantisi değildir. Main'e merge edilmedi.

## Kontrolde bulunan ek hata

USD grafikte sanal hesap fiyatı/asenkron özet yenilenince TL maliyet ve bekleyen emir katmanları yeniden çizilebiliyordu. Önce `TRY demo costs must stay hidden after async USD updates` kontrolüyle hata üretildi (USD grafiğe `DEMO maliyet: 400` katmanı geldi). `demoOverlays()` için USD koruması eklendi; aynı kontrol ve mevcut demo işlemleri yeniden geçti.

## Son yerel sonuçlar

- GitHub ile aynı **Node 22** altında ilgili paket: **319/319 test başarılı**.
- Tüm uygulama: **693 test; 692 başarılı, 1 başarısız**. Değişikliksiz kaynakta da aynı yerde başarısız olan `test/lock.test.js:186` salt-okunur-klasör kontrolü sandbox dosya izin davranışına takılıyor. Test atlanmadı veya değiştirilmedi.
- Grafik etkileşim testi: beş çizim aracı, aynı-mum koruması, geri al/temizle, 12 gösterge katmanını aç-kapat, yakınlaştır/uzaklaştır, günlük/haftalık geçişi, TL/USD çizim ayrımı, asenkron demo katmanı ayrımı, 1360/1024/820 px düzeni, altın araması, emtia/döviz tarama düğmesi, çevrimdışı sözlük başarılı; yakalanan JS hatası yok.
- Demo etkileşim testi: alım, bekleyen limit satış, fazla satışın engellenmesi, iptal, hesap ekranından satış, limit dolumu, komisyon ayarı, ABD hesabı, hesap sıfırlama ve 1024/1360 px düzeni başarılı; yakalanan JS hatası yok.
- Eski demo görsel testinin boş miktarla etkin emir düğmesi beklediği ve artık kullanılmayan `select` öğelerine yöneldiği görüldü. Test güncel miktar doğrulaması ve düğme gruplarına uyarlandı; üretim işlem doğrulaması gevşetilmedi.

## 13 konuya göre kapsam

| Konu | Kontrol sonucu | Canlı / kullanıcı ortamında eksik olan |
| --- | --- | --- |
| AI yorumları | Sayı denetimi, eski önbelleği geçersizleştirme, zorla yenileme ve piyasa türü testleri geçti. | Gerçek Groq/Claude/Grok cevabının içerik kabulü: kullanıcı API anahtarı yok. Anlamsal doğruluk garantisi değil. |
| Haberler | Kaynak hatası ve Yahoo yedeği hata senaryoları geçti. | Canlı Yahoo haber istekleri 429; kullanıcı NewsAPI planı/anahtarıyla test edilmedi. |
| Derinlik | Tazelik, yanlış hisse, gelecek saat, boş başarı ve hisseye özgü veri seçimi kontrolleri mevcut. | Gerçek Telegram hesabı/bot yanıtı yok; bağlandı/çalışıyor denemez. |
| Analiz hataları | 319 ilgili test geçti; karma piyasa veri yolları ve BIST kalibrasyon kapsamı kontrol edildi. | Modelin tüm tahminleri yeniden kalibre edilmedi; gerçek fiyat akışında uçtan uca kabul açık. |
| %100 / negatif SAT | Negatif skor-yön ve bileşen uyumu ayrımı testi geçti; motor matematiği keyfî değiştirilmedi. | Uyum başarı olasılığı değildir. |
| Değişen sinyaller | Açık mum, teknik işaret/karar ayrımı ve AI önbelleği davranışı kontrol edildi. | Her canlı sinyal değişiminin doğruluğu gözlemlenmedi. |
| Günlük/haftalık | İki dilim arasında arayüz geçişi ve vade açıklaması test edildi. | Aynı yöne zorlanmadı; farklı vadelerde zıt karar normal olabilir. |
| Araç açıklamaları | 12 katmanda açıklama bulundu; aç-kapat işlemleri geçti. | Gerçek Mac üzerinde fare kullanımının kullanıcı kabulü açık. |
| Sözlük | Sunucu hata verirken 48 yerel terim görüntülendi, arama yapısı kontrol edildi. | Uzak okul verisinin o günkü içeriği kontrol edilmedi. |
| Altın/diğer araçlar | 12 emtia/döviz sembolü arama/izleme/tarama kod yolunda test edildi. | Tüm canlı fiyat istekleri 429; sembol erişilebilirliği doğrulanamadı. `GC=F` spot değil vadeli referanstır. |
| Çizgiler | Beş araç, aynı-mum koruması, geri al/temizle ve TL/USD ayrımı geçti. | Her tarih aralığı/çözünürlük birleşimi tüketilmedi. |
| Arayüz | 1360/1024/820 px grafik ve 1024/1360 px demo kontrolü geçti. | Kullanıcının ekran ölçeklendirmesi/tema/çoklu ekran kombinasyonları kontrol edilmedi. |
| USD grafik | Tarihsel kur eşleşmesi, gelecek kur kullanmama, eksik/eski kur, TL analizini koruma ve demo katman ayrımı geçti. | Canlı tarihsel FX 429; grafik yaklaşık dönüşümdür, gerçek USD gün içi tepe/dibi değil. |

## Canlı sağlayıcı denemesi

`market.candles` ile THYAO, AAPL, BTC-USD ve 12 emtia/döviz sembolü; `market.yahooNews` ile THYAO/AAPL denendi. Toplam **17 isteğin tamamı** sağlayıcıdan **HTTP 429** aldı. Bu, kodun başarılı olduğu veya sembollerin geçersiz olduğu sonucu değildir. İstek sınırını aşmaya çalışmak yerine yeni denemeler durduruldu. Kullanıcıya ait API anahtarı veya Telegram oturumu aranmadı/okunmadı.

## macOS / CI durumu

`75d8a53` üzerindeki GitHub macOS işinde birim testleri, macOS entegrasyon testleri, Swift yardımcı derlemeleri ve `electron-builder` başarılıydı. Rapor hazırlanırken paketlenmiş uygulamanın açılış kontrolü sürüyordu. Daha önce başarısız olan bir Mac birim test çalıştırması tekrar üretilemedi; kök nedeni kanıtsız biçimde bu pakete veya ortama atfedilmedi. Hata ayrıntılarının check annotations içinde görülmesi sağlandı; başarısız testler hâlâ işi durdurur.

Son USD katman düzeltmesi bu CI çalıştırmasından sonra yapıldı; yeni commit için CI sonucu PR kontrol panelinden ayrıca izlenmelidir. Yerel grafik ve 319 ilgili test bu son düzeltmeyle yeniden geçti.

## Tekrar çalıştırma

```bash
node --test --test-timeout=120000 test/bp-*.test.js test/engine-pro.test.js test/depth.test.js test/market.test.js
CHROMIUM_PATH=/usr/local/bin/chromium node test/visual/bp-reliability-smoke.js
CHROMIUM_PATH=/usr/local/bin/chromium node test/visual/bp-demo-smoke.js
```

Görsel testler ayrıca Playwright ve Chromium gerektirir; broker'a gerçek emir göndermez. Canlı Telegram/API kabulü ve kullanıcının gerçek Mac uygulamasında son kontrol yapılmadan “tüm sorunlar tamamen giderildi” kabulü verilmemelidir.
