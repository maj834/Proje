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
func getIDs(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> [AudioObjectID] {
    var a = addr(sel); var size: UInt32 = 0
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
struct AudioProc { let obj: AudioObjectID; let pid: pid_t; let bundle: String; let playing: Bool }

// Yardimci surecleri ana uygulamaya bagla (Chrome Helper -> Chrome). WebKit sureci Safari, Mail ve diger
// web gorunumlerinde ortaktir: ayri bir "Web icerigi" kalemi olarak gosterilir.
func ownerBundle(_ bundle: String, pid: pid_t) -> String {
    if bundle.hasPrefix("com.apple.WebKit") { return "com.apple.WebKit" }
    if let r = bundle.range(of: ".helper", options: .caseInsensitive) { return String(bundle[..<r.lowerBound]) }
    return bundle
}
func audioProcesses() -> [AudioProc] {
    if #available(macOS 14.2, *) {
        let me = getpid()
        return getIDs(system, kAudioHardwarePropertyProcessObjectList).compactMap { obj in
            guard let pidU = getU32(obj, kAudioProcessPropertyPID) else { return nil }
            let pid = pid_t(bitPattern: pidU); if pid == me { return nil }
            let raw = getString(obj, kAudioProcessPropertyBundleID) ?? ""
            let bundle = raw.isEmpty ? (NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? "pid.\(pid)") : raw
            let playing = (getU32(obj, kAudioProcessPropertyIsRunningOutput) ?? 0) != 0
            return AudioProc(obj: obj, pid: pid, bundle: ownerBundle(bundle, pid: pid), playing: playing)
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

// RBJ ses kitabi raf filtresi katsayilari (S = 1)
func shelf(low: Bool, f0: Double, dB: Double, fs: Double) -> [Float] {
    let A = pow(10, dB / 40), w0 = 2 * Double.pi * f0 / fs, cw = cos(w0), sw = sin(w0)
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
    var fs: Double = 48000
    private(set) var last = Settings()
    private let lock: UnsafeMutablePointer<os_unfair_lock> = { let p = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1); p.initialize(to: os_unfair_lock()); return p }()
    private var pending = Params(), live = Params()
    private let z: UnsafeMutablePointer<Float> = { let p = UnsafeMutablePointer<Float>.allocate(capacity: Processor.maxCh * 4); p.initialize(repeating: 0, count: Processor.maxCh * 4); return p }()
    private var g: Float = 1
    // Ses dizisinin yazdigi sayaclar (izin reddi = surekli sessiz yakalama tespiti icin)
    var callbacks = 0, silent = 0
    deinit { z.deallocate(); lock.deallocate() }
    func update(_ s: Settings) {                                   // ana dizi
        func t(_ a: [Float]) -> K { (a[0], a[1], a[2], a[3], a[4]) }
        last = s
        var p = Params(); p.gain = s.mute ? 0 : s.gain
        if abs(s.bass) >= 0.1 { p.low = t(shelf(low: true, f0: 110, dB: Double(s.bass), fs: fs)) }
        if abs(s.treble) >= 0.1 { p.high = t(shelf(low: false, f0: 7000, dB: Double(s.treble), fs: fs)) }
        os_unfair_lock_lock(lock); pending = p; os_unfair_lock_unlock(lock)
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
        if inFrames > 0 && tin[0] == 0 && tin[(inFrames - 1) * tch] == 0 { silent &+= 1 } else { silent = 0 }
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
    let bundle: String; let objs: [AudioObjectID]; let proc = Processor(); let outputUID: String; let born = Date()
    var tapID = AudioObjectID(kAudioObjectUnknown), aggID = AudioObjectID(kAudioObjectUnknown)
    var ioProc: AudioDeviceIOProcID?
    init?(bundle: String, objs: [AudioObjectID], outputUID: String, settings: Settings) {
        self.bundle = bundle; self.objs = objs; self.outputUID = outputUID
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
        proc.fs = getF64(aggID, kAudioDevicePropertyNominalSampleRate) ?? 48000
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
final class Engine {
    var perApp: [String: Settings] = [:]; var global = Settings()
    var taps: [String: AnyObject] = [:]; var lastOutput: String? = nil; var lastList = "", lastDev = ""
    var failed: [String: (Date, String)] = [:]                 // kurulamayan yakalamayi her turda tekrar deneme
    var denied = Set<String>()                                  // izin verilmedi (surekli sessiz) uygulamalar
    func effective(_ bundle: String) -> Settings {
        var s = perApp[bundle] ?? Settings()
        s.gain *= global.gain; s.bass += global.bass; s.treble += global.treble; s.mute = s.mute || global.mute
        s.gain = min(s.gain, 2); s.bass = max(-12, min(12, s.bass)); s.treble = max(-12, min(12, s.treble))
        return s
    }
    // Ayari notr olmayan uygulamalar icin yakalama kur. Yalnizca genel efekt varsa sadece ses calan uygulamalar
    // yakalanir (her ses istemcisine ayri aygit acilmasin). Surec kumesi degisince yenisi kurulup eskisi sonra
    // kaldirilir: arada uygulama islenmemis (or. %20 yerine %100) calmaz.
    func sync(force: Bool = false) {
        guard #available(macOS 14.2, *) else { return }
        let procs = audioProcesses()
        let outUID = defaultOutput().flatMap { getString($0, kAudioDevicePropertyDeviceUID) }
        let outChanged = outUID != lastOutput; lastOutput = outUID
        if outChanged || force { failed = [:] }
        var byBundle: [String: [AudioObjectID]] = [:], playing = Set<String>()
        for p in procs { byBundle[p.bundle, default: []].append(p.obj); if p.playing { playing.insert(p.bundle) } }
        let wanted: (String) -> Bool = { b in
            let e = self.effective(b); if e.neutral || self.denied.contains(b) { return false }
            return self.perApp[b] != nil || playing.contains(b) || self.taps[b] != nil
        }
        for (b, t) in taps { let t = t as! AppTap
            if force || outChanged || !wanted(b) || byBundle[b] == nil { t.destroy(); taps[b] = nil; continue }
            // Izin reddi: 3 sn'den uzun suredir yakalama hep sessiz ama uygulama ses caliyor
            if playing.contains(b) && t.proc.callbacks > 300 && t.proc.silent > 300 && Date().timeIntervalSince(t.born) > 3 {
                t.destroy(); taps[b] = nil; denied.insert(b)
                emit(["type": "error", "code": "tcc", "msg": "Uygulama sesine erişim izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Ekran ve Sistem Sesi Kaydı › Yalnızca Sistem Sesi Kaydı'nda Cem App'i aç."])
                continue
            }
            let objs = byBundle[b]!
            if Set(objs) != Set(t.objs), let out = outUID, let n = AppTap(bundle: b, objs: objs, outputUID: out, settings: effective(b)) {
                taps[b] = n; t.destroy()                       // once yenisi, sonra eskisi
            } else { t.proc.update(effective(b)) }
        }
        guard let out = outUID else { return }
        for (b, objs) in byBundle where taps[b] == nil && wanted(b) {
            if let f = failed[b], f.1 == out, Date().timeIntervalSince(f.0) < 30 { continue }
            if let t = AppTap(bundle: b, objs: objs, outputUID: out, settings: effective(b)) { taps[b] = t; failed[b] = nil }
            else { failed[b] = (Date(), out) }
        }
        // Liste ya da aygitlar degistiyse arayuze bildir
        var seen = Set<String>(); var apps: [[String: Any]] = []
        for p in procs where !seen.contains(p.bundle) { seen.insert(p.bundle)
            var d = appInfo(p.bundle); d["playing"] = playing.contains(p.bundle)
            d["active"] = taps[p.bundle] != nil; d["denied"] = denied.contains(p.bundle); apps.append(d) }
        let key = apps.map { "\($0["bundle"]!)\($0["playing"]!)\($0["active"]!)" }.joined() + (outUID ?? "")
        if key != lastList || force { lastList = key; emit(["type": "apps", "apps": apps]) }
        let devs = outputDevices()
        let dkey = devs.map { "\($0["uid"] ?? "")\($0["default"] ?? "")\($0["volume"] ?? "")\($0["muted"] ?? "")" }.joined()
        if dkey != lastDev || force { lastDev = dkey; emit(["type": "devices", "devices": devs]) }
    }
    func stopAll() { if #available(macOS 14.2, *) { for (_, t) in taps { (t as! AppTap).destroy() } }; taps = [:] }
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

let q = DispatchQueue.main
func handle(_ line: String) {
    guard let data = line.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let cmd = o["cmd"] as? String else { return }
    switch cmd {
    case "list": engine.lastList = ""; engine.sync()
    case "set":
        guard let b = o["bundle"] as? String else { return }
        let s = settingsFrom(o); if s.neutral { engine.perApp[b] = nil } else { engine.perApp[b] = s }
        engine.denied.remove(b); engine.failed[b] = nil
        if supported { engine.sync() } else { emit(["type": "unsupported"]) }
    case "global": engine.global = settingsFrom(o); if supported { engine.sync() } else { emit(["type": "unsupported"]) }
    case "reset": engine.perApp = [:]; engine.global = Settings(); engine.sync(force: true)
    case "masterVolume": setMasterVolume(Float((o["value"] as? Double) ?? 0.5)); emit(["type": "devices", "devices": outputDevices()])
    case "masterMute": setMasterMute((o["value"] as? Bool) ?? false); emit(["type": "devices", "devices": outputDevices()])
    case "device": if let u = o["uid"] as? String { setDefaultOutput(uid: u); engine.sync(force: true) }
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
