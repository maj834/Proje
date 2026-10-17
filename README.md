# Grafik Okuyucu

Ekrandaki fiyat grafiğini (TradingView, Matriks, broker ekranları, tarayıcı…) okuyan macOS menü çubuğu uygulaması. Destek/direnç seviyelerini, trend çizgilerini, yönü ve formasyonları bulur; hepsini doğrudan grafiğin üstüne çizer. Ekrana kendi çizimlerini de yapabilirsin.

![Claude analizi ve çizimler](docs/ekran.png)

Tanıtım videosu (seslendirmeli): [docs/demo.mp4](docs/demo.mp4)

## İki analiz motoru

| | ⚡ Hızlı (yerel) | ✦ Claude AI |
|---|---|---|
| Ücret | **Ücretsiz**, API anahtarı gerekmez | Analiz başına ~$0,001 (Haiku 5.5) |
| Hız | Anında, çevrimdışı | 2–6 sn |
| Ne okur | Mumların konumu: destek/direnç (temas sayısıyla), trend çizgileri, trend yönü, ikili tepe/dip, kırılım | Ayrıca fiyat ekseni, sembol, zaman dilimi, formasyonlar ve yorum |
| Canlı mod | Varsayılan; her 2 sn | İsteğe bağlı (Ayarlar › Canlı modda Claude kullan) |

Hızlı motor yeşil/kırmızı mum grafiklerinde çalışır; çizgi grafikler için Claude kullan.

### Claude için ücret

Claude API aylık abonelik değil, **önceden ödemeli kredi** ile çalışır:

1. [console.anthropic.com](https://console.anthropic.com) adresinde hesap aç.
2. **Billing** bölümünden tek seferlik kredi yükle (en az $5).
3. **API Keys** bölümünden anahtar oluştur ve uygulamada Ayarlar sekmesine yapıştır.

Varsayılan model Haiku 5.5 ile $5 kabaca 4.000–5.000 analize yeter. Uygulama bu ayki harcamayı Ayarlar sekmesinde gösterir. claude.ai Pro aboneliği API kredisi içermez.

## Piyasa verisi (Claude gerekmez)

Analiz sekmesinin üstüne hisse kodunu (ör. `THYAO`), zaman dilimini ve borsayı (BIST/ABD) yaz, **Piyasa verisi** motorunu seç:

- **Yahoo Finance** (anahtarsız): mum verisi ve haberler. BIST kodları otomatik `.IS` alır; veriler ~15 dk gecikmelidir. Yahoo'nun bu uçları resmi bir API değildir, istekler önbelleklenir.
- **Alpha Vantage** (isteğe bağlı, Ayarlar'a anahtar): ABD hisselerinde haber + duygu skoru ve yedek fiyat. Ücretsiz plan günde 25 istek; uygulama sayar, sınırda durur. BIST'te kota harcanmaz.
- **Fiyat ölçeği:** Ekrandaki mumlar gerçek mumlarla eşleştirilir (en iyi kaydırma + doğrusal uyum, r² ≥ 0,97). Eşleşince destek/direnç, derinlik duvarları, Fibonacci, ölçüm ve alarm çizgileri gerçek fiyatla etiketlenir. Grafiğin zaman dilimi seçimle aynı olmalı.
- **Gerçek veriden analiz:** RSI, MACD, EMA, skor ve AL/SAT sinyalleri gerçek fiyatlardan, tarihleriyle hesaplanır; geçmiş sinyallerin 5 mum sonra doğru çıkma oranı gösterilir (komisyon/kayma hariç, tavsiye değildir).

## Grok (xAI) ile görsel okuma (isteğe bağlı)

Ayarlar › **Grok (xAI) anahtarı** kartına anahtarı gir, **Modelleri getir** ile hesabındaki görsel destekli modelleri listele (boş bırakılırsa en uygun model otomatik seçilir). Analiz sekmesinde **Grok** motorunu seçince grafik görsel olarak okunur: sembol, fiyat ekseni ölçeği, destek/direnç, formasyonlar ve Türkçe yorum; yerel indikatörler ve teknik skorla birleştirilir. Ekrandan derinlik okuma ve bot resimleri de Grok ile çalışır. Canlı mod varsayılan olarak ücretsiz motorla çalışır; Grok yalnızca seçilince ya da ayarda açılınca kullanılır. Anahtar Anahtar Zinciri ile şifreli saklanır.

## Analiz

Her analizde (Hızlı ve Claude) şunlar hesaplanır:

- **Destek / direnç** seviyeleri ve temas sayıları, **trend çizgileri**
- **İndikatörler:** RSI (14), MACD (12, 26, 9), EMA 20/50, Bollinger (20, 2)
- **Mum formasyonları:** yutan boğa/ayı, çekiç, kayan yıldız, sabah/akşam yıldızı, doji
- **RSI uyumsuzluğu**, ikili tepe/dip, kırılım tespiti
- **Otomatik Fibonacci** (son büyük salınım)
- **Teknik görünüm skoru** (-100…+100) ve her faktörün katkısı
- **Risk/ödül oranı** (en yakın direnç ve destek arası)

Fiyat ekseni okunmadan, mumların ekrandaki konumundan hesaplanır; EMA, Bollinger, MACD ve RSI bu dönüşümden etkilenmez. Claude analizi fiyatları ekler ve skora kendi yorumunu katar.

## Merkez ve diğer özellikler

Uygulama açılınca **Merkez** penceresi gelir (Dock simgesinden de açılır). Her özellik buradan açılıp kapatılır; kapalı özellik menü çubuğunda görünmez ve arka planda çalışmaz.

- **Ses:** her uygulamanın sesi ayrı (%0–200), bas/tiz, hazır efektler (Bas, Ekstra bas, Konuşma, Tiz, Yükselt, Gece), çıkış aygıtı ve ana ses. macOS 14.4+ gerekir; ilk kullanımda "Ekran ve Sistem Sesi Kaydı" izni istenir. Ayarı olmayan uygulamanın sesine dokunulmaz.
- **Temizlik:** birebir aynı dosyaları bulur (boyut + tam SHA-256; sabit bağlantılar kopya sayılmaz) ve seçtiklerini **yalnızca Çöp Sepeti'ne** taşır; her gruptan en az bir kopya mutlaka kalır. Sistem temizliği yalnızca yeniden oluşturulan önbellekleri, 7 günden eski günlükleri, geliştirici önbelleklerini, 30 günden eski kurulum dosyalarını ve boş klasörleri listeler; açık uygulamaların ve iCloud/Safari/Anahtar Zinciri gibi sistem önbelleklerinin hiçbirine dokunulmaz. Hiçbir şey seçip onaylamadan kaldırılmaz; her işlem `temizlik-kaydi.jsonl` dosyasına yazılır.

- **Dosya Kilidi:** seçtiğin dosyalar AES-256-GCM ile şifrelenir (`dosya.jpg` → `dosya.jpg.kilitli`); asıl dosya ancak şifreli kopya tamamen yazılıp çözülerek doğrulandıktan sonra kaldırılır. Açmak, kilidi kaldırmak ya da silmek Touch ID veya kasa şifresi ister. Şifre aynı zamanda kurtarma yoludur: unutulursa ve Touch ID de çalışmazsa dosyalar açılamaz. Kilitli dosyaya macOS "Kilitli" bayrağı konur (Finder silmeden önce uyarır); ancak macOS'ta dosya sahibinin silmesini tamamen engellemek mümkün değildir, içerik her durumda şifreli kalır. 5 dakika işlem olmazsa kasa kendiliğinden kilitlenir.

## Telefonla dosya paylaşımı (QR)

Menü çubuğu penceresindeki telefon simgesi ya da sağ tık › **Telefonla Dosya Paylaş (QR)**. Açılan penceredeki QR'ı telefonun kamerasıyla okut; telefonun kendi tarayıcısında bir sayfa açılır. **iPhone, Android ve iPad'de çalışır, telefona uygulama kurmak gerekmez.**

- **Mac → telefon:** dosyaları pencereye sürükle ya da **Dosya seç**; telefondaki sayfada **İndir** görünür (liste kendiliğinden güncellenir).
- **Telefon → Mac:** sayfadaki **Dosya seç** ile fotoğraf, video ya da herhangi bir dosya gönderilir. İlk gönderimde Mac'te onay sorulur; dosyalar **İndirilenler** klasörüne kaydedilir.
- **Boyut sınırı yok:** dosyalar diskten akıtılır (50 GB'lık video da olur); yalnızca alıcı cihazdaki boş alan sınırdır. Yarıda kalan indirme kaldığı yerden devam eder.
- **Güvenlik:** her paylaşımda tahmin edilemeyen yeni bir adres; dosyalar internete çıkmaz, yalnızca yerel ağda gider; 10 dakika işlem olmazsa ya da pencere kapanınca paylaşım kapanır. Telefon ile Mac aynı Wi-Fi'da olmalı (ya da telefon Mac'in kişisel erişim noktasına bağlı). Ortak kafe/otel ağlarında kullanma.
- İlk kullanımda macOS "gelen bağlantılara izin verilsin mi" diye sorabilir: **İzin Ver**.

## Telegram derinlik botu

Kullandığın Telegram derinlik botunu uygulamaya bağlayabilirsin:

1. [my.telegram.org](https://my.telegram.org) › **API development tools** bölümünden `api_id` ve `api_hash` al.
2. Ayarlar › **Telegram derinlik botu** kartına bunları, botun kullanıcı adını ve komutu yaz (`{KOD}` hisse koduyla değişir; BOPT için bot `@b0pt_bot`, derinlik komutu `/derinlik {KOD}`, AKD komutu `/akd {KOD}`, işlem komutu `/islem {KOD}`), **Bağlan**'a bas. Telegram'a gelen kodu gir.
3. **Derinlik** sekmesinde hisse kodunu yazıp **Getir**'e bas ya da otomatik yenilemeyi aç.

Uygulama bota senin hesabınla mesaj atar, cevabı ayrıştırır ve:

- **Derinlik kademeleri**, **aracı kurum dağılımı** (alıcılar/satıcılar) ve **gerçekleşen işlemleri** listeler
- Grafikte biriken emirlere **"▲ Alış duvarı 4,3M lot @ 12,13"** gibi etiketler, en çok alan/satan kurumun **maliyet çizgisini** çizer (fiyat ölçeği piyasa verisinden ya da Grok/Claude analizinden gelir)
- **Al/sat baskısını** (-100…+100) derinlik dengesi, alış/satış oranı, kurum net akışı ve işlemlerden hesaplar; her yenilemede kaydedip **trendini** gösterir ("Alış baskısı artıyor")
- Bot tabloyu **resim** olarak gönderirse (BOPT) resmi Mac'te ücretsiz ve internetsiz okur (yerel yazı tanıma, ~1 sn): alış/satış kademeleri, tavan/taban, hacim, ağırlıklı ortalama. Okunamazsa Grok/Claude yedek olarak devreye girer
- Kurum dağılımı derinlik mesajında yoksa **AKD komutunu** da sorar (hisse başına en fazla 2 dakikada bir, derinlikten birkaç saniye sonra) ve net alıcı/satıcı kurumları, lotlarını, maliyetlerini ve oranlarını resimden okur
- **Gerçekleşen işlemleri** de sorar (hisse başına en fazla dakikada bir): saat, fiyat, adet, hacim, alan ve satan kurum; satır rengi aktif alış (yeşil) ya da aktif satışı (kırmızı) gösterir ve al/sat baskısına katılır
- Botun menüsündeki **Canlı Veri** web uygulamasını Derinlik sekmesindeki butonla uygulama içinde açar

Telegram yoksa **Ekrandan** kaynağı, açık olan derinlik terminalini Grok ya da Claude ile okur. Oturum ve `api_hash` Anahtar Zinciri ile şifreli saklanır.

## Al/Sat işaretleri

Grafikte trendin döndüğü mumlara **AL** (yeşil, mumun altında) ve **SAT** (kırmızı, üstünde) işaretleri konur: EMA20/50 kesişimi, MACD dönüşü, RSI'nin aşırı bölgelerden çıkışı ve 12 mumluk zirve/dip kırılımları birlikte değerlendirilir, EMA50 yönüne ters zayıf sinyaller elenir. Son mumdaki **canlı işaret**, teknik skoru Telegram'dan gelen al/sat baskısı, baskı trendi ve kurum akışıyla ("Bank of America topluyor") birleştirir. Teknik sinyaldir, yatırım tavsiyesi değildir.

**Canlı takip:** Derinlik sekmesinde *Canlı takip › Sürekli* seçilince seans boyunca her ~45 saniyede bota tek bir istek gider; sırayla en eskimiş veri yenilenir (işlemler ~45 sn, derinlik ~1 dk, AKD ~3 dk). Gün içindeki işlemler birikir ve **işlem akışı** hesaplanır: son 5/15 dakikada aktif alış ile aktif satış oranı, fiyatın hacim ağırlıklı ortalamaya (VWAP) göre yeri, kümülatif alış-satış farkı ve en agresif kurum. Bunlar derinlik baskısı ve kurum akışıyla birleşip grafik üstündeki kartta sürekli güncellenen **AL / SAT / BEKLE** olarak yazılır ("Son 5 dk aktif alış %82 · Fiyat VWAP üstünde · Bank topluyor"). Grafik analiz edildiyse aynı işaret son mumun üstüne de konur.

**Bulut verisi (Supabase + haber botu):** Her AKD okuması günün son hâliyle `akd_daily` arşivine yazılır; derinlik sekmesinde son 5 işlem gününün **kurum birikimi** görünür ("Bank Of America +1,7M · 4/4 gün alıcı") ve canlı AL/SAT gerekçelerine katılır. Haber botu her AL/SAT işaretinin 1 saat, 1 gün ve 5 gün sonrasını ölçer: Geçmiş sekmesinde **sinyal karnesi** (yön ve gerekçe başına doğru çıkma oranı). Bot haberlerinin altında "sonra 1 gün +2,3%" gibi **fiyat tepkisi** ve hissenin **yaklaşan şirket olayları** (temettü, bedelsiz, genel kurul, bilanço) gösterilir.

Telegram'dan veri **güvenli modda** çekilir: en az 20 sn ve rastgele sapmalı aralık, yalnızca seans saatlerinde (09:55–18:15) otomatik yenileme, saatte 100 / günde 700 istek sınırı; Telegram bekleme isterse uygulama otomatik durur ve süre dolunca devam eder.

## Supabase yedek (isteğe bağlı)

Sinyaller, al/sat baskısı geçmişi, kurum akışı özeti ve alarmlar buluta yedeklenebilir; ham derinlik tablosu, Telegram mesajları ve anahtarlar Mac'te kalır.

1. Supabase panelinde **SQL Editor**'e [`supabase.sql`](supabase.sql) dosyasını yapıştırıp çalıştır (tablolar + Row Level Security).
2. **Authentication › Users**'tan e-posta ve şifreli bir kullanıcı ekle.
3. **Project Settings › API**'den **Project URL** ve **anon public** anahtarını al. `service_role` anahtarını asla girme; uygulama reddeder.
4. Ayarlar › **Supabase yedek** kartına URL, anon anahtar, e-posta ve şifreni gir.

Yerel kayıt ana kayıttır; satırlar kuyruğa alınır ve internet varken arka planda gönderilir. Şifre saklanmaz, yalnızca yenileme belirteci Anahtar Zinciri ile şifreli tutulur.

## Tasarım

"Piyasa terminali" yönü: IBM Plex Sans + IBM Plex Mono (uygulamaya gömülü, SIL OFL), soğuk grafit nötr skala, tek vurgu rengi kehribar, 4–6px köşe, gölgesiz çizgi ayrımı, emoji yerine ince çizgi ikonlar. Tüm değerler `theme.css` içindeki token'lardan gelir.

## Özellikler

- **⌘⇧A** analiz, **⌘⇧D** çizim modu, **⌘⇧L** canlı mod
- Canlı mod: 2 sn – 1 dk aralıkla yeniden okur, ekran değişmediyse hiçbir şey yapmaz
- Kırılım bildirimleri: son fiyat bir seviyeyi kırınca macOS bildirimi
- **Alarm çizgisi** (çizim modunda A): fiyat çizgiyi geçince bildirim; canlı mod otomatik açılır
- Grafikte EMA, Bollinger ve otomatik Fibonacci gösterimi (Ayarlar › Grafikte göster)
- Analizi tek tıkla panoya kopyalama, oturum açılınca başlatma
- Çizim araçları: trend, ışın, yatay çizgi, dikdörtgen, Fibonacci, ölçüm, alarm, not. Renk seçimi, geri alma, taşıma ve silme; çizimler ekran başına kaydedilir
- Claude analizinden sonra Fibonacci, yatay çizgi ve ölçüm araçları fiyatla etiketlenir
- Claude'a yalnızca grafik alanı gönderilir (daha az token, daha net okuma)
- Fare imlecinin bulunduğu monitörü okur
- API anahtarı macOS Anahtar Zinciri ile şifreli saklanır
- Son 30 analizin geçmişi, açık/koyu tema

![Çizim modu](docs/cizim.png)

## Geliştirme

```bash
npm install
npm start          # uygulamayı çalıştır
npm run dist       # dist/ altına .dmg üret (macOS)
```

GitHub Actions her push'ta macOS için imzasız bir `.dmg` üretir (Actions › build › Artifacts). İmzasız uygulamayı ilk açışta Finder'da sağ tık › **Aç** demen gerekir. Her yeni derlemede Ekran Kaydı iznini yeniden vermen gerekebilir.

| Dosya | Görev |
|---|---|
| `main.js` | Menü çubuğu, kısayollar, ekran görüntüsü, canlı mod, bildirimler, ayarlar |
| `engine.js` | Yerel mum grafiği okuyucu (piksel analizi) |
| `ai.js` | Claude API isteği ve maliyet hesabı (isteğe bağlı) |
| `grok.js` | xAI Grok ile grafik ve derinlik okuma (isteğe bağlı) |
| `calendar.js` | BIST seans takvimi, tatiller ve yarım günler |
| `market.js` | Yahoo Finance ve Alpha Vantage: mumlar, fiyat, haberler, önbellek ve kota |
| `tg.js` | Telegram bağlantısı (GramJS) |
| `depth.js` | Derinlik verisi ayrıştırma, duvarlar, al/sat baskısı ve trendi |
| `preload.js` | Pencerelere açılan sınırlı API |
| `popup.html` | Menü çubuğu penceresi (Analiz / Geçmiş / Ayarlar) |
| `overlay.html` | Ekrana çizilen analiz katmanı ve çizim araçları |
| `sync.js` | Supabase yedekleme (kuyruk, giriş, yenileme) |
| `supabase.sql` | Tablolar ve Row Level Security |
| `theme.css` | Tasarım token'ları ve gömülü fontlar |

> Bu uygulama yatırım tavsiyesi vermez; analizler hatalı olabilir.
