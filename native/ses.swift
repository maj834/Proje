// Ses yardimcisi: uygulama basina ses seviyesi (%0-200), bas/tiz ayari, cikis aygiti ve ana ses.
// macOS 14.4+ Core Audio "process tap" ile calisir: hedef uygulamanin sesi yakalanip orijinali susturulur,
// islenmis hali (kazanc + bas/tiz + yumusak sinirlayici) cikis aygitina verilir. Ayari notr olan uygulamaya dokunulmaz.
// Iletisim: stdin satir basina JSON komut, stdout satir basina JSON olay (Electron ana sureci yonetir).
import Foundation
import CoreAudio
import AudioToolbox
import AppKit
import os

// MARK: - JSON cikis
let outLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) else { return }
    outLock.lock(); FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!); outLock.unlock()
}
func fail(_ msg: String, _ code: OSStatus = 0) { emit(["type": "error", "msg": msg, "code": Int(code)]) }

// MARK: - Core Audio yardimcilari
func addr(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func getIDs(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> [AudioObjectID] {
    var a = addr(sel, scope); var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(obj, &a, 0, nil, &size) == noErr, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}
func getU32(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32? {
    var a = addr(sel, scope); var v: UInt32 = 0; var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
}
func getString(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var a = addr(sel); var v: Unmanaged<CFString>? = nil; var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr, let s = v?.takeRetainedValue() else { return nil }
    return s as String
}
func getF64(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> Float64? {
    var a = addr(sel); var v: Float64 = 0; var size = UInt32(MemoryLayout<Float64>.size)
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : nil
}
let system = AudioObjectID(kAudioObjectSystemObject)

// Aygitin toplam cikis kanali sayisi (kAudioDevicePropertyStreamConfiguration degisken boyutlu AudioBufferList dondurur)
func outputChannels(_ dev: AudioObjectID) -> Int {
    var a = addr(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput); var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(dev, &a, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16); defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(dev, &a, 0, nil, &size, raw) == noErr else { return 0 }
    let list = UnsafeMutableAudioBufferListPointer(raw.bindMemory(to: AudioBufferList.self, capacity: 1))
    var n = 0; for b in list { n += Int(b.mNumberChannels) }
    return n
}
// Islemeyi etkileyen aygit durumu: ornekleme hizi, cikis kanal sayisi, aygit canli mi. Yalnizca bu imza
// degisince yeniden kurulur (kendi kurdugumuz toplu aygitin tetikleyebilecegi bildirimler donguye girmesin).
func outputSignature(_ dev: AudioObjectID) -> String {
    "\(getF64(dev, kAudioDevicePropertyNominalSampleRate) ?? 0)/\(outputChannels(dev))/\(getU32(dev, kAudioDevicePropertyDeviceIsAlive) ?? 0)"
}

// Core Audio ozellik dinleyicisi. Bloklar motorun seri kuyrugunda (ana kuyruk) calisir. Kaldirmak icin
// AudioObjectRemovePropertyListenerBlock'a ayni blok nesnesi ve ayni kuyruk verilmeli: ikisi de burada saklanir.
final class Listener {
    let obj: AudioObjectID; let addrs: [AudioObjectPropertyAddress]; let queue: DispatchQueue
    let block: AudioObjectPropertyListenerBlock
    init(_ obj: AudioObjectID, _ addrs: [AudioObjectPropertyAddress], _ queue: DispatchQueue, _ block: @escaping AudioObjectPropertyListenerBlock) {
        self.obj = obj; self.addrs = addrs; self.queue = queue; self.block = block
        for a0 in addrs { var a = a0; _ = AudioObjectAddPropertyListenerBlock(obj, &a, queue, self.block) }
    }
    func remove() { for a0 in addrs { var a = a0; _ = AudioObjectRemovePropertyListenerBlock(obj, &a, queue, block) } }
}

func defaultOutput() -> AudioObjectID? { getU32(system, kAudioHardwarePropertyDefaultOutputDevice) }

func outputDevices() -> [[String: Any]] {
    let def = defaultOutput()
    return getIDs(system, kAudioHardwarePropertyDevices).compactMap { id in
        var a = addr(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput); var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return nil }
        guard let uid = getString(id, kAudioDevicePropertyDeviceUID), let name = getString(id, kAudioObjectPropertyName) else { return nil }
        if uid.hasPrefix("ses-yardimcisi") { return nil }
        var d: [String: Any] = ["id": Int(id), "uid": uid, "name": name, "default": id == def]
        if let v = masterVolume(id) { d["volume"] = v }
        if let m = getU32(id, kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput) { d["muted"] = m != 0 }
        return d
    }
}
func masterVolume(_ dev: AudioObjectID) -> Float? {
    var a = addr(kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioObjectPropertyScopeOutput)
    var v: Float32 = 0; var size = UInt32(MemoryLayout<Float32>.size)
    return AudioHardwareServiceGetPropertyData(dev, &a, 0, nil, &size, &v) == noErr ? v : nil
}
func setMasterVolume(_ value: Float) {
    guard let dev = defaultOutput() else { return }
    var a = addr(kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioObjectPropertyScopeOutput)
    var v = Float32(max(0, min(1, value)))
    let err = AudioHardwareServiceSetPropertyData(dev, &a, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
    if err != noErr { fail("Bu çıkış aygıtının sesi buradan ayarlanamıyor.", err) }
}
func setMasterMute(_ on: Bool) {
    guard let dev = defaultOutput() else { return }
    var a = addr(kAudioDevicePropertyMute, kAudioObjectPropertyScopeOutput); var v: UInt32 = on ? 1 : 0
    let err = AudioObjectSetPropertyData(dev, &a, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v)
    if err != noErr { fail("Bu çıkış aygıtı susturulamıyor.", err) }
}
func setDefaultOutput(uid: String) {
    for id in getIDs(system, kAudioHardwarePropertyDevices) where getString(id, kAudioDevicePropertyDeviceUID) == uid {
        var a = addr(kAudioHardwarePropertyDefaultOutputDevice); var v = id
        let err = AudioObjectSetPropertyData(system, &a, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &v)
        if err != noErr { fail("Çıkış aygıtı değiştirilemedi.", err) }
        return
    }
}

// MARK: - Ses ureten uygulamalar
// device: surecin gercekte caldigi cikis aygiti (bilinmiyorsa nil; bkz. processOutputDevice)
struct AudioProc { let obj: AudioObjectID; let pid: pid_t; let bundle: String; let playing: Bool; let device: AudioObjectID? }

// Surecin kullandigi cikis aygiti (kAudioProcessPropertyDevices, cikis kapsami; macOS 14.2+). Surec bosta iken
// liste bos olabilir: nil doner, motor uygulamanin diger sureclerine / mevcut yakalamaya / varsayilan cikisa duser.
// Tek surec birden cok aygita caliyorsa: varsayilan cikis listedeyse o, degilse ilki. (Tap surecin tum cikisini
// tek bir stereo karisim olarak yakalar; tek surecin sesi aygitlara gore ayrilamaz.) Kendi toplu aygitlarimiz atlanir.
@available(macOS 14.2, *)
func processOutputDevice(_ obj: AudioObjectID, defaultID: AudioObjectID?) -> AudioObjectID? {
    let ids = getIDs(obj, kAudioProcessPropertyDevices, kAudioObjectPropertyScopeOutput).filter { id in
        id != kAudioObjectUnknown && !(getString(id, kAudioDevicePropertyDeviceUID) ?? "ses-yardimcisi").hasPrefix("ses-yardimcisi")
    }
    if let d = defaultID, ids.contains(d) { return d }
    return ids.first
}

// Yardimci surecleri ana uygulamaya bagla (Chrome Helper -> Chrome). WebKit sureci Safari, Mail ve diger
// web gorunumlerinde ortaktir: ayri bir "Web icerigi" kalemi olarak gosterilir.
func ownerBundle(_ bundle: String, pid: pid_t) -> String {
    if bundle.hasPrefix("com.apple.WebKit") { return "com.apple.WebKit" }
    if let r = bundle.range(of: ".helper", options: .caseInsensitive) { return String(bundle[..<r.lowerBound]) }
    return bundle
}
func audioProcesses() -> [AudioProc] {
    if #available(macOS 14.2, *) {
        let me = getpid(), def = defaultOutput()
        return getIDs(system, kAudioHardwarePropertyProcessObjectList).compactMap { obj in
            guard let pidU = getU32(obj, kAudioProcessPropertyPID) else { return nil }
            let pid = pid_t(bitPattern: pidU); if pid == me { return nil }
            let raw = getString(obj, kAudioProcessPropertyBundleID) ?? ""
            let bundle = raw.isEmpty ? (NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? "pid.\(pid)") : raw
            let playing = (getU32(obj, kAudioProcessPropertyIsRunningOutput) ?? 0) != 0
            return AudioProc(obj: obj, pid: pid, bundle: ownerBundle(bundle, pid: pid), playing: playing,
                             device: processOutputDevice(obj, defaultID: def))
        }
    }
    return []
}
func appInfo(_ bundle: String) -> [String: Any] {
    var d: [String: Any] = ["bundle": bundle, "name": bundle]
    if bundle == "com.apple.WebKit" { d["name"] = "Web içeriği (Safari, Mail…)"; return d }
    if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first {
        d["name"] = app.localizedName ?? bundle
        if let p = app.bundleURL?.path { d["path"] = p }
    } else if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
        d["name"] = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: ""); d["path"] = url.path
    }
    return d
}

// MARK: - Isleme (kazanc + raf filtreleri + yumusak sinirlayici)
struct Settings: Equatable { var gain: Float = 1; var bass: Float = 0; var treble: Float = 0; var mute = false
    var neutral: Bool { !mute && abs(gain - 1) < 0.005 && abs(bass) < 0.1 && abs(treble) < 0.1 } }

// RBJ ses kitabi raf filtresi katsayilari (S = 1). Kose frekansi Nyquist'e yaklasinca (or. 8 kHz Bluetooth
// HFP'de 7 kHz tiz) filtre kararsizlasir: f0 en fazla 0,45 * fs.
func shelf(low: Bool, f0: Double, dB: Double, fs: Double) -> [Float] {
    let f = min(f0, 0.45 * fs)
    let A = pow(10, dB / 40), w0 = 2 * Double.pi * f / fs, cw = cos(w0), sw = sin(w0)
    let alpha = sw / 2 * sqrt(2.0), sA = 2 * sqrt(A) * alpha
    var b0, b1, b2, a0, a1, a2: Double
    if low {
        b0 = A * ((A + 1) - (A - 1) * cw + sA); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sA)
        a0 = (A + 1) + (A - 1) * cw + sA; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sA
    } else {
        b0 = A * ((A + 1) + (A - 1) * cw + sA); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sA)
        a0 = (A + 1) - (A - 1) * cw + sA; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sA
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0].map { Float($0) }
}

// Gercek zamanli ses dizisi kurallari: geri cagirmada bellek ayirma, kilit bekleme ve Swift dizisi yok.
// Ayarlar ana dizide hesaplanir, ses dizisine kilitsiz (trylock) aktarilir; filtre durumu sabit tamponda.
final class Processor {
    typealias K = (Float, Float, Float, Float, Float)
    struct Params { var gain: Float = 1; var low: K = (1, 0, 0, 0, 0); var high: K = (1, 0, 0, 0, 0) }
    static let maxCh = 64
    private(set) var fs: Double = 48000                         // cikis aygitinin guncel hizi (yalnizca ana dizi)
    private(set) var last = Settings()
    private let lock: UnsafeMutablePointer<os_unfair_lock> = { let p = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1); p.initialize(to: os_unfair_lock()); return p }()
    private var pending = Params(), live = Params()
    private let z: UnsafeMutablePointer<Float> = { let p = UnsafeMutablePointer<Float>.allocate(capacity: Processor.maxCh * 4); p.initialize(repeating: 0, count: Processor.maxCh * 4); return p }()
    private var g: Float = 1
    // Ses dizisinin yazdigi sayaclar (izin reddi = surekli sessiz yakalama tespiti icin).
    // heard: yakalama en az bir kez sessiz olmayan ornek verdi (izin var; sonraki uzun sessizlik ret sayilmaz)
    var callbacks = 0, silent = 0
    var heard = false
    deinit { z.deallocate(); lock.deallocate() }
    func update(_ s: Settings) {                                   // ana dizi
        func t(_ a: [Float]) -> K { (a[0], a[1], a[2], a[3], a[4]) }
        last = s
        var p = Params(); p.gain = s.mute ? 0 : s.gain
        if abs(s.bass) >= 0.1 { p.low = t(shelf(low: true, f0: 110, dB: Double(s.bass), fs: fs)) }
        if abs(s.treble) >= 0.1 { p.high = t(shelf(low: false, f0: 7000, dB: Double(s.treble), fs: fs)) }
        os_unfair_lock_lock(lock); pending = p; os_unfair_lock_unlock(lock)
    }
    // Ornekleme hizi degisti: raf filtresi katsayilari yeni hiza gore yeniden hesaplanip ayni yoldan aktarilir
    func setRate(_ r: Double) {                                  // ana dizi
        guard r > 0, r != fs else { return }
        fs = r; update(last)
    }
    @inline(__always) private func bq(_ x: Float, _ k: K, _ st: UnsafeMutablePointer<Float>) -> Float {
        let y = k.0 * x + st[0]; st[0] = k.1 * x - k.3 * y + st[1]; st[1] = k.2 * x - k.4 * y; return y
    }
    // 0.8 ustunu yumusakca sikistir, asla 1'i gecme (patlama/cizirti olmasin)
    @inline(__always) private func limit(_ x: Float) -> Float {
        let a = abs(x); if a <= 0.8 { return x }
        let y = 0.8 + 0.2 * tanh((a - 0.8) / 0.2); return x < 0 ? -y : y
    }
    // Yalnizca yakalama (tap) girisi acik; o da listedeki son dolu tampondur. Cikis kanallari sirayla: L, R;
    // tek kanalli cikista L+R karisimi, cevresel kanallarda sessizlik (stereo her hoparlorden tekrar calmasin).
    func process(_ inp: UnsafePointer<AudioBufferList>, _ out: UnsafeMutablePointer<AudioBufferList>) {
        if os_unfair_lock_trylock(lock) { live = pending; os_unfair_lock_unlock(lock) }   // asla beklemez
        let p = live
        let il = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inp))
        let ol = UnsafeMutableAudioBufferListPointer(out)
        var tapData: UnsafeMutableRawPointer? = nil; var tch = 1; var tbytes = 0
        for b in il where b.mData != nil { tapData = b.mData; tch = max(1, Int(b.mNumberChannels)); tbytes = Int(b.mDataByteSize) }
        guard let td = tapData else { for b in ol { if let d = b.mData { memset(d, 0, Int(b.mDataByteSize)) } }; return }
        let tin = td.assumingMemoryBound(to: Float.self)
        let inFrames = tbytes / (MemoryLayout<Float>.size * tch)
        callbacks &+= 1
        if inFrames > 0 && tin[0] == 0 && tin[(inFrames - 1) * tch] == 0 { silent &+= 1 }
        else { silent = 0; if inFrames > 0 && !heard { heard = true } }
        var gEnd = g; var ch = 0
        for b in ol { guard let d = b.mData else { continue }
            let n = max(1, Int(b.mNumberChannels)), o = d.assumingMemoryBound(to: Float.self)
            let frames = Int(b.mDataByteSize) / (MemoryLayout<Float>.size * n)
            for c in 0..<n {
                let st = z + min(ch, Processor.maxCh - 1) * 4; var gg = g
                let mono = n == 1 && ol.count == 1 && tch >= 2, src = ch < 2 ? ch % tch : -1
                for i in 0..<frames {
                    gg += (p.gain - gg) * 0.002                  // tiklama olmasin diye kazanci yavasca degistir
                    var x: Float = 0
                    if i < inFrames { x = mono ? 0.5 * (tin[i * tch] + tin[i * tch + 1]) : (src >= 0 ? tin[i * tch + src] : 0) }
                    x = bq(bq(x, p.low, st), p.high, st + 2) + 1e-25   // +1e-25: Intel'de denormal yavaslamasi olmasin
                    // NaN/sonsuz filtre durumunda kalirsa kanal kalici olarak bozulur: durumu sifirla, bu ornek sessiz
                    if !x.isFinite { st[0] = 0; st[1] = 0; st[2] = 0; st[3] = 0; x = 0 }
                    o[i * n + c] = limit(x * gg)
                }
                gEnd = gg; ch += 1
            }
        }
        g = gEnd
    }
}

// Toplu aygitta cikis aygitinin kendi girisleri (AirPods/kulaklik mikrofonu) de vardir: yalnizca yakalama
// girisini ac. Yoksa mikrofon cikisa karisir ve Bluetooth kulaklik dusuk kaliteli arama moduna gecer.
func enableOnlyTapInput(_ agg: AudioObjectID, _ io: AudioDeviceIOProcID) {
    var a = addr(kAudioDevicePropertyIOProcStreamUsage, kAudioObjectPropertyScopeInput); var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(agg, &a, 0, nil, &size) == noErr, size > 0 else { return }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16); defer { raw.deallocate() }
    raw.initializeMemory(as: UInt8.self, repeating: 0, count: Int(size))
    let u = raw.bindMemory(to: AudioHardwareIOProcStreamUsage.self, capacity: 1)
    u.pointee.mIOProc = unsafeBitCast(io, to: UnsafeMutableRawPointer.self)
    guard AudioObjectGetPropertyData(agg, &a, 0, nil, &size, raw) == noErr else { return }
    let n = Int(u.pointee.mNumberStreams); guard n > 1 else { return }
    let on = (raw + MemoryLayout<AudioHardwareIOProcStreamUsage>.offset(of: \AudioHardwareIOProcStreamUsage.mStreamIsOn)!).assumingMemoryBound(to: UInt32.self)
    for i in 0..<n { on[i] = i == n - 1 ? 1 : 0 }
    let err = AudioObjectSetPropertyData(agg, &a, 0, nil, size, raw)
    if err != noErr { fail("Kulaklık mikrofonu kapatılamadı; ses kalitesi düşebilir.", err) }
}

// MARK: - Uygulama basina yakalama (tap + toplu aygit)
@available(macOS 14.2, *)
final class AppTap {
    let bundle: String; let objs: [AudioObjectID]; let proc = Processor(); let outputUID: String; let outputID: AudioObjectID; let born = Date()
    var tapID = AudioObjectID(kAudioObjectUnknown), aggID = AudioObjectID(kAudioObjectUnknown)
    var ioProc: AudioDeviceIOProcID?
    // outputUID: surecin gercekte caldigi aygit (varsayilan cikis olmak zorunda degil); toplu aygitin ana alt aygiti
    init?(bundle: String, objs: [AudioObjectID], outputUID: String, outputID: AudioObjectID, settings: Settings) {
        self.bundle = bundle; self.objs = objs; self.outputUID = outputUID; self.outputID = outputID
        let desc = CATapDescription(stereoMixdownOfProcesses: objs)
        desc.uuid = UUID(); desc.name = "ses-yardimcisi \(bundle)"; desc.isPrivate = true
        desc.muteBehavior = CATapMuteBehavior.mutedWhenTapped
        var err = AudioHardwareCreateProcessTap(desc, &tapID)
        if err != noErr { fail("Ses yakalanamadı. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı'nda izin ver.", err); return nil }
        let aggUID = "ses-yardimcisi-\(UUID().uuidString)"
        let dict: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Ses Yardımcısı", kAudioAggregateDeviceUIDKey: aggUID,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID, kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false, kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
        ]
        err = AudioHardwareCreateAggregateDevice(dict as CFDictionary, &aggID)
        if err != noErr { AudioHardwareDestroyProcessTap(tapID); fail("Ses aygıtı oluşturulamadı.", err); return nil }
        // Filtre katsayilari sabit 48 kHz ile degil, toplu aygitin (= cikis aygitinin) guncel hiziyla hesaplanir
        if let r = getF64(aggID, kAudioDevicePropertyNominalSampleRate), r > 0 { proc.setRate(r) }
        else if outputID != kAudioObjectUnknown, let r = getF64(outputID, kAudioDevicePropertyNominalSampleRate), r > 0 { proc.setRate(r) }
        proc.update(settings)
        let p = proc
        err = AudioDeviceCreateIOProcIDWithBlock(&ioProc, aggID, nil) { _, inData, _, outData, _ in p.process(inData, outData) }
        if err != noErr { destroy(); fail("Ses işleme başlatılamadı.", err); return nil }
        if let io = ioProc { enableOnlyTapInput(aggID, io) }
        err = AudioDeviceStart(aggID, ioProc)
        if err != noErr { destroy(); fail("Ses işleme başlatılamadı.", err); return nil }
    }
    func destroy() {
        if let io = ioProc { AudioDeviceStop(aggID, io); AudioDeviceDestroyIOProcID(aggID, io); ioProc = nil }
        if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID); aggID = AudioObjectID(kAudioObjectUnknown) }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID); tapID = AudioObjectID(kAudioObjectUnknown) }
    }
}

// MARK: - Yonetici
// Yakalama anahtari: uygulama + cikis aygiti. Tap uygulamanin orijinal sesini susturdugu icin islenmis ses,
// surecin gercekte caldigi aygita (or. varsayilan hoparlorken Muzik -> AirPods) gonderilmeli. Ayni uygulamanin
// surecleri farkli aygitlara caliyorsa aygit basina ayri yakalama kurulur (cogunluk aygitini secmek azinliktaki
// sureci yanlis aygita tasirdi). Bosta olan (aygiti bilinmeyen) surecler uygulamanin en cok kullanilan aygitina,
// o da yoksa mevcut yakalamasinin aygitina, o da yoksa varsayilan cikisa katilir: tipik durumda tek yakalama kalir
// ve calma duraklayinca yakalama gereksiz yere tasinmaz.
struct TapKey: Hashable { let bundle: String; let uid: String }

final class Engine {
    let queue = DispatchQueue.main                              // motorun seri kuyrugu: tum durum yalnizca burada degisir
    var perApp: [String: Settings] = [:]; var global = Settings()
    var taps: [TapKey: AnyObject] = [:]; var lastOutput: String? = nil; var lastList = "", lastDev = ""
    var failed: [String: Date] = [:]                            // "bundle\nuid": kurulamayan yakalamayi 30 sn tekrar deneme
    var denied = Set<String>()                                  // izin verilmedi (surekli sessiz) uygulamalar
    var heardApps = Set<String>()                               // yakalamasindan en az bir kez ses gelmis uygulamalar
    // Dinleyiciler: varsayilan cikis, yakalanan her surecin aygit listesi, kullanilan her cikis aygitinin hiz/yapisi
    var sysL: Listener? = nil; var procL: [AudioObjectID: Listener] = [:]; var devL: [AudioObjectID: Listener] = [:]
    var devSig: [AudioObjectID: String] = [:]
    var staleDevs = Set<String>(); var pendingSync: DispatchWorkItem? = nil
    func effective(_ bundle: String) -> Settings {
        var s = perApp[bundle] ?? Settings()
        s.gain *= global.gain; s.bass += global.bass; s.treble += global.treble; s.mute = s.mute || global.mute
        s.gain = min(s.gain, 2); s.bass = max(-12, min(12, s.bass)); s.treble = max(-12, min(12, s.treble))
        return s
    }
    func clearFailed(_ b: String) { failed = failed.filter { !$0.key.hasPrefix(b + "\n") } }
    func listen() {
        sysL = Listener(system, [addr(kAudioHardwarePropertyDefaultOutputDevice)], queue) { [weak self] _, _ in self?.scheduleSync() }
    }
    // Ust uste gelen bildirimler (hiz degisirken birkac kez gelir) 300 ms bekletilip tek yeniden kuruluma iner
    func scheduleSync(stale uid: String? = nil) {
        if let u = uid { staleDevs.insert(u) }
        pendingSync?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.pendingSync = nil; self?.sync(rebuildStale: true) }
        pendingSync = w; queue.asyncAfter(deadline: .now() + 0.3, execute: w)
    }
    // Cikis aygitinin hizi / kanal yapisi degisti: katsayilari hemen yeni hiza cek, yakalamayi gecikmeli yeniden kur
    func deviceChanged(_ dev: AudioObjectID, _ uid: String) {
        guard #available(macOS 14.2, *) else { return }
        guard devL[dev] != nil else { return }                  // dinleyici kaldirildiktan sonra kuyrukta kalan bildirim
        let sig = outputSignature(dev); if sig == devSig[dev] { return }
        devSig[dev] = sig
        if let fs = getF64(dev, kAudioDevicePropertyNominalSampleRate), fs > 0 {
            for (k, t) in taps where k.uid == uid { (t as! AppTap).proc.setRate(fs) }
        }
        scheduleSync(stale: uid)
    }
    // Dinleyicileri mevcut yakalamalarla esitle: yakalanmayan surec / kullanilmayan aygit dinleyicisi kaldirilir
    @available(macOS 14.2, *)
    func updateListeners() {
        var objs = Set<AudioObjectID>(), devs: [AudioObjectID: String] = [:]
        for (k, t) in taps { let t = t as! AppTap
            objs.formUnion(t.objs); if t.outputID != kAudioObjectUnknown { devs[t.outputID] = k.uid } }
        for (o, l) in procL where !objs.contains(o) { l.remove(); procL[o] = nil }
        for o in objs where procL[o] == nil {
            procL[o] = Listener(o, [addr(kAudioProcessPropertyDevices, kAudioObjectPropertyScopeOutput)], queue) { [weak self] _, _ in self?.scheduleSync() }
        }
        for (d, l) in devL where devs[d] == nil { l.remove(); devL[d] = nil; devSig[d] = nil }
        for (d, uid) in devs where devL[d] == nil {
            devSig[d] = outputSignature(d)
            devL[d] = Listener(d, [addr(kAudioDevicePropertyNominalSampleRate),
                                   addr(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput),
                                   addr(kAudioDevicePropertyDeviceIsAlive)], queue) { [weak self] _, _ in self?.deviceChanged(d, uid) }
        }
    }
    // Ayari notr olmayan uygulamalar icin yakalama kur. Yalnizca genel efekt varsa sadece ses calan uygulamalar
    // yakalanir (her ses istemcisine ayri aygit acilmasin). Surec kumesi ya da aygit degisince yenisi kurulup eskisi
    // sonra kaldirilir: arada uygulama islenmemis (or. %20 yerine %100) calmaz. rebuildStale: hizi/yapisi degisen
    // aygitlardaki yakalamalar da yeniden kurulur (yalnizca gecikmeli senkronda; duzenli kontrol bunu tuketmez).
    func sync(force: Bool = false, rebuildStale: Bool = false) {
        guard #available(macOS 14.2, *) else { return }
        // Yakalama (process tap) yalnizca macOS 14.4+ (ust duzeydeki `supported` ile ayni kontrol); altinda
        // liste/aygitlar bildirilir ama yakalama kurulmaz
        let canTap: Bool
        if #available(macOS 14.4, *) { canTap = true } else { canTap = false }
        let procs = audioProcesses()
        let defID = defaultOutput()
        let outUID = defID.flatMap { getString($0, kAudioDevicePropertyDeviceUID) }
        let outChanged = outUID != lastOutput; lastOutput = outUID
        if outChanged || force { failed = [:] }
        let devs = outputDevices()
        var nameOf: [String: String] = [:], idOf: [String: AudioObjectID] = [:]
        for d in devs { if let u = d["uid"] as? String {
            nameOf[u] = (d["name"] as? String) ?? u; if let i = d["id"] as? Int { idOf[u] = AudioObjectID(i) } } }
        let present = Set(nameOf.keys)
        var current: [AudioObjectID: String] = [:]               // surec -> su anki yakalamasinin aygiti
        for (k, t) in taps { let t = t as! AppTap
            for o in t.objs { current[o] = k.uid }; if idOf[k.uid] == nil { idOf[k.uid] = t.outputID } }
        if let d = defID, let o = outUID { idOf[o] = d }
        var uidCache: [AudioObjectID: String] = [:]
        func uidOf(_ id: AudioObjectID) -> String? {             // aygit listesinde olmayan (gizli) aygitlar icin de
            if let u = uidCache[id] { return u }
            guard let u = getString(id, kAudioDevicePropertyDeviceUID) else { return nil }
            uidCache[id] = u; idOf[u] = id; if nameOf[u] == nil { nameOf[u] = getString(id, kAudioObjectPropertyName) ?? u }
            return u
        }
        var byBundle: [String: [AudioProc]] = [:], playing = Set<String>(), playingObjs = Set<AudioObjectID>()
        for p in procs { byBundle[p.bundle, default: []].append(p); if p.playing { playing.insert(p.bundle); playingObjs.insert(p.obj) } }
        // Izin reddi: 3 sn'den uzun suredir yakalama hep sessiz ama yakaladigi surec ses caliyor ve bu uygulamadan
        // hic ses gelmedi (ses duyulduktan sonraki uzun dijital sessizlik ret degildir)
        for (k, t) in taps { let t = t as! AppTap
            if t.proc.heard { heardApps.insert(k.bundle) }
            if !denied.contains(k.bundle) && !heardApps.contains(k.bundle) && t.objs.contains(where: { playingObjs.contains($0) })
                && t.proc.callbacks > 300 && t.proc.silent > 300 && Date().timeIntervalSince(t.born) > 3 {
                denied.insert(k.bundle)
                emit(["type": "error", "code": "tcc", "msg": "Uygulama sesine erişim izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı › Yalnızca Sistem Sesi Kaydı'nda Cem App'i aç."])
            }
        }
        let tapped = Set(taps.keys.map { $0.bundle })
        let wanted: (String) -> Bool = { b in
            if !canTap { return false }
            let e = self.effective(b); if e.neutral || self.denied.contains(b) { return false }
            return self.perApp[b] != nil || playing.contains(b) || tapped.contains(b)
        }
        // Her surecin aygitini belirle, (uygulama, aygit) basina grupla
        var want: [TapKey: [AudioObjectID]] = [:], shown: [String: [String]] = [:]
        for (b, ps) in byBundle {
            var own: [AudioObjectID: String] = [:], count: [String: Int] = [:]
            for p in ps { if let d = p.device, let u = uidOf(d) {
                own[p.obj] = u; count[u, default: 0] += 1
                if !(shown[b] ?? []).contains(u) { shown[b, default: []].append(u) } } }
            guard wanted(b) else { continue }
            let major = count.max { ($0.value, $0.key) < ($1.value, $1.key) }?.key
            for p in ps {
                var u = own[p.obj] ?? major
                if u == nil, let s = current[p.obj], present.contains(s) { u = s }
                guard let uid = u ?? outUID else { continue }
                want[TapKey(bundle: b, uid: uid), default: []].append(p.obj)
            }
        }
        let stale = rebuildStale ? staleDevs : Set<String>()
        if rebuildStale { staleDevs = [] }
        var next: [TapKey: AnyObject] = [:], old: [(TapKey, AppTap)] = []
        for (k, t) in taps { let t = t as! AppTap
            if let objs = want[k], !force, !stale.contains(k.uid), Set(objs) == Set(t.objs) { t.proc.update(effective(k.bundle)); next[k] = t }
            else { old.append((k, t)) }
        }
        // Once yeniler kurulur, eskiler sonra kaldirilir
        for (k, objs) in want where next[k] == nil {
            let fk = k.bundle + "\n" + k.uid
            if let f = failed[fk], Date().timeIntervalSince(f) < 30 { continue }
            if let t = AppTap(bundle: k.bundle, objs: objs, outputUID: k.uid, outputID: idOf[k.uid] ?? AudioObjectID(kAudioObjectUnknown), settings: effective(k.bundle)) {
                next[k] = t; failed[fk] = nil
            } else { failed[fk] = Date() }
        }
        for (k, t) in old {
            // Ayni (uygulama, aygit) icin yenisi kurulamadiysa ve aygit hala varsa eskisi kalsin (islenmemis calmasin)
            if next[k] == nil, want[k] != nil, present.contains(k.uid) { t.proc.update(effective(k.bundle)); next[k] = t }
            else { t.destroy() }
        }
        taps = next
        updateListeners()
        // Liste ya da aygitlar degistiyse arayuze bildir (device: uygulamanin sesinin gittigi aygit adi)
        var seen = Set<String>(); var apps: [[String: Any]] = []
        for p in procs where !seen.contains(p.bundle) { seen.insert(p.bundle)
            var d = appInfo(p.bundle); d["playing"] = playing.contains(p.bundle)
            let via = taps.keys.filter { $0.bundle == p.bundle }.map { $0.uid }.sorted()
            d["active"] = !via.isEmpty; d["denied"] = denied.contains(p.bundle)
            let uids = via.isEmpty ? (shown[p.bundle] ?? []) : via
            if !uids.isEmpty { d["device"] = uids.map { nameOf[$0] ?? $0 }.joined(separator: ", ") }
            apps.append(d) }
        let key = apps.map { "\($0["bundle"]!)\($0["playing"]!)\($0["active"]!)\($0["denied"]!)\($0["device"] ?? "")" }.joined() + (outUID ?? "")
        if key != lastList || force { lastList = key; emit(["type": "apps", "apps": apps]) }
        let dkey = devs.map { "\($0["uid"] ?? "")\($0["default"] ?? "")\($0["volume"] ?? "")\($0["muted"] ?? "")" }.joined()
        if dkey != lastDev || force { lastDev = dkey; emit(["type": "devices", "devices": devs]) }
    }
    // Kapanis: bekleyen senkron iptal, tum dinleyiciler ve yakalamalar kaldirilir (ses normale doner)
    func stopAll() {
        pendingSync?.cancel(); pendingSync = nil; staleDevs = []
        sysL?.remove(); sysL = nil
        for (_, l) in procL { l.remove() }; procL = [:]
        for (_, l) in devL { l.remove() }; devL = [:]; devSig = [:]
        if #available(macOS 14.2, *) { for (_, t) in taps { (t as! AppTap).destroy() } }; taps = [:]
    }
}

func settingsFrom(_ o: [String: Any]) -> Settings {
    var s = Settings()
    s.gain = Float(max(0, min(2, (o["gain"] as? Double) ?? 1))); s.bass = Float(max(-12, min(12, (o["bass"] as? Double) ?? 0)))
    s.treble = Float(max(-12, min(12, (o["treble"] as? Double) ?? 0))); s.mute = (o["mute"] as? Bool) ?? false
    return s
}

// MARK: - Ana dongu
let args = CommandLine.arguments
if args.contains("--version") { print("ses-yardimcisi 1"); exit(0) }
let engine = Engine()
var supported = false
if #available(macOS 14.4, *) { supported = true }
emit(["type": "hello", "supported": supported, "os": ProcessInfo.processInfo.operatingSystemVersionString])

let q = engine.queue                             // motorun seri kuyrugu (Core Audio dinleyicileri de buraya)
if supported { engine.listen() }
func handle(_ line: String) {
    guard let data = line.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let cmd = o["cmd"] as? String else { return }
    switch cmd {
    case "list": engine.lastList = ""; engine.sync()
    case "set":
        guard let b = o["bundle"] as? String else { return }
        let s = settingsFrom(o); if s.neutral { engine.perApp[b] = nil } else { engine.perApp[b] = s }
        engine.denied.remove(b); engine.clearFailed(b)
        if supported { engine.sync() } else { emit(["type": "unsupported"]) }
    case "global":
        engine.global = settingsFrom(o); engine.denied.removeAll()
        if supported { engine.sync() } else { emit(["type": "unsupported"]) }
    case "reset": engine.perApp = [:]; engine.global = Settings(); engine.denied.removeAll(); engine.sync(force: true)
    case "masterVolume": setMasterVolume(Float((o["value"] as? Double) ?? 0.5)); emit(["type": "devices", "devices": outputDevices()])
    case "masterMute": setMasterMute((o["value"] as? Bool) ?? false); emit(["type": "devices", "devices": outputDevices()])
    // Varsayilani izleyen uygulamalar yeni aygita gecince surec aygit dinleyicisi yakalamayi tasir; diger aygitlara
    // calan uygulamalarin yakalamasi bozulmaz (eskiden tumu yeniden kuruluyordu)
    case "device": if let u = o["uid"] as? String { setDefaultOutput(uid: u); engine.lastList = ""; engine.lastDev = ""; engine.sync() }
    case "quit": engine.stopAll(); exit(0)
    default: break
    }
}
// stdin satirlari
DispatchQueue.global().async {
    while let line = readLine() { q.async { handle(line) } }
    q.async { engine.stopAll(); exit(0) }      // ana surec kapandi: yakalamalari kaldir, sesi normale dondur
}
// Surec/aygit degisikliklerini yakalamak icin duzenli kontrol
Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in engine.sync() }
// Sinyal isleyicisinde Core Audio cagrisi yapilamaz: SIGTERM ana dizide islenir
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { engine.stopAll(); exit(0) }; term.resume()
atexit { engine.stopAll() }
RunLoop.main.run()
