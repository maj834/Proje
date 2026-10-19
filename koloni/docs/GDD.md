# Koloni — Oyun Tasarım Belgesi (taslak v0.1)

> Hedef cihaz: **MacBook Neo** (Apple A18 Pro, 8 GB birleşik bellek, fansız, entegre GPU).
> Motor: **Godot 4.4+** (Metal destekli Mobile renderer). Tür: üstten görünümlü 2D koloni yönetimi.

![İlk sahne](ekran.png)

## 1. Tek cümlelik fikir
Yüzlerce karıncanın feromon izleriyle kendi kendine yol bulduğu canlı bir toprak altı/üstü dünyasında,
oyuncu doğrudan karınca sürmez; **koloniyi yönlendirir**: kaynak açar, rol dağıtır, tehditlere karşı yuvayı büyütür.

## 2. Oyuncu deneyimi ve sütunlar
1. **İzlemesi keyifli kaos.** Karıncalar ortaya çıkan (emergent) davranış sergiler; altın yiyecek izleri ve mavi yuva izleri ekranda yaşayan bir harita çizer.
2. **Dolaylı kontrol.** Oyuncu emir vermez, koşulları değiştirir: yiyecek bırakır, feromon boyar, oda kazdırır.
3. **Sakin ama derin.** Kısa oturumlar (10–20 dk) için uygun, pil dostu, fansız cihazda sessiz.

## 3. Çekirdek döngü
Keşfet → İz oluştur → Topla → Yuvaya taşı → Koloni büyür → Daha uzağa keşfet.
Yuvaya gelen her 5 yiyecek bir yeni karınca doğurur (`ANTS_PER_FOOD = 0.2`). Kaynak tükenince haritada yenisi belirir.

## 4. Sistemler
| Sistem | Taslakta (v0.1) | Sonraki adım |
|---|---|---|
| Karınca davranışı | Arama/dönüş durumları, 3 sensörlü feromon takibi, rastgele gezinme, kenarda yansıma | Roller: işçi, asker, kaşif; yorgunluk |
| Feromon alanı | 2 katman (yuva, yiyecek), 8 px hücre, 10 Hz buharlaşma, 4 hücreye yumuşak bırakma | Tehlike feromonu; oyuncunun fırçayla boyaması |
| Yiyecek | Rastgele kaynaklar, tükenince yenisi; sol tık ile oyuncu yiyecek bırakır | Kaynak türleri (tohum, meyve, böcek), çürüme |
| Yuva | Tek giriş, teslimat sayacı, doğum | Yeraltı kesit görünümü, odalar (kuluçka, depo, mantar bahçesi) |
| Tehdit | — | Örümcek, rakip koloni, yağmur (izleri siler) |
| Gün döngüsü | 150 sn'lik gün, gece mavi ton + yuva ışığı | Gece karıncalar yavaşlar, ateşböcekleri |
| İlerleme | — | Kraliçe yükseltmeleri, mevsimler, senaryo haritaları |

## 5. Kontroller (MacBook odaklı)
- Trackpad: iki parmak kaydırma = kamera, sıkıştırma = yakınlaştırma (Magnify/Pan gesture destekli).
- Klavye: WASD/oklar kamera, Boşluk duraklat, Q/E hız (x1–x8), P feromon katmanı.
- Fare: sol tık yiyecek bırak, sağ tık sürükle.

## 6. Görsel stil
Sıcak toprak paleti, düşük doygunluk zemin üstünde parlak, eklemeli feromon ışıltısı. Doku dosyası yok; her şey prosedürel:
- **Zemin:** tek `ColorRect` + fbm gürültü shader'ı (toprak tonu, yosun lekeleri, ışık alan çakıllar).
- **Feromon:** küçük float ızgara → doku; shader'da elle bilinear + `blend_add` parıltı (mavi yuva, altın yiyecek).
- **Karıncalar:** kodla üretilen 9 px'lik üç bölümlü mesh (baş, göğüs, karın, 6 bacak). Tek `MultiMesh` + kaydırılmış ikinci `MultiMesh` gölge. Yük taşıyan karınca altın renkli.
- **Işık:** `CanvasModulate` ile gün döngüsü, yuvada tek `PointLight2D` (gece güçlenir). Gölge hesaplayan ışık yok.
- **Parçacık:** 16 elemanlı `CPUParticles2D` havuzu; yiyecek alma (altın) ve doğum (mavi) kıvılcımları.

## 7. Performans bütçesi (MacBook Neo, 60 FPS = 16.6 ms)
| Kalem | Bütçe | Not |
|---|---|---|
| Simülasyon (GDScript) | ≤ 4 ms @ 600 karınca | Ölçüm: ~1.8 ms/adım @ 200–400 karınca (Linux CI) |
| Feromon buharlaşma + doku yükleme | ≤ 1 ms, 10 Hz | `PackedFloat32Array.to_byte_array()` ile kopyasız yükleme |
| Çizim çağrısı | < 20 | Zemin 1, feromon 1, karınca 2, yuva 1, yiyecek ~1, parçacık ≤16 |
| GPU | Tam ekran 2 shader geçişi | Retina'da gerekirse zemin shader'ı yarım çözünürlüklü SubViewport'a alınır |
| Bellek | < 300 MB | Doku dosyası yok |

Kurallar: gerçek zamanlı gölge yok, `GPUParticles2D` yerine havuzlu CPU parçacık, tam ekran post-process yok, 60 FPS sınırı (pil/ısı).
Karınca sayısı 1000'i geçerse simülasyon GDExtension (C++) ya da compute shader'a taşınır; `colony_sim.gd` bunun için çizimden ayrı tutuldu.

## 8. Ses (planlı)
Toprak ambiyansı, gece cırcır böcekleri, yiyecek alma için yumuşak "tık". Ses kanalı sayısı ≤ 8.

## 9. Kilometre taşları
1. **v0.1 (bu taslak):** çalışan sahne, feromon davranışı, gün döngüsü, testler.
2. **v0.2:** feromon fırçası, roller, ilk tehdit (örümcek).
3. **v0.3:** yeraltı kesiti ve odalar, kaydet/yükle.
4. **v0.4:** ses, menü, macOS imzalı dışa aktarım, MacBook Neo'da profil ölçümü.

## 10. Açık sorular
- Yeraltı görünümü ayrı sahne mi, aynı haritada katman mı?
- Hedef oturum: sonsuz sandbox mu, senaryolu bölümler mi?
