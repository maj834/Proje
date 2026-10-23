# Borsa Pro — güvenilirlik düzeltmeleri

Bu paket `ccr-f251748e-ir45zy` geliştirme dalı için hazırlanmıştır. Main'e birleştirme veya macOS sürümü yayımlama içermez.

## Değişiklikler

| Bildirilen konu | Bu pakette yapılan | Sınır / kalan doğrulama |
| --- | --- | --- |
| AI yorumları | Kısa yorumda doğrulanamayan sayı içeren cümleler çıkarılır. Grafik yeniden yüklenince eski AI sonucu geçersizleşir; zorla yenileme iç AI önbelleğine de ulaşır. Piyasa ve vadeli/döviz/kripto türü bağlama eklenir. | Sayı kontrolü anlamsal doğruluk garantisi değildir. Canlı sağlayıcıyla kabul testi gerekir. |
| Haberler | Yahoo hatası sessizce boş liste olmaz. NewsAPI anahtar/plan hatasında Yahoo haber döndürürse açık kaynak adı ve ilk hata gösterilerek yedeklenir. | Sağlayıcı kapsamı, lisansı, planı ve kotası değişmez. Yedek kaynak da boşsa hata korunur. |
| Derinlik | Son bakılan hisse yerine hisse bazlı derinlik kullanılır. Eski, gelecek zamanlı ve yanlış hisse verisi elenir. Taze veri olmadan bot isteği başarı sayılmaz. Kart 30 sn'de bir tazelik denetler. | Telegram hesabı/bot aboneliği ve gerçek mesaj biçimiyle uçtan uca kontrol bu ortamda yapılmadı. |
| Analiz hataları | Karma izleme listesi taraması BIST/ABD/kripto için doğru veri yoluna ayrılır; `.US` saklama soneki sağlayıcıya gitmez. BIST tarihsel kalibrasyonu diğer piyasalarda gösterilmez. | Motorun tüm formül ve tahminleri yeniden kalibre edilmedi. |
| %100 güven / negatif SAT skoru | Etiket “Bileşen uyumu” olarak düzeltilir; negatif skorun SAT yönünü, oranın bileşen uyumunu anlattığı açıklanır. | Matematik keyfî olarak değiştirilmedi. %100 uyum, %100 isabet değildir. |
| Değişen sinyaller | Açık mumun değişebileceği ve tarihsel sistem işaretlerinin karar kartıyla aynı kural olmadığı açıklanır; eski AI önbelleği sorunu giderilir. | Canlı fiyat değişince sinyal değişmesi tek başına hata değildir. |
| Günlük / haftalık fark | Farklı vadelerin ters yön verebileceği karar kartında açıklanır. | Vadeler zorla aynı karara çevrilmez. |
| Araç ipuçları | 12 grafik göstergesine ne yaptığını açıklayan hover metni eklenir. | Çizim araçlarının mevcut kullanım ipuçları korunur. |
| Sözlük | Sunucu çevrimdışı olsa da 48 yerel terim gösterilir; uzaktaki terimlerle ada göre tekilleştirilir. | Uzaktaki tanım varsa önceliklidir. |
| Altın ve diğer enstrümanlar | 12 emtia/döviz sembolü arama, izleme ve “Emtia / Döviz” taramasına eklenir. | `GC=F` spot altın değil, ons başına fiyatlanan altın vadeli referansıdır. Kontrat geçişi riski vardır. Vadeli demo işlem altyapısı eklenmedi. |
| Çizgiler | Aynı mumdaki ikinci noktadan yapay bir sonraki-mum çizgisi üretilmez. Tamamen geçmiş aralık dışındaki çizimler ilk muma sabitlenmez. | Farklı mum çözünürlüğüne geçişte iki nokta aynı muma denk gelirse çizgi gizlenir; kayıt silinmez. |
| Orantısız arayüz | 1250/900 px kırılımları, taşan üst menü için yatay gezinme ve dar ekranda alt analiz paneli eklenir. | 1360, 1024 ve 820 px genişliklerinde sentetik veriyle test edildi. |
| USD grafik | TL mumları o anda mevcut son tamamlanmış tarihsel USD/TRY kuruyla çevrilir. TL analiz/emir/başlık değerleri korunur. USD çizimleri ayrı saklanır, TL seviye/plan/alarm katmanları USD'de gizlenir. | OHLC'nin aynı kapanış kuruna bölünmesi yaklaşık karşılaştırmadır; gerçek USD gün içi tepe/dibi değildir. Eşleşmeyen/eski kur mumları elenir. Kur yoksa TL korunur. |

## Testler

- `node --test --test-timeout=120000 test/bp-*.test.js test/engine-pro.test.js test/depth.test.js test/market.test.js`
- `CHROMIUM_PATH=/usr/local/bin/chromium node test/visual/bp-reliability-smoke.js` (Playwright ayrıca bulunmalı.)
- Görsel test: araç açıklamaları, aynı-mum çizim engeli, TL/USD çizim izolasyonu, 1360/1024/820 px, altın araması, yeni tarama evreni, çevrimdışı sözlük. Piyasa verileri sentetiktir.
- Genel test çalıştırmasında Borsa dışındaki `test/lock.test.js:186` salt-okunur-klasör testi bu sandbox'ta beklenen hatayı üretmedi. Aynı test değişikliksiz başlangıç kodunda da aynı noktada başarısız oldu. Kilit modülü/testi bu paket için değiştirilmedi.

## Canlı kabul kontrolü

1. Gerçek macOS uygulamasında Telegram bağlantısı/bot adı ile bir BIST hissesinin derinliğini getir; iki hisse arasında geçip her birinin kendi taze derinliğinin kullanıldığını kontrol et.
2. Geçerli NewsAPI anahtarıyla normal sonuç, plan/kota hatası ve Yahoo yedeğini ayrı dene. Veri kaynağı hatası “haber yok” olarak sunulmamalı.
3. Seçilen AI sağlayıcısında yorum ve rapor üret; fiyat/stop sayıları ile vade/piyasa açıklamasını grafikteki veriyle karşılaştır.
4. TL/USD geçişinde TL analiz ve emir değerlerinin değişmediğini doğrula. Aynı çizimin iki para biriminde karışmadığını dene.
5. Gold futures, petrol, döviz, ABD ve kripto sembollerinin gerçek sağlayıcıda o gün erişilebilirliğini kontrol et. Bu paket erişilebilirlik garantisi vermez.
