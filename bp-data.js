// Borsa Pro veri katmani: endeks listeleri, arama, toplu fiyat (izleme listesi), piyasa ozeti, istatistikler ve tarayici.
// Ag erisimi yalniz enjekte edilen market uzerinden; Yahoo'yu yormamak icin eszamanlilik siniri + istekler arasi bekleme +
// 429'da geri cekilme vardir. Her sembol bagimsizdir: biri hata verirse tarama surer. Yatirim tavsiyesi degildir.

// --- Endeks bilesenleri -------------------------------------------------------------------------------------------
// Yaklasik liste: endeks bilesimi her ceyrek degisebilir (Borsa Istanbul duyurulari esastir). BIST30 < BIST50 < BIST100 < BIST500.
// 2025'te kod degisiklikleri: KOZAL -> TRALT, KOZAA -> TRMET, IPEKE -> TRENJ.
const B30=['AEFES','AKBNK','ARCLK','ASELS','ASTOR','BIMAS','CCOLA','EKGYO','ENKAI','EREGL','FROTO','GARAN','GUBRF','ISCTR','KCHOL',
  'KRDMD','MGROS','PETKM','PGSUS','SAHOL','SASA','SISE','TAVHL','TCELL','THYAO','TOASO','TRALT','TTKOM','TUPRS','YKBNK'];
const B50=[...B30,'AGHOL','AKSEN','ALARK','BRSAN','BTCIM','CIMSA','DOAS','ENJSA','HALKB','HEKTS','KONTR','MAVI','MPARK','OTKAR','OYAKC',
  'SOKM','TSKB','TTRAK','ULKER','VAKBN'];
const B100=[...B50,'AHGAZ','AKFYE','AKSA','ALFAS','ALTNY','ANSGR','BERA','BRYAT','BSOKE','CANTE','CLEBI','CWENE','DOHOL','DSTKF','ECILC',
  'EGEEN','ENERY','EUPWR','FENER','GENIL','GESAN','GLRMK','GRSEL','GSRAY','ISMEN','IZENR','KARSN','KCAER','KTLEV','LMKDC','MAGEN','MIATK',
  'OBAMS','ODAS','PASEU','PSGYO','QUAGR','RALYH','REEDR','SKBNK','SMRTG','TABGD','TKFEN','TRENJ','TRMET','TUKAS','TURSG','VESTL','YEOTK','ZOREN'];
// BIST500 (yaklasik): BIST100 + piyasa degerine gore sonraki hisseler (Hisse Radar market.json, 2026-10-21). Calisirken taze liste gelirse o kullanilir.
const B500X=['QNBTR','ISBTR','ISDMR','DOCO','INVES','RYGYO','QNBFK','TRGYO','ZRGYO','KENT','KLNMA','DMLKT','HEDEF','RGYAS','AYGAZ','AKFIS',
  'RYSAS','YGGYO','CVKMD','KRDMB','KRDMA','ANHYT','SELEC','AGESA','TBORG','EFOR','KLRHO','AKCNS','VEYAS','GLYHO','ARMGD','KARCL','NUHCM',
  'VERUS','OZATD','BASGZ','CRFSA','ADGYO','AKSGY','ARASE','ALBRK','BRISA','KLYPV','ECZYT','MOGAN','QUICK','ISGYO','AVPGY','CMENT','PAHOL',
  'RAYSG','MASFN','ENTRA','ARDYZ','TCKRC','NTHOL','SARKY','OZKGY','KONYA','EGPRO','SSAAT','DEVA','CITAS','GMTAS','AYDEM','HLGYO','CEMZY',
  'SARAE','TERA','HRKET','LYDHO','MRSHL','METEN','LILAK','EBEBK','BANVT','UFUK','ECOGR','ICBCT','BFREN','BMSTL','LOGO','POLHO','POLTK',
  'ULUSE','NETCD','TRHOL','TRCAS','ISFIN','DMRGD','ASUZU','MOBTL','GWIND','DOFRB','KORDS','CELHA','SNGYO','PAGYO','TNZTP','GEREL','SUNTK',
  'HTTBT','AKFGY','IEYHO','KLKIM','LYDYE','DGGYO','ODINE','IZMDC','EGGUB','KLSER','SDTTR','INDES','BALSU','ORGE','MCARD','JANTS','GRTHO',
  'GARFA','KGYO','SONME','EKDMR','AKGRT','MEGMT','AYCES','BAHKM','KAYSE','TEHOL','VAKKO','OYYAT','BASCM','VAKFA','YYLGD','AKHAN','LIDER',
  'PATEK','OFSYM','BIGEN','KOTON','GEDIK','DAPGM','KSTUR','AKMGY','SNPAM','EMPAE','KARTN','TARKM','INTET','NTGAZ','AYEN','SRVGY','BOSSA',
  'BESLR','VKGYO','GOZDE','ALCAR','BUCIM','TMSN','MEYSU','INGRM','KMPUR','ADEL','TSPOR','BJKAS','PEKGY','KLSYN','MAALT','KPEKS','ASGYO',
  'KOCMT','BINHO','FZLGY','FORTE','KBORU','TUREX','ESCAR','VESBE','KLGYO','HATSN','ALGYO','ARSAN','ATATP','BOBET','BLUME','VAKFN','AKENR',
  'GLCVY','OZYSR','ALBTN','KZBGY','ULUUN','EUREN','BIOEN','ENDAE','TATEN','CRDFA','BORSK','DOKTA','KUYAS','ATAKP','ISKPL','ALKLC','KRVGD',
  'CATES','PARSN','GOKNR','PRKAB','NETAS','INVEO','ISVEA','MERIT','MOPAS','AHSGY','YIGIT','AFYON','METRO','ZERGY','TKNKA','VSNMD','BIENY',
  'GOLTS','ESEN','ALKA','DESA','GENKM','HUNER','KAREL','GSDHO','MARMR','KOPOL','MNDTR','BINBN','PLTUR','ATATR','OZSUB','SMRVA','GUNDG',
  'TEZOL','TATGD','HOROZ','CEMTS','YATAS','PENTA','KZGYO','IZFAS','BESTE','AYES','NETGL','FONET','ORMA','TURGG','CGCAM','PCILT','GIPTA',
  'EKOS','BKRGY','TSGYO','ZGYO','KERVN','FRMPL','YBTAS','ALKIM','MHRGY','ANELE','BEGYO','INTEM','KRGYO','FMIZP','SURGY','SANKO','EGEGY',
  'SOKE','GOODY','KRONT','UCAYM','PNSUT','AGROT','MRGYO','KONKA','AZTEK','SEGMN','DURDO','BULGS','LIDFA','ERCB','NATEN','PETUN','LINK',
  'SAYAS','DYOBY','KATMR','DZGYO','ESCOM','GENTS','ADESE','YUNSA','SUWEN','KTSKR','SVGYO','HURGZ','KUVVA','BAGFS','BRKVY','TKNSA','EGEPO',
  'PKENT','ALCTL','BURVA','A1CAP','DARDL','SAFKR','EKSUN','MNDRS','KIMMR','IHLAS','KUTPO','DAGI','ELITE','LKMNH','KAPLM','ARFYE','MACKO',
  'PNLSN','BVSAN','IHAAS','ARTMS','VBTYZ','SERNT','YAPRK','MARTI','MEDTR','ATEKS','CEMAS','SOHOE','SEGYO','PINSU','ONCSM','ISSEN','LXGYO',
  'CMBTN','NUGYO','INFO','ONRYT','OSMEN','KNFRT','TMPOL','MSGYO','ERBOS','EDATA','DNISI','MERCN','BRLSM','BAKAB','PRKME','BORLS','PKART',
  'GOLDA','ETILR','BYDNR','DGATE','FRIGO','VANGD','MARBL','BIGCH','AGYO','MTRKS','UNLU','BURCE','SKYMD','TGSAS','EGSER','AVGYO','EDIP',
  'GATEG','KRPLS','ULUFA','SANFM','BIGTK','LUKSK','ANGEN','KLMSN','BLCYT','GSDDE','BARMA','ENSRI','HDFGS','USHOL','DERHL','BEYAZ','MAKIM',
  'MANAS','ISBIR','DCTTR','GZNMI','MEKAG','INTEK','PAPIL','DGNMO','BIZIM','OZGYO'];
const B500=[...B100,...B500X];
const U={BIST30:B30,BIST50:B50,BIST100:B100,BIST500:B500,note:'Yaklaşık liste; endeks bileşimi değişebilir.'};
Object.defineProperty(U,'note',{enumerable:false});

// Sirket kisa adlari (arama ve tablo icin). BIST100 + sik aranan bazi hisseler.
const NAMES={
  AEFES:'Anadolu Efes',AKBNK:'Akbank',ARCLK:'Arçelik',ASELS:'Aselsan',ASTOR:'Astor Enerji',BIMAS:'BİM Mağazalar',CCOLA:'Coca-Cola İçecek',
  EKGYO:'Emlak Konut GYO',ENKAI:'Enka İnşaat',EREGL:'Ereğli Demir Çelik',FROTO:'Ford Otosan',GARAN:'Garanti BBVA',GUBRF:'Gübre Fabrikaları',
  ISCTR:'İş Bankası (C)',KCHOL:'Koç Holding',KRDMD:'Kardemir (D)',MGROS:'Migros',PETKM:'Petkim',PGSUS:'Pegasus',SAHOL:'Sabancı Holding',
  SASA:'SASA Polyester',SISE:'Şişecam',TAVHL:'TAV Havalimanları',TCELL:'Turkcell',THYAO:'Türk Hava Yolları',TOASO:'Tofaş Oto',
  TRALT:'Türk Altın İşletmeleri',TTKOM:'Türk Telekom',TUPRS:'Tüpraş',YKBNK:'Yapı Kredi Bankası',
  AGHOL:'Anadolu Grubu Holding',AKSEN:'Aksa Enerji',ALARK:'Alarko Holding',BRSAN:'Borusan Boru',BTCIM:'Batıçim',CIMSA:'Çimsa',DOAS:'Doğuş Otomotiv',
  ENJSA:'Enerjisa Enerji',HALKB:'Halkbank',HEKTS:'Hektaş',KONTR:'Kontrolmatik',MAVI:'Mavi Giyim',MPARK:'MLP Sağlık (Medical Park)',OTKAR:'Otokar',
  OYAKC:'Oyak Çimento',SOKM:'Şok Marketler',TSKB:'Türkiye Sınai Kalkınma Bankası',TTRAK:'Türk Traktör',ULKER:'Ülker Bisküvi',VAKBN:'Vakıfbank',
  AHGAZ:'Ahlatcı Doğalgaz',AKFYE:'Akfen Yenilenebilir Enerji',AKSA:'Aksa Akrilik',ALFAS:'Alfa Solar Enerji',ALTNY:'Altınay Savunma',
  ANSGR:'Anadolu Sigorta',BERA:'Bera Holding',BRYAT:'Borusan Yatırım',BSOKE:'Batısöke Çimento',CANTE:'Çan2 Termik',CLEBI:'Çelebi Hava Servisi',
  CWENE:'CW Enerji',DOHOL:'Doğan Holding',DSTKF:'Destek Faktoring',ECILC:'Eczacıbaşı İlaç',EGEEN:'Ege Endüstri',ENERY:'Enerya Enerji',
  EUPWR:'Europower Enerji',FENER:'Fenerbahçe',GENIL:'Gen İlaç',GESAN:'Girişim Elektrik',GLRMK:'Gülermak',GRSEL:'Gür-Sel Turizm',
  GSRAY:'Galatasaray',ISMEN:'İş Yatırım',IZENR:'İzdemir Enerji',KARSN:'Karsan Otomotiv',KCAER:'Kocaer Çelik',KTLEV:'Katılımevim',
  LMKDC:'Limak Doğu Anadolu Çimento',MAGEN:'Margün Enerji',MIATK:'Mia Teknoloji',OBAMS:'Oba Makarnacılık',ODAS:'Odaş Elektrik',
  PASEU:'Pasifik Eurasia',PSGYO:'Pasifik GYO',QUAGR:'Qua Granite',RALYH:'Ral Yatırım Holding',REEDR:'Reeder Teknoloji',SKBNK:'Şekerbank',
  SMRTG:'Smart Güneş Enerjisi',TABGD:'TAB Gıda',TKFEN:'Tekfen Holding',TRENJ:'TR Doğal Enerji',TRMET:'TR Anadolu Metal',TUKAS:'Tukaş',
  TURSG:'Türkiye Sigorta',VESTL:'Vestel',YEOTK:'YEO Teknoloji',ZOREN:'Zorlu Enerji',
  // BIST100 disi, sik aranan
  AYGAZ:'Aygaz',BJKAS:'Beşiktaş',TSPOR:'Trabzonspor',VAKKO:'Vakko',KORDS:'Kordsa',SELEC:'Selçuk Ecza',LOGO:'Logo Yazılım',NETAS:'Netaş',
  INDES:'İndeks Bilgisayar',ALBRK:'Albaraka Türk',PNSUT:'Pınar Süt',TATGD:'Tat Gıda',BRISA:'Brisa',JANTS:'Jantsa',KARTN:'Kartonsan',
  ASUZU:'Anadolu Isuzu',TMSN:'Tümosan',CEMTS:'Çemtaş',KONYA:'Konya Çimento',AKCNS:'Akçansa',NUHCM:'Nuh Çimento',ADEL:'Adel Kalemcilik',
  SARKY:'Sarkuysan',BAGFS:'Bagfaş',DEVA:'Deva Holding',YATAS:'Yataş',VESBE:'Vestel Beyaz Eşya',TKNSA:'Teknosa',BIZIM:'Bizim Toptan',
  CRFSA:'CarrefourSA',AKGRT:'Aksigorta',AGESA:'AgeSA Hayat ve Emeklilik',ANHYT:'Anadolu Hayat Emeklilik',HLGYO:'Halk GYO',TRGYO:'Torunlar GYO',
  ISGYO:'İş GYO',ISDMR:'İskenderun Demir Çelik',KLKIM:'Kalekim',EGGUB:'Ege Gübre',GOODY:'Goodyear',GWIND:'Galata Wind',AYDEM:'Aydem Enerji',
  ARDYZ:'ARD Bilişim',SNGYO:'Sinpaş GYO',ZRGYO:'Ziraat GYO',KMPUR:'Kimteks Poliüretan'

};
// BIST500 ek adlari (Hisse Radar market.json'dan kisaltilmis; sektor siniflamasi yok, yalniz arama/gosterim icin)
const NAMES500={QNBTR:'QNB Bank',ISBTR:'Türkiye Is',DOCO:'DO &',INVES:'Investco',RYGYO:'Reysas Gayrimenkul',QNBFK:'QNB Finansal',KENT:'Kent Gida',KLNMA:'Türkiye Kalkinma',DMLKT:'Emlak Konut',HEDEF:'Hedef',RGYAS:'Ronesans Gayrimenkul',AKFIS:'Akfen insaat',RYSAS:'Reysas Tasimacilik',YGGYO:'Yeni Gimat',CVKMD:'Cvk Maden',KRDMB:'Kardemir Karabiik',KRDMA:'Kardemir Karabiik',TBORG:'Turk Tuborg',EFOR:'Efor Yatirim',KLRHO:'Kiler',VEYAS:'Turker Vangolu',GLYHO:'Global Yatirim',ARMGD:'Armada Gida',KARCL:'Kardemir Celik',VERUS:'Verusa',OZATD:'Ozata Denizcilik',BASGZ:'Baskent Dogalgaz',ADGYO:'Adra Gayrimenkul',AKSGY:'Akis Gayrimenkul',ARASE:'Dogu Aras',KLYPV:'Kalyon Gunes',ECZYT:'Eczacibasi Yatirim',MOGAN:'Mogan Enerji',QUICK:'Quick Sigorta',AVPGY:'Avrupakent Gayrimenkul',CMENT:'Cimentas Izmir',PAHOL:'Pasifik',RAYSG:'Ray Sigorta',MASFN:'Masfen Enerji',ENTRA:'IC Enterra',TCKRC:'Kirac Galvaniz',NTHOL:'Net',OZKGY:'Ozak Gayrimenkul',EGPRO:'Ege Profil',SSAAT:'Saat Saat',CITAS:'Citlekci Magazacilik',GMTAS:'Gimat Magazacilik',CEMZY:'Cem Zeytin',SARAE:'SA-RA Enerji',TERA:'Tera Yatirim',HRKET:'Hareket Proje',LYDHO:'Lydia',MRSHL:'Marshall Boya',METEN:'METGUN Enerji',LILAK:'Lila Kagit',EBEBK:'Ebebek Magazacilik',BANVT:'Banvit Bandirma',UFUK:'Ufuk Yatirim',ECOGR:'Ecogreen Enerji',ICBCT:'ICBC Turkey',BFREN:'Bosch Fren',BMSTL:'BMS Birlesik',POLHO:'Polisan',POLTK:'Politeknik Metal',ULUSE:'Ulusoy Elektrik',NETCD:'Netcad Yazilim',TRHOL:'Tera Financial',TRCAS:'Turcas',ISFIN:'Is Finansal',DMRGD:'DMR Unlu',MOBTL:'Mobitel Iletisim',DOFRB:'DOF Robotik',CELHA:'Celik Halat',PAGYO:'Panora Gayrimenkul',TNZTP:'Tapdi Oksijen',GEREL:'Gersan Elektrik',SUNTK:'Sun Tekstil',HTTBT:'Hitit Bilgisayar',AKFGY:'Akfen Gayrimenkul',IEYHO:'Isiklar Enerji',LYDYE:'Lydia Yesil',DGGYO:'Dogus Gayrimenkul',ODINE:'Odine Solutions',IZMDC:'Izmir Demir',KLSER:'Kaleseramik Canakkale',SDTTR:'SDT Uzay',BALSU:'Balsu Gida',ORGE:'Orge Enerji',MCARD:'Metropal Kurumsal',GRTHO:'Grainturk',GARFA:'Garanti Faktoring',KGYO:'Koray Gayrimenkul',SONME:'Soenmez Filament',EKDMR:'Ekinciler Demir',MEGMT:'Mega Metal',AYCES:'Altin Yunus',BAHKM:'Bahadir Kimya',KAYSE:'Kayseri Seker',TEHOL:'Tera Yatirim',OYYAT:'Oyak Yatirim',BASCM:'Bastas Baskent',VAKFA:'Vakif Faktoring',YYLGD:'Yayla Agro',AKHAN:'Akhan Un',LIDER:'LDR Turizm',PATEK:'Pasifik Teknoloji',OFSYM:'Ofis Yem',BIGEN:'Birlesim Grup',KOTON:'Koton Magazacilik',GEDIK:'Gedik Yatirim',DAPGM:'Dap Gayrimenkul',KSTUR:'Kustur Kusadasi',AKMGY:'Akmerkez Gayrimenkul',SNPAM:'Sonmez Pamuklu',EMPAE:'Empa Elektronik',TARKM:'Tarkim Bitki',INTET:'Intetra Teknoloji',NTGAZ:'Naturelgaz Ve',AYEN:'Ayen Enerji',SRVGY:'Servet Gayrimenkul',BOSSA:'Bossa Isletmeleri',BESLR:'Besler Gida',VKGYO:'Vakif Gayrimenkul',GOZDE:'Gozde Girisim',ALCAR:'Alarko Carrier',BUCIM:'Bursa Cimento',MEYSU:'Meysu Gida',INGRM:'Ingram Micro',PEKGY:'Peker Gayrimenkul',KLSYN:'Koleksiyon Mobilya',MAALT:'Marmaris Altinyunus',KPEKS:'Kapeks Kimya',ASGYO:'Asce Gayrimenkul',KOCMT:'Koc Metalurji',BINHO:'1000 Yatirimlar',FZLGY:'Fuzul Gayrimenkul',FORTE:'Forte Bilgi',KBORU:'Kuzey Boru',TUREX:'Tureks Turizm',ESCAR:'Escar Filo',KLGYO:'Kiler Gayrimenkul',HATSN:'Hat- Gemi',ALGYO:'Alarko Gayrimenkul',ARSAN:'Arsan',ATATP:'ATP Yazilim',BOBET:'Bogazici Beton',BLUME:'Blume Metal',VAKFN:'Vakif Finansal',AKENR:'Akenerji Elektrik',GLCVY:'Gelecek Varlik',OZYSR:'Ozyasar Tel',ALBTN:'Albayrak Hazir',KZBGY:'Kizilbuk Gayrimenkul',ULUUN:'Ulusoy Un',EUREN:'Europen Endustri',BIOEN:'BIotrend Cevre',ENDAE:'Enda Enerji',TATEN:'Tatlipinar Enerji',CRDFA:'Creditwest Faktoring',BORSK:'Bor Seker',DOKTA:'Doktas Dokumculuk',KUYAS:'Kuyas Yatirim',ATAKP:'Atakey Patates',ISKPL:'Isik Plastik',ALKLC:'Altinkilic Gida',KRVGD:'Kervan Gida',CATES:'Cates Elektrik',PARSN:'Parsan Makina',GOKNR:'Goknur Gida',PRKAB:'Turk Prysmian',INVEO:'Inveo Yatirim',ISVEA:'Isvea Seramik',MERIT:'Merit Turizm',MOPAS:'Mopas Marketcilik',AHSGY:'Ahes Gayrimenkul',YIGIT:'Yigit Aku',AFYON:'Afyon Cimento',METRO:'Metro Ticari',ZERGY:'Zeray Gayrimenkul',TKNKA:'Teknika Plast',VSNMD:'Visne Madencilik',BIENY:'Bien Yapi',GOLTS:'Goltas Goller',ESEN:'Esenboga Elektrik',ALKA:'Alkim Kagit',DESA:'Desa Deri',GENKM:'Gentas Kimya',HUNER:'Hun Yenilenebilir',KAREL:'Karel Elektronik',GSDHO:'GSD',MARMR:'Marmara',KOPOL:'Koza Polyester',MNDTR:'Mondi Turkey',BINBN:'Bin Ulasim',PLTUR:'Platform Turizm',ATATR:'Ata Turizm',OZSUB:'Ozsu Balik',SMRVA:'Sumer Varlik',GUNDG:'Gundogdu Gida',TEZOL:'Europap Tezol',HOROZ:'Horoz Lojistik',PENTA:'Penta Teknoloji',KZGYO:'Kuzugrup Gayrimenkul',IZFAS:'Izmir Firca',BESTE:'Best Brands',AYES:'Ayes Celik',NETGL:'Net Global',FONET:'Fonet Bilgi',ORMA:'Orma Orman',TURGG:'Turker Proje',CGCAM:'Cagdas Cam',PCILT:'PC Iletisim',GIPTA:'Gipta Ofis',EKOS:'Ekos Teknoloji',BKRGY:'Bakirci Gayrimenkul',TSGYO:'TSKB Gayrimenkul',ZGYO:'Z Gayrimenkul',KERVN:'Kervansaray Yatirim',FRMPL:'Formul Plastik',YBTAS:'Yibitas Yozgat',ALKIM:'Alkim Alkali',MHRGY:'MHR Gayrimenkul',ANELE:'Anel Elektrik',BEGYO:'Bati Ege',INTEM:'Intema Insaat',KRGYO:'Korfez Gayrimenkul',FMIZP:'Federal-Mogul Izmit',SURGY:'Sur Tatil',SANKO:'Sanko Pazarlama',EGEGY:'Egeyapi Avrupa',SOKE:'Soke Degirmencilik',KRONT:'Kron Teknoloji',UCAYM:'Ucay Muhendislik',AGROT:'Agrotech Yuksek',MRGYO:'Marti Gayrimenkul',KONKA:'Konya Kagit',AZTEK:'Aztek Teknoloji',SEGMN:'Segmen Kardesler',DURDO:'Duran Dogan',BULGS:'Bulls Girisim',LIDFA:'Lider Faktoring',ERCB:'Erciyas Celik',NATEN:'Naturel Yenilenebilir',PETUN:'Pinar Entegre',LINK:'Link Bilgisayar',SAYAS:'Say Yenilenebilir',DYOBY:'Dyo Boya',KATMR:'Katmerciler Arac',DZGYO:'Deniz Gayrimenkul',ESCOM:'Escort Teknoloji',GENTS:'Gentas Dekoratif',ADESE:'Adese Gayrimenkul',YUNSA:'Yunsa Yunlu',SUWEN:'Suwen Tekstil',KTSKR:'Kutahya Seker',SVGYO:'Savur Gayrimenkul',HURGZ:'Hurriyet Gazetecilik',KUVVA:'Kuvva Gida',BRKVY:'Birikim Varlik',EGEPO:'Nasmed Ozel',PKENT:'Petrokent Turizm',ALCTL:'Alcatel Lucent',BURVA:'Burcelik Vana',A1CAP:'A1 Capital',DARDL:'Dardanel Onentas',SAFKR:'Safkar Ege',EKSUN:'Eksun Gida',MNDRS:'Menderes Tekstil',KIMMR:'Ersan Alisveris',IHLAS:'Ihlas',KUTPO:'Kutahya Porselen',DAGI:'Dagi Giyim',ELITE:'Elite Naturel',LKMNH:'Lokman Hekim',KAPLM:'Kaplamin Ambalaj',ARFYE:'ARF Bio',MACKO:'Mackolik Internet',PNLSN:'Panelsan Cati',BVSAN:'Bulbuloglu Vinc',IHAAS:'Ihlas Haber',ARTMS:'Artemis Hali',VBTYZ:'VBT Yazilim',SERNT:'Seranit Granit',YAPRK:'Yaprak Sut',MARTI:'Marti Otel',MEDTR:'Meditera Tibbi',ATEKS:'Akin Tekstil',CEMAS:'Cemas Dokum',SOHOE:'Soho Giyim',SEGYO:'Seker Gayrimenkul',PINSU:'Pinar Su',ONCSM:'Oncosem Onkolojik',ISSEN:'Isbir Sentetik',LXGYO:'Luxera Gayrimenkul',CMBTN:'Cimbeton Hazir',NUGYO:'Nurol Gayrimenkul',INFO:'Info Yatirim',ONRYT:'Onur Yuksek',OSMEN:'Osmanli Yatirim',KNFRT:'Konfrut Tarim',TMPOL:'Temapol Polimer',MSGYO:'Mistral Gayrimenkul',ERBOS:'Erbosan Erciyas',EDATA:'E-Data Teknoloji',DNISI:'Dinamik Isi',MERCN:'Mercan Kimya',BRLSM:'Birlesim Muhendislik',BAKAB:'Bak Ambalaj',PRKME:'Park Elektrik',BORLS:'Borlease Otomotiv',PKART:'Plastikkart Akilli',GOLDA:'Golda Gida',ETILR:'Etiler Gida',BYDNR:'Baydoner Restoranlari',DGATE:'Datagate Bilgisayar',FRIGO:'Frigo-Pak Gida',VANGD:'Vanet Gida',MARBL:'Tureks Turunc',BIGCH:'Buyuk Sefler',AGYO:'Atakule Gayrimenkul',MTRKS:'Matriks Finansal',UNLU:'Unlu Yatirim',BURCE:'Burcelik Bursa',SKYMD:'Seker Yatirim',TGSAS:'TGS Dis',EGSER:'Ege Seramik',AVGYO:'Avrasya Gayrimenkul',EDIP:'Edip Gayrimenkul',GATEG:'Gate Group',KRPLS:'Koroplast Temizlik',ULUFA:'Ulusal Faktoring',SANFM:'Sanifoam Endustri',BIGTK:'Big Medya',LUKSK:'Luks Kadife',ANGEN:'Anatolia Tani',KLMSN:'Klimasan Klima',BLCYT:'Bilici Yatirim',GSDDE:'GSD Denizcilik',BARMA:'Barem Ambalaj',ENSRI:'Ensari Sinai',HDFGS:'Hedef Girisim',USHOL:'US Yatirim',DERHL:'Derluks Yatirim',BEYAZ:'Beyaz Filo',MAKIM:'Makim Makina',MANAS:'Manas Enerji',ISBIR:'Isbir',DCTTR:'DCT Trading',GZNMI:'Gezinomi Seyahat',MEKAG:'Meka Global',INTEK:'Innosa Teknoloji',PAPIL:'Papilon Savunma',DGNMO:'Doganlar Mobilya',OZGYO:'Ozderici Gayrimenkul'};

// Aramada yakalanacak eski kodlar / takma adlar (gorunmez).
const ALIAS={TRALT:'kozal koza altın',TRMET:'kozaa koza anadolu metal',TRENJ:'ipeke ipek doğal enerji',THYAO:'thy turkish airlines',
  ISCTR:'isbank işbank',YKBNK:'ykb',GARAN:'garanti bankası',VAKBN:'vakıf bankası',HALKB:'halk bankası',BIMAS:'bim birleşik',
  MPARK:'mlp care',KRDMD:'karabük',EREGL:'erdemir',TCELL:'turkcell',SASA:'sasa',ASELS:'aselsan savunma',AEFES:'efes bira'};
// Endeksler (Yahoo'da XU100.IS vb.)
const INDICES={XU100:'BIST 100 Endeksi',XU030:'BIST 30 Endeksi',XU050:'BIST 50 Endeksi',XBANK:'BIST Banka Endeksi',XUSIN:'BIST Sınai Endeksi',
  XHOLD:'BIST Holding Endeksi',XUTEK:'BIST Teknoloji Endeksi',XUMAL:'BIST Mali Endeksi',XUHIZ:'BIST Hizmetler Endeksi'};

// --- Sektorler ---------------------------------------------------------------------------------------------------------
// Kod -> sektor. Is modeline gore (KAP / BIST sektor endeksleriyle cogunlukla ortusur; yatirimcinin gundelik gruplamasi esas):
//  Enerji = rafineri, akaryakit, LPG, dogalgaz dagitim; Elektrik = elektrik uretim/dagitim (yenilenebilir dahil);
//  Enerji Ekipmanları = trafo, gunes paneli, depolama, enerji altyapi taahhut; Çimento-İnşaat = cimento, muteahhitlik ve
//  yapi malzemesi (seramik); Finansal Hizmetler = araci kurum, faktoring, kiralama, tasarruf finansman; Havacilik havalimani ve
//  yer hizmetlerini de kapsar. Bir kod yalniz bir sektorde. Bilinmeyen -> 'Diğer'. Eski kodlar (KOZAL, IPEKE...) kayitli listeler icin.
const SEC_LIST={
  'Bankacılık':'AKBNK GARAN ISCTR YKBNK HALKB VAKBN TSKB SKBNK ALBRK QNBTR QNBFB ICBCT KLNMA ISATR ISBTR ISKUR',
  'Holding':'KCHOL SAHOL AGHOL ALARK DOHOL TKFEN BERA BRYAT RALYH GLYHO NTHOL KLRHO POLHO IHLAS DENGE ECZYT METRO GSDHO',
  'Havacılık':'THYAO PGSUS TAVHL CLEBI',
  'Demir-Çelik':'EREGL KRDMD KRDMA KRDMB ISDMR BRSAN KCAER CEMTS IZMDC CELHA ERBOS TUCLK',
  'Metal-Makine':'SARKY',
  'Otomotiv':'FROTO TOASO DOAS OTKAR TTRAK KARSN EGEEN ASUZU TMSN BRISA GOODY JANTS PARSN FMIZP DITAS',
  'Enerji':'TUPRS AYGAZ AHGAZ ENERY TRCAS',
  'Elektrik':'AKSEN ENJSA ZOREN ODAS AKFYE MAGEN IZENR CANTE AYDEM GWIND TATEN ESEN NATEN AKENR AYEN BIOEN HUNER ENTRA PAMEL ZEDUR ARASE MOGAN A1YEN',
  'Enerji Ekipmanları':'ASTOR EUPWR ALFAS CWENE SMRTG GESAN YEOTK',
  'Perakende':'BIMAS MGROS SOKM MAVI TKNSA BIZIM CRFSA KIMMR',
  'Telekom':'TCELL TTKOM',
  'Çimento-İnşaat':'ENKAI CIMSA OYAKC BTCIM BSOKE LMKDC GLRMK QUAGR AKCNS NUHCM KONYA BUCIM AFYON GOLTS EGSER USAK',
  'Kimya-Petrokimya':'PETKM SASA AKSA KMPUR KLKIM ALKIM DYOBY',
  'Savunma':'ASELS ALTNY SDTTR PAPIL KATMR',
  'Gıda-İçecek':'AEFES CCOLA ULKER TUKAS OBAMS TABGD PNSUT TATGD BANVT KNFRT PETUN ULUUN KRVGD SOKE FRIGO DARDL ELITE EKSUN GOKNR MERKO KAYSE',
  'Cam':'SISE',
  'Madencilik':'TRALT TRMET TRENJ KOZAL KOZAA IPEKE PRKME',
  'GYO':'EKGYO PSGYO HLGYO TRGYO ISGYO SNGYO ZRGYO AKFGY KZBGY OZKGY ALGYO RYGYO VKGYO YGGYO AKMGY DZGYO NUGYO OZGYO MSGYO PEKGY KLGYO',
  'Sigorta':'ANSGR TURSG AKGRT AGESA ANHYT RAYSG',
  'Finansal Hizmetler':'ISMEN DSTKF KTLEV ISFIN GARFA VAKFN GEDIK INFO OSMEN SEKFK LIDFA CRDFA ULUFA A1CAP GLBMD TERA OYYAT SKYMD',
  'Teknoloji':'KONTR MIATK REEDR LOGO NETAS INDES ARDYZ KAREL ESCOM LINK FONET DGATE ATATP VBTYZ KFEIN PENTA OBASE HTTBT FORTE MTRKS ALCTL ARENA',
  'Tekstil':'VAKKO KORDS MNDRS YUNSA BOSSA ARSAN SKTAS DESA HATEK ATEKS BLCYT DAGI',
  'Ulaştırma-Lojistik':'PASEU GRSEL RYSAS TUREX BEYAZ GSDDE HOROZ TLMAN',
  'Kağıt-Ambalaj':'KARTN ADEL OLMIP TIRE DURDO BAKAB ALKA VKING PRZMA',
  'Beyaz Eşya-Elektronik':'ARCLK VESTL VESBE ARZUM SILVR',
  'Sağlık':'MPARK ECILC GENIL DEVA SELEC LKMNH MEDTR RTALB TRILC',
  'Turizm':'MAALT AYCES MERIT PKENT TEKTU MARTI UTPYA',
  'Tarım-Gübre':'GUBRF HEKTS BAGFS EGGUB TARKM',
  'Spor':'FENER GSRAY BJKAS TSPOR',
  'Mobilya':'YATAS'
};
const SECTORS={};for(const [s,codes] of Object.entries(SEC_LIST))for(const c of codes.split(/\s+/))if(c&&!SECTORS[c])SECTORS[c]=s;
const SECTOR_NAMES=[...Object.keys(SEC_LIST),'Endeks','Diğer'];

const MACRO=[{sym:'XU100.IS',name:'BIST 100'},{sym:'XU030.IS',name:'BIST 30'},{sym:'USDTRY=X',name:'Dolar/TL'},{sym:'EURTRY=X',name:'Euro/TL'},
  {sym:'GC=F',name:'Altın ($/ons)'},{sym:'BZ=F',name:'Brent'},{sym:'BTC-USD',name:'Bitcoin'}];

// --- Etiketler ve hazir filtreler ------------------------------------------------------------------------------------
// Esikler (tarayici, birincil zaman dilimi mumlari; 52 hafta ve performans gunluk mumlardan). Rastgele yuruyuste her etiket
// mumlarin ~%5-10'unda cikacak kadar secici tutuldu (engine'in ham kirilim/formasyon listesi ~%25-40 ile tarayicida gurultu olur):
//  kirilim: son kapanis onceki 20 mumun en yuksegi/dusugu otesinde (Donchian 20) ya da engine bolge kirilimi son 3 mumda + hacim >= 1,5x
//  sikisma: Bollinger bant genisligi son 120 mumun en dusugunun %15 yakininda (engine)
//  uyumsuzluk: engine RSI/MACD uyumsuzlugu; pozitif yalniz RSI <= 45, negatif yalniz RSI >= 55 iken
//  altin/olum kesisimi: SMA50, SMA200'u son 10 mum icinde yukari/asagi kesti ve hala o tarafta
//  asiri satim/alim: RSI(14) <= 30 / >= 70
//  zirve52/dip52: fiyat 52 haftalik (252 gun) zirvenin en fazla %2 altinda / dibin en fazla %2 ustunde
//  hacim patlamasi: son mum hacmi onceki 20 mum ortalamasinin >= 2 kati
//  guclu trend: ADX >= 25, +DI > -DI, birincil trend yukari, haftalik trend dususte degil
//  bayrak: boga bayragi (engine: >=3 ATR direk + dar konsolidasyon); ikili dip/tepe: engine, onayli ya da boyna <= 1 ATR
const TAGS={
  'kirilim-yukari':{name:'Yukarı kırılım',dir:1,desc:'20 mumluk zirve kapanışla aşıldı ya da direnç bölgesi hacimle (≥ 1,5x) kırıldı'},
  'kirilim-asagi':{name:'Aşağı kırılım',dir:-1,desc:'20 mumluk dip kapanışla kırıldı ya da destek bölgesi hacimle (≥ 1,5x) kırıldı'},
  'sikisma':{name:'Sıkışma',dir:0,desc:'Bollinger bantları son 120 mumun en dar seviyesinde'},
  'uyumsuzluk-pozitif':{name:'Pozitif uyumsuzluk',dir:1,desc:'Fiyat daha düşük dip yaparken RSI/MACD daha yüksek dip yaptı (RSI ≤ 45)'},
  'uyumsuzluk-negatif':{name:'Negatif uyumsuzluk',dir:-1,desc:'Fiyat daha yüksek tepe yaparken RSI/MACD daha düşük tepe yaptı (RSI ≥ 55)'},
  'altin-kesisim':{name:'Altın kesişim',dir:1,desc:'SMA50, SMA200\'ü son 10 mumda yukarı kesti'},
  'olum-kesisimi':{name:'Ölüm kesişimi',dir:-1,desc:'SMA50, SMA200\'ü son 10 mumda aşağı kesti'},
  'asiri-satim':{name:'Aşırı satım',dir:1,desc:'RSI(14) 30 ya da altında'},
  'asiri-alim':{name:'Aşırı alım',dir:-1,desc:'RSI(14) 70 ya da üstünde'},
  'zirve52':{name:'52 hafta zirvesi',dir:1,desc:'Fiyat 52 haftalık zirvenin en fazla %2 altında'},
  'dip52':{name:'52 hafta dibi',dir:-1,desc:'Fiyat 52 haftalık dibin en fazla %2 üstünde'},
  'hacim-patlamasi':{name:'Hacim patlaması',dir:0,desc:'Hacim 20 mum ortalamasının en az 2 katı'},
  'guclu-trend':{name:'Güçlü trend',dir:1,desc:'ADX ≥ 25 ve yükselen trend (+DI > -DI), haftalık düşüşte değil'},
  'bayrak':{name:'Boğa bayrağı',dir:1,desc:'Sert yükseliş direğinin ardından dar konsolidasyon'},
  'ikili-dip':{name:'İkili dip',dir:1,desc:'Eşit iki dip; boyun kırıldı ya da fiyat boyna 1 ATR\'den yakın'},
  'ikili-tepe':{name:'İkili tepe',dir:-1,desc:'Eşit iki tepe; boyun kırıldı ya da fiyat boyna 1 ATR\'den yakın'}
};
const PRESETS=[
  {id:'guclu-al',name:'Güçlü AL',desc:'Karar AL, skor ≥ 40, güven ≥ %50 ve haftalık trend düşüşte değil'},
  {id:'kirilim',name:'Kırılım',desc:'20 mumluk zirve kapanışla aşıldı ya da direnç bölgesi hacimle yukarı kırıldı'},
  {id:'sikisma',name:'Sıkışma',desc:'Bollinger bantları çok dar: sert hareket yakın olabilir'},
  {id:'asiri-satim-donus',name:'Aşırı satımdan dönüş',desc:'RSI son 5 mumda 30 altına indi (pozitif uyumsuzlukta 35) ve fiyatla birlikte yukarı dönüyor'},
  {id:'zirve52',name:'52 hafta zirvesi',desc:'Fiyat 52 haftalık zirvenin en fazla %2 altında'},
  {id:'hacim',name:'Hacim patlaması',desc:'Hacim 20 mum ortalamasının en az 2 katı'},
  {id:'uyumsuzluk',name:'Uyumsuzluk',desc:'RSI ya da MACD ile fiyat arasında pozitif (RSI ≤ 45) ya da negatif (RSI ≥ 55) uyumsuzluk'},
  {id:'altin-kesisim',name:'Altın kesişim',desc:'SMA50, SMA200\'ü son 10 mumda yukarı kesti'},
  {id:'dusus-riski',name:'Düşüş riski',desc:'Güçlü SAT (skor ≤ -40, güven ≥ %50) ya da skor pozitif değilken aşağı kırılım, ölüm kesişimi veya ikili tepe'}
];
const has=(row,...ids)=>!!(row&&Array.isArray(row.tags)&&ids.some(id=>row.tags.includes(id)));
const PRESET_FN={
  'guclu-al':r=>!!r.verdict&&r.verdict.label==='AL'&&r.verdict.score>=40&&r.verdict.confidence>=50&&!(r.trend&&r.trend.w===-1),
  'kirilim':r=>has(r,'kirilim-yukari'),
  'sikisma':r=>has(r,'sikisma'),
  'asiri-satim-donus':r=>r.turn>0&&(((fin(r.rsiMin5)&&r.rsiMin5<=30)||(fin(r.rsi)&&r.rsi<=30))||(has(r,'uyumsuzluk-pozitif')&&fin(r.rsiMin5)&&r.rsiMin5<=35)),
  'zirve52':r=>has(r,'zirve52'),
  'hacim':r=>has(r,'hacim-patlamasi'),
  'uyumsuzluk':r=>has(r,'uyumsuzluk-pozitif','uyumsuzluk-negatif'),
  'altin-kesisim':r=>has(r,'altin-kesisim'),
  // guclu-al'in simetrigi (guclu SAT) ya da skor pozitif degilken taze yapisal bozulma (erken uyari)
  'dusus-riski':r=>!!r.verdict&&((r.verdict.label==='SAT'&&r.verdict.score<=-40&&r.verdict.confidence>=50)||(r.verdict.score<=0&&has(r,'kirilim-asagi','olum-kesisimi','ikili-tepe')))
};

// --- Yardimcilar -----------------------------------------------------------------------------------------------------
const fin=v=>typeof v==='number'&&Number.isFinite(v);
const rnd=(v,d=2)=>{if(!fin(v))return null;const r=+v.toFixed(d);return r===0?0:r}; // -0 -> 0 ("-0,00" gorunmesin)
const DAY=86400000,TRO=3*3600000;
const dayIdx=t=>Math.floor((t+TRO)/DAY);                 // Istanbul gun numarasi (TR yaz saati yok)
const cleanRows=rs=>(Array.isArray(rs)?rs:[]).filter(r=>r&&fin(r.t)&&[r.o,r.h,r.l,r.c].every(fin)&&r.c>0&&r.h>=r.l);
const TR_FOLD={'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u','â':'a','î':'i','û':'u'};
const fold=s=>String(s==null?'':s).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[çğıöşüâîû]/g,c=>TR_FOLD[c]).replace(/[^a-z0-9]+/g,' ').trim();
const TR_UP={'Ş':'S','Ç':'C','Ğ':'G','Ö':'O','Ü':'U','İ':'I'};
function ysym(market,s,mkt){
  if(market&&typeof market.yahooSymbol==='function')return market.yahooSymbol(s,mkt);
  s=String(s||'').trim().toLocaleUpperCase('tr-TR').replace(/[ŞÇĞÖÜİ]/g,c=>TR_UP[c]).replace(/\s+/g,'');
  if(!s||!/^[A-Z0-9.=^-]{1,20}$/.test(s))return null;return /[.=^-]/.test(s)?s:mkt==='BIST'?s+'.IS':s}
const plainOf=y=>String(y||'').replace(/\.IS$/,'');
const nameOf=(code,mkt)=>mkt==='BIST'?NAMES[code]||NAMES500[code]||INDICES[code]||null:null;
// Kod -> sektor ('thyao', 'THYAO.IS' de olur). Listede yoksa: endeks -> 'Endeks'; kod sonu GYO/xxxGY -> GYO, BNK -> Bankacilik,
// HOL -> Holding (BIST adlandirma aliskanligi); yine yoksa 'Diğer'.
function sectorOf(code){
  const k=String(code==null?'':code).trim().toLocaleUpperCase('tr-TR').replace(/[ŞÇĞÖÜİ]/g,c=>TR_UP[c]).replace(/\.IS$/,'');
  if(!k)return 'Diğer';if(SECTORS[k])return SECTORS[k];if(INDICES[k]||/^XU\d{3}$/.test(k))return 'Endeks';
  if(/^[A-Z0-9]{2}GYO$/.test(k)||/^[A-Z]{3}GY$/.test(k))return 'GYO';if(/^[A-Z]{2}BNK$/.test(k))return 'Bankacılık';if(/^[A-Z]{2}HOL$/.test(k))return 'Holding';
  return 'Diğer'}
const scoreOf=r=>r&&fin(r.score)?r.score:r&&r.verdict&&fin(r.verdict.score)?r.verdict.score:null;
const symCmp=(a,b)=>{const x=String(a&&a.symbol||''),y=String(b&&b.symbol||'');return x<y?-1:x>y?1:0};
const objRows=rows=>(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object'&&!Array.isArray(r));
// Yuzdelik sira 0-100 (en dusuk 0, en yuksek 100; esitler ortalama sirayi alir; tek gecerli deger 50). Sayi olmayan -> null.
function pctRank(vals){
  const out=vals.map(()=>null),ix=[];vals.forEach((v,i)=>{if(fin(v))ix.push(i)});const n=ix.length;if(!n)return out;
  ix.sort((a,b)=>vals[a]-vals[b]);
  for(let i=0;i<n;){let j=i;while(j+1<n&&vals[ix[j+1]]===vals[ix[i]])j++;const p=n>1?(i+j)/2/(n-1)*100:50;for(let k=i;k<=j;k++)out[ix[k]]=p;i=j+1}
  return out}

// Faktor siralamasi (verilen satirlar icinde yuzdelik): mom = 60g ve 120g getiri yuzdeliklerinin ortalamasinin yeniden yuzdeligi
// (biri yoksa digeri), rs = XU100'e gore 20g goreli guc, trend = karar skoru, lowVol = dusuk ATR% (dusuk oynaklik yuksek puan).
// total = agirlikli ortalama (mom .35, rs .25, trend .25, lowVol .15); eksik faktorde agirliklar kalanlara yeniden dagitilir,
// kapsanan agirlik < 0,5 ise total null (cov = kapsanan agirlik). Goreli siralamadir: evren degisirse puan degisir; tahmin degildir.
const FW={mom:0.35,rs:0.25,trend:0.25,lowVol:0.15};
function factorRank(rows){
  const rs=objRows(rows),pf=k=>rs.map(r=>r.perf&&fin(r.perf[k])?r.perf[k]:null);
  const a=pctRank(pf('d60')),b=pctRank(pf('d120'));
  const blend=rs.map((_,i)=>fin(a[i])&&fin(b[i])?(a[i]+b[i])/2:fin(a[i])?a[i]:fin(b[i])?b[i]:null);
  const F={mom:pctRank(blend),rs:pctRank(rs.map(r=>fin(r.rs20)?r.rs20:null)),trend:pctRank(rs.map(scoreOf)),
    lowVol:pctRank(rs.map(r=>fin(r.atrPct)&&r.atrPct>0?-r.atrPct:null))};
  return rs.map((r,i)=>{const f={};let s=0,w=0;
    for(const k of Object.keys(FW)){const v=F[k][i];f[k]=rnd(v,1);if(fin(v)){s+=v*FW[k];w+=FW[k]}}
    f.total=w>=0.5-1e-9?rnd(s/w,1):null;f.cov=rnd(w,2);return {...r,factor:f}})}

// Liderler: by 'total'|'mom'|'rs'|'trend'|'lowVol' (faktor; satirlarda yoksa hesaplanir) ya da 'score' (karar skoru).
// Degeri olmayan satir listeye girmez. order 'asc' -> en zayiflar. Esitlikte skor, sonra kod.
const LEAD_BY=['total','mom','rs','trend','lowVol','score'];
function leaders(rows,o){o=o&&typeof o==='object'?o:{};
  const by=LEAD_BY.includes(o.by)?o.by:'total',n=fin(+o.n)&&+o.n>=1?Math.min(500,Math.floor(+o.n)):10,sg=o.order==='asc'?-1:1;
  let rs=objRows(rows);
  if(by!=='score'&&!rs.every(r=>r.factor&&typeof r.factor==='object'))rs=factorRank(rs);
  const val=by==='score'?scoreOf:r=>r.factor&&fin(r.factor[by])?r.factor[by]:null,sc=r=>fin(scoreOf(r))?scoreOf(r):-Infinity;
  return rs.filter(r=>fin(val(r))).sort((x,y)=>sg*(val(y)-val(x))||(sc(y)-sc(x))||symCmp(x,y)).slice(0,n)}

// Sektor ozeti (tarama satirlarindan). Sektor satirdaki 'sector' alanindan, yoksa koddan. Ortalamalar yalniz sayi olan
// degerlerle (yoksa null); leaders = skora gore ilk 3 kod. Siralama: ortalama skor (azalan), sonra hisse sayisi.
// Not: az hisseli sektorde ortalama gurultuludur (n'e bak).
function sectorStats(rows){
  const G=new Map();
  for(const r of objRows(rows)){const s=typeof r.sector==='string'&&r.sector.trim()?r.sector.trim():sectorOf(r.symbol);if(!G.has(s))G.set(s,[]);G.get(s).push(r)}
  const avg=(xs,d=2)=>{const v=xs.filter(fin);return v.length?rnd(v.reduce((x,y)=>x+y,0)/v.length,d):null};
  const out=[];
  for(const [sector,rs] of G){const lab=l=>rs.filter(r=>r.verdict&&r.verdict.label===l).length,sc=r=>fin(scoreOf(r))?scoreOf(r):-Infinity;
    const named=rs.filter(r=>typeof r.symbol==='string'&&r.symbol).sort((x,y)=>sc(y)-sc(x)||symCmp(x,y));
    out.push({sector,n:rs.length,avgChg:avg(rs.map(r=>r.chgPct)),avgD20:avg(rs.map(r=>r.perf&&r.perf.d20)),avgRs20:avg(rs.map(r=>r.rs20)),
      avgScore:avg(rs.map(scoreOf),1),avgTotal:avg(rs.map(r=>r.factor&&r.factor.total),1),
      al:lab('AL'),bekle:lab('BEKLE'),sat:lab('SAT'),up:rs.filter(r=>fin(r.chgPct)&&r.chgPct>=0.005).length,down:rs.filter(r=>fin(r.chgPct)&&r.chgPct<=-0.005).length,
      leaders:named.filter(r=>fin(scoreOf(r))).slice(0,3).map(r=>r.symbol),symbols:named.map(r=>r.symbol)})}
  const k=v=>fin(v)?v:-Infinity;
  return out.sort((x,y)=>(k(y.avgScore)-k(x.avgScore))||(y.n-x.n)||x.sector.localeCompare(y.sector,'tr'))}

const isRate=e=>/çok sık|HTTP 429|rate limit/i.test(String(e&&e.message||e));
const isNet=e=>/Bağlantı yok|yanıt vermedi/i.test(String(e&&e.message||e));

// Gunluk mumlardan haftalik mum (Pazartesi baslangicli Istanbul haftasi). t = haftanin ilk mumunun zamani. Ek istek gerektirmez.
function resampleWeekly(rows){
  const out=[];let cur=null,wk=null;
  for(const r of cleanRows(rows)){const d=dayIdx(r.t),w=Math.floor((d+3)/7); // 1970-01-01 Persembe: +3 ile hafta Pazartesi baslar
    if(w!==wk){wk=w;cur={t:r.t,o:r.o,h:r.h,l:r.l,c:r.c,v:fin(r.v)?r.v:null};out.push(cur);continue}
    cur.h=Math.max(cur.h,r.h);cur.l=Math.min(cur.l,r.l);cur.c=r.c;if(fin(r.v))cur.v=(cur.v||0)+r.v}
  return out}

// Kisa-ad -> arama dizini (bir kez kurulur)
let IDX=null;
function index(){if(IDX)return IDX;const all=new Map();
  for(const k of Object.keys(NAMES))all.set(k,NAMES[k]);for(const k of B500)if(!all.has(k))all.set(k,NAMES500[k]||k);for(const k of Object.keys(INDICES))all.set(k,INDICES[k]);
  IDX=[...all].map(([symbol,name])=>({symbol,name,c:symbol.toLowerCase(),n:fold(name),a:fold(ALIAS[symbol]||''),rank:B30.includes(symbol)?0:B50.includes(symbol)?1:B100.includes(symbol)?2:INDICES[symbol]?3:4}));
  return IDX}
function search(q){
  const f=fold(q);if(!f)return [];const fc=f.replace(/ /g,'');
  const hits=[];
  for(const e of index()){let s=null;
    if(e.c===fc)s=0;else if(fc&&e.c.startsWith(fc))s=1;
    else if(e.n.startsWith(f)||e.n.includes(' '+f))s=2;else if(e.n.includes(f))s=3;
    else if(e.a&&(e.a.startsWith(f)||e.a.includes(' '+f)))s=4;else if(e.a.includes(f))s=5;
    if(s!=null)hits.push({e,s})}
  hits.sort((a,b)=>a.s-b.s||a.e.rank-b.e.rank||(a.s===1?a.e.c.length-b.e.c.length:0)||(a.e.symbol<b.e.symbol?-1:1));
  return hits.slice(0,12).map(h=>({symbol:h.e.symbol,name:h.e.name}))}

// --- Istatistik (gunluk mumlar varsayilir) -------------------------------------------------------------------------------
// perf: N mum once kapanisa gore %; hi52/lo52: son 252 mumun en yuksek/dusuk fiyati; hi52Dist <= 0 (zirvenin % kac altinda), lo52Dist >= 0;
// beta/corr: son 250 gunluk getiri, endeksle ayni gunler eslesir (en az 30 cift); rs.dN: hisse dN getirisi - endeks dN getirisi (puan);
// atrPct: ATR(14)/fiyat %; avgVolTL20: son 20 gun ortalama TL hacim (kapanis*adet); volAnn: yillik oynaklik % (log getiri std * sqrt(252));
// mom12: 12-1 ay momentumu % = 21 mum onceki kapanis / 252 mum onceki kapanis - 1 (son ay haric; en az 253 mum, yoksa null).
function statsOf(rows,benchRows,engine){
  const P=[1,5,20,60,120,250],rs=cleanRows(rows),N=rs.length;
  const out={n:N,last:N?rs[N-1].c:null,perf:Object.fromEntries(P.map(n=>['d'+n,null])),hi52:null,lo52:null,hi52Dist:null,lo52Dist:null,
    beta:null,corr:null,rs:{d20:null,d60:null},atrPct:null,avgVolTL20:null,volAnn:null,mom12:null};
  if(!N)return out;
  const c=rs.map(r=>r.c),x=c[N-1];
  for(const n of P)if(N>n)out.perf['d'+n]=rnd((x/c[N-1-n]-1)*100);
  if(N>252)out.mom12=rnd((c[N-22]/c[N-253]-1)*100);
  const w=rs.slice(-252);out.hi52=Math.max(...w.map(r=>r.h));out.lo52=Math.min(...w.map(r=>r.l));
  out.hi52Dist=rnd((x-out.hi52)/out.hi52*100);out.lo52Dist=rnd((x-out.lo52)/out.lo52*100);
  if(engine&&typeof engine.atrS==='function'&&N>15){const a=engine.atrS(rs,14)[N-1];if(fin(a))out.atrPct=rnd(a/x*100)}
  const tv=rs.slice(-20).filter(r=>fin(r.v)&&r.v>0).map(r=>r.c*r.v);if(tv.length)out.avgVolTL20=Math.round(tv.reduce((a,b)=>a+b,0)/tv.length);
  const lr=[];for(let i=Math.max(1,N-250);i<N;i++)lr.push(Math.log(c[i]/c[i-1]));
  if(lr.length>=20){const m=lr.reduce((a,b)=>a+b,0)/lr.length,v=lr.reduce((a,b)=>a+(b-m)**2,0)/(lr.length-1);out.volAnn=rnd(Math.sqrt(v*252)*100,1)}
  const B=cleanRows(benchRows);
  if(B.length>1){
    const bd=B.map(r=>dayIdx(r.t)),bmap=new Map(B.map((r,i)=>[bd[i],r.c]));
    const at=d=>{let lo=0,hi=bd.length-1,k=-1;while(lo<=hi){const m=(lo+hi)>>1;if(bd[m]<=d){k=m;lo=m+1}else hi=m-1}return k<0?null:B[k].c};
    const sd=rs.map(r=>dayIdx(r.t)),bx=at(sd[N-1]);
    for(const n of [20,60])if(N>n){const b0=at(sd[N-1-n]);if(bx&&b0&&out.perf['d'+n]!=null)out.rs['d'+n]=rnd(out.perf['d'+n]-(bx/b0-1)*100)}
    const S=[],M=[];for(let i=Math.max(1,N-250);i<N;i++){const b1=bmap.get(sd[i]),b0=bmap.get(sd[i-1]);if(b1&&b0){S.push(c[i]/c[i-1]-1);M.push(b1/b0-1)}}
    if(S.length>=30){const ms=S.reduce((a,b)=>a+b,0)/S.length,mm=M.reduce((a,b)=>a+b,0)/M.length;let cv=0,vs=0,vm=0;
      for(let i=0;i<S.length;i++){cv+=(S[i]-ms)*(M[i]-mm);vs+=(S[i]-ms)**2;vm+=(M[i]-mm)**2}
      if(vm>0){out.beta=rnd(cv/vm);out.corr=vs>0?rnd(cv/Math.sqrt(vs*vm)):null}}
  }
  return out}

// Tarayici etiketleri (saf). rows: birincil mumlar; pro: engine.proAnalyze; st: gunluk istatistik; tw: haftalik trend yonu.
function tagsOf({rows,pro,st,tw,engine}){
  const t=new Set(),N=rows.length,c=rows.map(r=>r.c),x=c[N-1];
  const bo=(pro.structure&&pro.structure.breakouts)||[],pt=(pro.structure&&pro.structure.patterns)||[];
  const atr=pro.volatility&&fin(pro.volatility.atr)?pro.volatility.atr:null,r=pro.momentum&&pro.momentum.rsi;
  if(N>=22){let hh=-Infinity,ll=Infinity;for(let i=N-21;i<N-1;i++){hh=Math.max(hh,rows[i].h);ll=Math.min(ll,rows[i].l)}
    if(x>hh)t.add('kirilim-yukari');if(x<ll)t.add('kirilim-asagi')}
  // Bolge kirilimi (engine) yalniz son 3 mumda ve hacim teyidiyle (kirilim mumu >= 1,5x); hacim verisi yoksa >= 3 temas + son mum.
  const VR=engine&&typeof engine.volRatio==='function'?engine.volRatio(rows):[];
  for(const b of bo){if(!fin(b.ago)||b.ago>3)continue;const vr=VR[N-1-b.ago];
    if(fin(vr)?vr>=1.5:(b.touches>=3&&b.ago<=1))t.add(b.dir>0?'kirilim-yukari':'kirilim-asagi')}
  if(pro.volatility&&pro.volatility.bb&&pro.volatility.bb.squeeze)t.add('sikisma');
  // Uyumsuzluk baglamla: pozitif zayif bolgede (RSI <= 45), negatif guclu bolgede (RSI >= 55) anlamlidir.
  for(const d of (pro.momentum&&pro.momentum.divergences)||[]){if(d.dir>0&&fin(r)&&r<=45)t.add('uyumsuzluk-pozitif');if(d.dir<0&&fin(r)&&r>=55)t.add('uyumsuzluk-negatif')}
  if(engine&&typeof engine.smaS==='function'&&N>=211){const a=engine.smaS(c,50),b=engine.smaS(c,200),up=a[N-1]>b[N-1];
    for(let k=N-1;k>=N-10;k--){if(!fin(a[k])||!fin(b[k])||!fin(a[k-1])||!fin(b[k-1]))break;
      if(up&&a[k]>b[k]&&a[k-1]<=b[k-1]){t.add('altin-kesisim');break}if(!up&&a[k]<b[k]&&a[k-1]>=b[k-1]){t.add('olum-kesisimi');break}}}
  if(fin(r)){if(r<=30)t.add('asiri-satim');if(r>=70)t.add('asiri-alim')}
  if(st&&fin(st.hi52Dist)&&st.hi52Dist>=-2)t.add('zirve52');
  if(st&&fin(st.lo52Dist)&&st.lo52Dist<=2)t.add('dip52');
  if(pro.volume&&fin(pro.volume.ratio)&&pro.volume.ratio>=2)t.add('hacim-patlamasi');
  const T=pro.trend&&pro.trend.primary;if(T&&fin(T.adx)&&T.adx>=25&&T.dir===1&&fin(T.pdi)&&fin(T.mdi)&&T.pdi>T.mdi&&tw!==-1)t.add('guclu-trend');
  // Ikili dip/tepe: onayli ya da fiyat boyun cizgisine 1 ATR'den yakin (tetige hazir); uzak "olusan" formasyonlar gurultudur.
  const ready=p=>p.confirmed||(atr!=null&&fin(p.neck)&&Math.abs(p.neck-x)<=atr);
  for(const p of pt){if(p.name==='Boğa bayrağı')t.add('bayrak');if(p.name==='İkili dip'&&ready(p))t.add('ikili-dip');if(p.name==='İkili tepe'&&ready(p))t.add('ikili-tepe')}
  return Object.keys(TAGS).filter(k=>t.has(k))} // sabit sira

// --- Fabrika ---------------------------------------------------------------------------------------------------------
function createData({market=require('./market'),engine=require('./engine'),now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const SPARK_TTL=30*60000,SPARK_FAIL_TTL=5*60000,sparks=new Map(); // kod|piyasa -> {at, closes, day, fail}
  const TFS=market&&market.TF?Object.keys(market.TF):['1dk','5dk','15dk','1s','1g','1h'];
  const pause=(ms,signal)=>!(ms>0)?Promise.resolve():new Promise(res=>{let done=false;
    const end=()=>{if(done)return;done=true;if(signal)signal.removeEventListener('abort',end);res()};
    if(signal){if(signal.aborted)return res();signal.addEventListener('abort',end,{once:true})}
    Promise.resolve().then(()=>sleep(ms)).then(end,end)});
  // items uzerinde en fazla n eszamanli is; stop() true olunca yeni is baslatilmaz.
  async function pool(items,n,fn,stop=()=>false){let next=0;
    const worker=async()=>{while(!stop()){const k=next++;if(k>=items.length)return;await fn(items[k],k)}};
    await Promise.all(Array.from({length:Math.max(1,Math.min(n|0||1,items.length))},worker))}

  function putSpark(key,rows){const rs=cleanRows(rows);if(!rs.length)return null;
    const v={at:now(),closes:rs.slice(-30).map(r=>r.c),day:dayIdx(rs[rs.length-1].t)};sparks.set(key,v);
    if(sparks.size>500)sparks.delete(sparks.keys().next().value);return v}
  // Gunluk 30 kapanis; son nokta canli fiyatla guncellenir (ayni gunse degistir, yeni gunse ekle).
  async function sparkFor(sym,mkt,q,net){
    const key=sym+'|'+mkt;let s=sparks.get(key);
    if(!s||now()-s.at>(s.fail?SPARK_FAIL_TTL:SPARK_TTL)){
      try{const r=await market.candles(sym,'1g',mkt);if(!r.cached)net.hit=true;s=putSpark(key,r.rows)||{at:now(),closes:[],day:null,fail:true};sparks.set(key,s)}
      catch(e){s={at:now(),closes:[],day:null,fail:true};sparks.set(key,s)}}
    const out=s.closes.slice();
    if(out.length&&q&&fin(q.price)&&fin(q.time)&&s.day!=null){const d=dayIdx(q.time);if(d===s.day)out[out.length-1]=q.price;else if(d>s.day){out.push(q.price);if(out.length>30)out.shift()}}
    return out}
  const EMPTY_Q={price:null,prev:null,chg:null,chgPct:null,dayHigh:null,dayLow:null,volume:null,time:null,name:null,currency:null};
  // Tek sembol fiyat: market.quote; olmazsa gunluk mum onbellegindeki fiyat (stale).
  async function quoteOne(y,mkt,net){
    if(typeof market.quote==='function'){
      try{const q=await market.quote(y,mkt);if(!q||!fin(q.price))throw new Error('Fiyat alınamadı.');if(!q.cached)net.hit=true;return q}
      catch(e){if(/bulunamadı|Geçerli/.test(String(e&&e.message)))throw e;
        try{const r=await market.candles(y,'1g',mkt);if(!r.cached)net.hit=true;const q=r.quote||{};if(!fin(q.price))throw e;
        return {...q,stale:true,staleReason:e.message}}catch(e2){throw e}}}
    const r=await market.candles(y,'1g',mkt);if(!r.cached)net.hit=true;return {...(r.quote||{}),stale:!!r.stale}}
  function shapeQuote(q){const price=fin(q.price)?q.price:null,prev=fin(q.prev)&&q.prev>0?q.prev:null;
    return {price,prev,chg:fin(q.chg)?q.chg:price!=null&&prev!=null?rnd(price-prev,4):null,
      chgPct:fin(q.chgPct)?q.chgPct:price!=null&&prev!=null?rnd((price-prev)/prev*100):null,
      dayHigh:fin(q.dayHigh)?q.dayHigh:null,dayLow:fin(q.dayLow)?q.dayLow:null,volume:fin(q.volume)?q.volume:null,time:fin(q.time)?q.time:null,
      currency:q.currency||null,stale:!!q.stale}}

  // Toplu fiyat. Sira korunur; ayni kod tekrar edilirse tek istek. En fazla 4 eszamanli istek, ag istegi sonrasi kisa bekleme.
  async function quotes(symbols,{market:mkt='BIST',spark=true,concurrency=4,gap=80}={}){
    const list=(Array.isArray(symbols)?symbols:[]).slice(0,200),uniq=new Map();
    for(const s of list){const y=ysym(market,s,mkt);if(y&&!uniq.has(y))uniq.set(y,null)}
    const keys=[...uniq.keys()];
    await pool(keys,Math.min(4,Math.max(1,concurrency)),async y=>{const net={hit:false},code=plainOf(y);let row;
      try{const q=await quoteOne(y,mkt,net);const sp=spark?await sparkFor(y,mkt,q,net):[];
        row={...shapeQuote(q),name:nameOf(code,mkt)||q.name||null,spark:sp,error:null}}
      catch(e){row={...EMPTY_Q,name:nameOf(code,mkt)||null,spark:[],stale:false,error:String(e&&e.message||e)}}
      uniq.set(y,row);if(net.hit)await pause(gap)});
    return list.map(s=>{const y=ysym(market,s,mkt);
      if(!y)return {symbol:String(s==null?'':s).trim().toUpperCase()||'?',...EMPTY_Q,spark:[],stale:false,error:'Geçersiz kod.'};
      return {symbol:plainOf(y),...uniq.get(y)}})}

  // Piyasa ozeti: MACRO semboller oldugu gibi (market 'US').
  async function overview(){const rs=await quotes(MACRO.map(m=>m.sym),{market:'US'});
    return MACRO.map((m,i)=>{const r=rs[i]||{};return {sym:m.sym,name:m.name,price:r.price??null,chg:r.chg??null,chgPct:r.chgPct??null,spark:r.spark||[],
      time:r.time??null,currency:r.currency||null,stale:!!r.stale,error:r.error||null}})}

  function breadth(rows){const o={up:0,down:0,flat:0,avgChg:null,al:0,sat:0,bekle:0,total:0};let s=0,k=0;
    for(const r of Array.isArray(rows)?rows:[]){if(!r)continue;o.total++;
      if(fin(r.chgPct)){s+=r.chgPct;k++;if(r.chgPct>=0.005)o.up++;else if(r.chgPct<=-0.005)o.down++;else o.flat++}
      const l=r.verdict&&r.verdict.label;if(l==='AL')o.al++;else if(l==='SAT')o.sat++;else if(l==='BEKLE')o.bekle++}
    o.avgChg=k?rnd(s/k):null;return o}

  function matches(row,presetId){if(!presetId)return true;const f=PRESET_FN[presetId];if(!f)return true;try{return !!(row&&f(row))}catch(e){return false}}
  const stats=(rows,benchRows)=>statsOf(rows,benchRows,engine);

  // Tek sembol analizi (tarayici satiri).
  async function scanOne(y,tf,mkt,bench,net){
    const get=async k=>{const r=await market.candles(y,k,mkt);if(!r||!Array.isArray(r.rows))throw new Error('Mum verisi yok.');if(!r.cached)net.hit=true;return r};
    const P=await get(tf);let D=tf==='1g'?P:null;
    if(tf!=='1g'){try{D=await get('1g')}catch(e){D=null}}
    const rows=cleanRows(P.rows),daily=D?cleanRows(D.rows):null,frames={[tf]:rows};
    if(tf==='1g')frames['1h']=resampleWeekly(rows);else if(daily&&daily.length){frames['1g']=daily;if(tf!=='1h')frames['1h']=resampleWeekly(daily)}
    const pro=engine.proAnalyze(frames,{primary:tf,riskPct:1});
    if(!pro||!pro.ok)throw new Error((pro&&pro.error)||'Analiz yapılamadı.');
    const code=plainOf(y),st=statsOf(daily||[],bench,engine),q=(D&&D.quote)||P.quote||{},N=rows.length;
    const price=fin(q.price)?q.price:rows[N-1].c;
    let prev=fin(q.prev)&&q.prev>0?q.prev:null;
    if(prev==null&&daily&&daily.length>1){const d=dayIdx(daily[daily.length-1].t);for(let i=daily.length-2;i>=0;i--)if(dayIdx(daily[i].t)!==d){prev=daily[i].c;break}}
    const fr=pro.trend.frames||{},tw=fr['1h']?fr['1h'].dir:null,td=fr['1g']?fr['1g'].dir:null;
    const R=typeof engine.rsi==='function'?engine.rsi(rows.map(r=>r.c),14):[],rl=R.slice(-5).filter(fin);
    const turn=N>2&&fin(R[N-1])&&fin(R[N-2])?(R[N-1]>R[N-2]&&rows[N-1].c>rows[N-2].c?1:R[N-1]<R[N-2]&&rows[N-1].c<rows[N-2].c?-1:0):0;
    const v=pro.verdict,pl=pro.plan&&!pro.plan.wait?pro.plan:null;
    if(daily&&daily.length)putSpark(y+'|'+mkt,daily);
    return {symbol:code,name:nameOf(code,mkt)||q.name||null,sector:mkt==='BIST'?sectorOf(code):'Diğer',price,chgPct:prev?rnd((price-prev)/prev*100):null,
      verdict:{label:v.label,dir:v.dir,score:v.score,confidence:v.confidence},rr:pl&&fin(pl.rr)?pl.rr:null,
      atrPct:pro.volatility?pro.volatility.atrPct:null,volRatio:pro.volume?pro.volume.ratio:null,rsi:pro.momentum?pro.momentum.rsi:null,
      adx:pro.trend.primary?pro.trend.primary.adx:null,trend:{d:td,w:tw},
      perf:{d5:st.perf.d5,d20:st.perf.d20,d60:st.perf.d60,d120:st.perf.d120,d250:st.perf.d250},mom12:st.mom12,rs20:st.rs.d20,hi52Dist:st.hi52Dist,lo52Dist:st.lo52Dist,
      plan:pl?{dir:pl.dir,entry:pl.entry,stop:pl.stop,t1:pl.t1,rr:pl.rr}:null,
      tags:tagsOf({rows,pro,st:daily&&daily.length?st:null,tw,engine}),score:v.score,
      reasons:(v.reasons||[]).slice(0,3),rsiMin5:rl.length?rnd(Math.min(...rl),1):null,turn,time:rows[N-1].t,stale:!!(P.stale||(D&&D.stale))}}

  // Tarayici. Iptal: signal (AbortSignal) -> eldeki satirlarla hemen doner (cancelled:true). Yahoo nezaketi: en fazla
  // `concurrency` (1-4) eszamanli sembol, ag istegi yapan her sembolden sonra `gap` ms bekleme, 429'da tum isciler
  // 5 sn (her seferinde 2 kat, en fazla 30 sn) durur ve sembol 2 kez yeniden denenir. Baglanti hic yoksa 6 hatadan sonra durur.
  async function scan(symbols,{tf='1g',market:mkt='BIST',signal=null,onProgress=null,concurrency=3,bench,gap=250}={}){
    if(!TFS.includes(tf))tf='1g';
    if(!(signal&&typeof signal.addEventListener==='function'))signal=null;
    const seen=new Set(),items=[];
    for(const s of Array.isArray(symbols)?symbols:[]){const y=ysym(market,s,mkt),k=y||String(s==null?'':s).trim().toUpperCase();if(!k||seen.has(k))continue;seen.add(k);items.push({s,y})}
    const out={at:null,tf,market:mkt,total:items.length,rows:[],errors:[],cancelled:false,error:null};
    const aborted=()=>!!(signal&&signal.aborted);
    let done=0,ok=0,netFails=0,stopped=false,pauseUntil=0,backoff=5000;
    const prog=sym=>{if(typeof onProgress==='function')try{onProgress({done,total:items.length,symbol:sym})}catch(e){}};
    // Bitiste satirlar skora gore siralanir ve taranan evren icinde faktor puani (factorRank) eklenir.
    const finish=()=>{out.cancelled=aborted();out.at=now();out.rows.sort((a,b)=>b.score-a.score||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0));out.rows=factorRank(out.rows);return out};
    if(aborted())return finish();
    // Iptal sozu: beklenen her seyle yarisir (dis istek iptal edilemese de sonucu beklenmez).
    let onAbort=null;const abP=signal?new Promise(r=>{onAbort=r;signal.addEventListener('abort',r,{once:true})}):null;
    const race=p=>abP?Promise.race([p,abP]):p;
    prog(null);
    let B=bench;
    if(B===undefined){B=null;if(mkt==='BIST'&&items.length){try{const r=await race(market.candles('XU100','1g','BIST'));B=r?cleanRows(r.rows):null}catch(e){B=null}}}
    else B=B?cleanRows(B):null;
    if(B&&!B.length)B=null;
    const stop=()=>aborted()||stopped;
    const work=pool(items,Math.min(4,Math.max(1,concurrency|0||1)),async({s,y})=>{
      const sym=y?plainOf(y):String(s==null?'':s).trim().toUpperCase();const net={hit:false};
      try{if(!y)throw new Error('Geçersiz kod.');
        let row=null;
        for(let attempt=0;;attempt++){
          const w=pauseUntil-now();if(w>0)await pause(w,signal);
          if(stop())return;
          try{row=await scanOne(y,tf,mkt,B,net);break}
          catch(e){if(isRate(e)&&attempt<2&&!stop()){pauseUntil=Math.max(pauseUntil,now()+backoff);backoff=Math.min(backoff*2,30000);gap=Math.min(Math.max(gap,250)*2,2000);continue}throw e}}
        if(stop())return;
        out.rows.push(row);ok++;netFails=0;backoff=Math.max(5000,backoff/2);
      }catch(e){if(stop())return;out.errors.push({symbol:sym,error:String(e&&e.message||e)});
        if(y)net.hit=true; // hatali istekten sonra da bekle (art arda 5xx ile Yahoo'yu yorma)
        if(isNet(e)&&!ok&&++netFails>=6){stopped=true;out.error='Veri sağlayıcıya ulaşılamıyor; tarama durduruldu.'}}
      done++;prog(sym);
      if(net.hit&&!stop())await pause(gap,signal)},stop);
    if(!aborted())await race(work);
    if(signal&&onAbort)signal.removeEventListener('abort',onAbort);
    return finish()}

  return {quotes,scan,matches,stats,overview,breadth,search,sectorOf,sectorStats,factorRank,leaders}}

module.exports={createData,U,NAMES,MACRO,PRESETS,TAGS,resampleWeekly,SECTORS,SECTOR_NAMES,sectorOf,sectorStats,factorRank,leaders,
  _util:{fold,statsOf,tagsOf,cleanRows,dayIdx,INDICES,ALIAS,PRESET_FN,SEC_LIST,pctRank,FW}};
