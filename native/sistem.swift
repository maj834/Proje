// Sistem yardimcisi: menu cubugu sistem izleyicisi icin CPU/GPU kullanimi ve sicakligi, bellek, ekran FPS,
// fanlar, pil, ag, disk, guc ve isil durum. Root/sudo/powermetrics gerekmez; Apple Silicon ve Intel, macOS 13+.
// Her sensor istege baglidir: okunamayan deger null gonderilir, yardimci asla cokmez.
// Iletisim: stdin satir basina JSON komut, stdout satir basina JSON olay (Electron ana sureci yonetir).
// Tum durum ana kuyrukta (DispatchQueue.main) degisir; yalnizca ekran FPS sayaci kendi kuyrugunda artar (kilitli).
import Foundation
import IOKit
import IOKit.ps
import CoreGraphics
import AppKit

// MARK: - JSON cikis
// FileHandle.write kapali boruda ObjC istisnasi atar: dogrudan write(2) kullanilir, SIGPIPE yok sayilir.
let outLock = NSLock()
func emit(_ obj: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(obj),
          let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
    var bytes = [UInt8](data)
    bytes.append(10)
    outLock.lock()
    defer { outLock.unlock() }
    var off = 0
    while off < bytes.count {
        let n: Int = bytes.withUnsafeBufferPointer { (buf: UnsafeBufferPointer<UInt8>) -> Int in
            return write(STDOUT_FILENO, buf.baseAddress! + off, buf.count - off)
        }
        if n < 0 {
            if errno == EINTR { continue }
            exit(0)                                   // ana surec kapandi
        }
        off += n
    }
}

// Ayni sorun en fazla bir kez bildirilir (yalnizca ana kuyrukta cagrilir)
var reportedErrors = Set<String>()
func report(_ msg: String) {
    if reportedErrors.insert(msg).inserted { emit(["type": "error", "msg": msg]) }
}

// JSON icin: nil / NaN / sonsuz -> null; ondalik degerler 1 haneye yuvarlanir
func jnum(_ v: Double?) -> Any {
    guard let x = v, x.isFinite else { return NSNull() }
    return (x * 10).rounded() / 10
}
func jint(_ v: Int?) -> Any {
    if let x = v { return x }
    return NSNull()
}
func jstr(_ v: String?) -> Any {
    if let x = v { return x }
    return NSNull()
}

// MARK: - sysctl yardimcilari
func sysctlString(_ name: String) -> String? {
    var size: Int = 0
    guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
    var buf = [CChar](repeating: 0, count: size + 1)
    guard sysctlbyname(name, &buf, &size, nil, 0) == 0 else { return nil }
    let s: String = buf.withUnsafeBufferPointer { (p: UnsafeBufferPointer<CChar>) -> String in
        return String(cString: p.baseAddress!)
    }
    return s
}
func sysctlInt32(_ name: String) -> Int32? {
    var v: Int32 = 0
    var size: Int = MemoryLayout<Int32>.size
    guard sysctlbyname(name, &v, &size, nil, 0) == 0 else { return nil }
    return v
}
func sysctlUInt64(_ name: String) -> UInt64? {
    var v: UInt64 = 0
    var size: Int = MemoryLayout<UInt64>.size
    guard sysctlbyname(name, &v, &size, nil, 0) == 0 else { return nil }
    return v
}

// MARK: - IOKit yardimcilari
func ioServices(_ className: String) -> [io_service_t] {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching(className), &it) == KERN_SUCCESS else { return [] }
    defer { IOObjectRelease(it) }
    var out: [io_service_t] = []
    while true {
        let s: io_service_t = IOIteratorNext(it)
        if s == 0 { break }
        out.append(s)
    }
    return out
}
func regProp(_ entry: io_registry_entry_t, _ key: String) -> AnyObject? {
    let u: Unmanaged<CFTypeRef>? = IORegistryEntryCreateCFProperty(entry, key as CFString, kCFAllocatorDefault, 0)
    guard let un = u else { return nil }
    let obj: AnyObject = un.takeRetainedValue()
    return obj
}
func regNumber(_ entry: io_registry_entry_t, _ key: String) -> NSNumber? {
    return regProp(entry, key) as? NSNumber
}
func registryID(_ entry: io_registry_entry_t) -> UInt64 {
    var id: UInt64 = 0
    _ = IORegistryEntryGetRegistryEntryID(entry, &id)
    return id
}

// dlsym: once IOKit/CoreGraphics cerceve yolu, yoksa RTLD_DEFAULT (-2)
func symbol(_ lib: String, _ name: String) -> UnsafeMutableRawPointer? {
    if let h = dlopen(lib, RTLD_NOW), let p = dlsym(h, name) { return p }
    return dlsym(UnsafeMutableRawPointer(bitPattern: -2), name)
}
let iokitPath = "/System/Library/Frameworks/IOKit.framework/IOKit"
let cgPath = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"

// MARK: - CPU kullanimi (host_processor_info tik farklari)
final class CPULoad {
    private let host: host_t = mach_host_self()
    private var prev: [[UInt32]] = []          // cekirdek basina [user, system, idle, nice]

    func sample() -> (total: Double?, cores: [Double]) {
        var cpuCount: natural_t = 0
        var info: processor_info_array_t? = nil
        var infoCount: mach_msg_type_number_t = 0
        let kr: kern_return_t = host_processor_info(host, PROCESSOR_CPU_LOAD_INFO, &cpuCount, &info, &infoCount)
        guard kr == KERN_SUCCESS, let arr = info else { return (nil, []) }
        defer {
            let size = vm_size_t(Int(infoCount) * MemoryLayout<integer_t>.stride)
            vm_deallocate(mach_task_self_, vm_address_t(bitPattern: arr), size)
        }
        let n = Int(cpuCount)
        let per = Int(CPU_STATE_MAX)
        guard n > 0, Int(infoCount) >= n * per else { return (nil, []) }
        var cur: [[UInt32]] = []
        cur.reserveCapacity(n)
        for i in 0..<n {
            let base = i * per
            let user = UInt32(bitPattern: arr[base + Int(CPU_STATE_USER)])
            let sys = UInt32(bitPattern: arr[base + Int(CPU_STATE_SYSTEM)])
            let idle = UInt32(bitPattern: arr[base + Int(CPU_STATE_IDLE)])
            let nice = UInt32(bitPattern: arr[base + Int(CPU_STATE_NICE)])
            cur.append([user, sys, idle, nice])
        }
        var cores: [Double] = []
        var busyAll: Double = 0, totalAll: Double = 0
        for i in 0..<n {
            let c = cur[i]
            var busy: Double, total: Double
            if prev.count == n {
                let p = prev[i]
                let du = Double(c[0] &- p[0]), ds = Double(c[1] &- p[1]), di = Double(c[2] &- p[2]), dn = Double(c[3] &- p[3])
                busy = du + ds + dn; total = busy + di
            } else {                                  // ilk olcum: acilistan beri ortalama
                busy = Double(c[0]) + Double(c[1]) + Double(c[3]); total = busy + Double(c[2])
            }
            busyAll += busy; totalAll += total
            let pct: Double = total > 0 ? min(100, max(0, busy / total * 100)) : 0
            cores.append((pct * 10).rounded() / 10)
        }
        prev = cur
        let tot: Double? = totalAll > 0 ? min(100, max(0, busyAll / totalAll * 100)) : nil
        return (tot, cores)
    }
}

// MARK: - Apple Silicon sicakliklari (IOHIDEventSystemClient, ozel API; dlsym ile)
final class HIDTemps {
    typealias CreateFn = @convention(c) (UnsafeRawPointer?) -> UnsafeMutableRawPointer?
    typealias SetMatchingFn = @convention(c) (UnsafeMutableRawPointer?, UnsafeRawPointer?) -> Int32
    typealias CopyServicesFn = @convention(c) (UnsafeMutableRawPointer?) -> UnsafeMutableRawPointer?
    typealias CopyPropertyFn = @convention(c) (UnsafeRawPointer?, UnsafeRawPointer?) -> UnsafeMutableRawPointer?
    typealias CopyEventFn = @convention(c) (UnsafeRawPointer?, Int64, Int32, Int64) -> UnsafeMutableRawPointer?
    typealias GetFloatFn = @convention(c) (UnsafeRawPointer?, Int32) -> Double

    enum Kind { case cpu, gpu, battery, soc }
    struct Reading { var cpu: [Double] = []; var gpu: [Double] = []; var battery: [Double] = []; var soc: [Double] = [] }

    private var copyServices: CopyServicesFn? = nil
    private var copyProperty: CopyPropertyFn? = nil
    private var copyEvent: CopyEventFn? = nil
    private var getFloat: GetFloatFn? = nil
    private var client: UnsafeMutableRawPointer? = nil      // surec boyunca tutulur
    private var services: CFArray? = nil                     // sensors icindeki isaretciler bu dizi yasadikca gecerli
    private var sensors: [(ptr: UnsafeRawPointer, kind: Kind)] = []
    private var lastScan: TimeInterval = -1000

    init() {
        guard let pCreate = symbol(iokitPath, "IOHIDEventSystemClientCreate"),
              let pMatch = symbol(iokitPath, "IOHIDEventSystemClientSetMatching"),
              let pServices = symbol(iokitPath, "IOHIDEventSystemClientCopyServices"),
              let pProp = symbol(iokitPath, "IOHIDServiceClientCopyProperty"),
              let pEvent = symbol(iokitPath, "IOHIDServiceClientCopyEvent"),
              let pFloat = symbol(iokitPath, "IOHIDEventGetFloatValue") else { return }
        let create = unsafeBitCast(pCreate, to: CreateFn.self)
        let setMatching = unsafeBitCast(pMatch, to: SetMatchingFn.self)
        copyServices = unsafeBitCast(pServices, to: CopyServicesFn.self)
        copyProperty = unsafeBitCast(pProp, to: CopyPropertyFn.self)
        copyEvent = unsafeBitCast(pEvent, to: CopyEventFn.self)
        getFloat = unsafeBitCast(pFloat, to: GetFloatFn.self)
        guard let c = create(nil) else { return }
        client = c
        // Sicaklik sensorleri: PrimaryUsagePage 0xff00 (Apple vendor), PrimaryUsage 5 (sicaklik)
        let match: [String: Any] = ["PrimaryUsagePage": NSNumber(value: 0xff00), "PrimaryUsage": NSNumber(value: 5)]
        let cf: CFDictionary = match as CFDictionary
        withExtendedLifetime(cf) {
            _ = setMatching(c, UnsafeRawPointer(Unmanaged.passUnretained(cf).toOpaque()))
        }
    }

    static func classify(_ name: String) -> Kind? {
        let l = name.lowercased()
        if l.contains("tcal") { return nil }                 // kalibrasyon sabiti, gercek sicaklik degil
        if l.contains("gpu") { return .gpu }
        if l.contains("battery") || l.contains("gas gauge") { return .battery }
        if l.contains("tdie") || l.contains("pacc") || l.contains("eacc") || l.contains("cpu") { return .cpu }
        if l.contains("soc") { return .soc }
        return nil
    }

    private func rescan() {
        sensors = []
        services = nil
        guard let c = client, let cs = copyServices, let cp = copyProperty else { return }
        guard let raw = cs(c) else { return }
        let arr: CFArray = Unmanaged<CFArray>.fromOpaque(UnsafeRawPointer(raw)).takeRetainedValue()
        services = arr
        let key: CFString = "Product" as CFString
        let count: CFIndex = CFArrayGetCount(arr)
        var found: [(ptr: UnsafeRawPointer, kind: Kind)] = []
        withExtendedLifetime(key) {
            let keyPtr = UnsafeRawPointer(Unmanaged.passUnretained(key).toOpaque())
            var i: CFIndex = 0
            while i < count {
                defer { i += 1 }
                guard let sp: UnsafeRawPointer = CFArrayGetValueAtIndex(arr, i) else { continue }
                guard let pr = cp(sp, keyPtr) else { continue }
                let obj: AnyObject = Unmanaged<AnyObject>.fromOpaque(UnsafeRawPointer(pr)).takeRetainedValue()
                guard let name = obj as? String else { continue }
                if let k = HIDTemps.classify(name) { found.append((ptr: sp, kind: k)) }
            }
        }
        sensors = found
    }

    func read() -> Reading {
        var r = Reading()
        guard client != nil, let ce = copyEvent, let gf = getFloat else { return r }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastScan > 30 { lastScan = now; rescan() }
        let type: Int64 = 15                                  // kIOHIDEventTypeTemperature
        let field: Int32 = Int32(15 << 16)                    // IOHIDEventFieldBase(kIOHIDEventTypeTemperature)
        for s in sensors {
            guard let ev = ce(s.ptr, type, 0, 0) else { continue }
            let evPtr = UnsafeRawPointer(ev)
            let v: Double = gf(evPtr, field)
            Unmanaged<AnyObject>.fromOpaque(evPtr).release()
            guard v.isFinite, v >= 1, v <= 130 else { continue }
            switch s.kind {
            case .cpu: r.cpu.append(v)
            case .gpu: r.gpu.append(v)
            case .battery: r.battery.append(v)
            case .soc: r.soc.append(v)
            }
        }
        return r
    }
}

// MARK: - SMC (AppleSMC, IOConnectCallStructMethod secici 2, 80 baytlik SMCKeyData)
typealias SMCBytes = (UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
                      UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
                      UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
                      UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8)

// C'deki SMCKeyData_t ile ayni yerlesim (dolgu baytlari acikca yazildi):
// key@0, vers@4 (6 bayt), pLimitData@12 (16 bayt), keyInfo@28 (dataSize, dataType, dataAttributes + 3 dolgu),
// result@40, status@41, data8@42, dolgu@43, data32@44, bytes@48..80
struct SMCParam {
    var key: UInt32 = 0
    var versMajor: UInt8 = 0
    var versMinor: UInt8 = 0
    var versBuild: UInt8 = 0
    var versReserved: UInt8 = 0
    var versRelease: UInt16 = 0
    var pad0: UInt16 = 0
    var pLimitVersion: UInt16 = 0
    var pLimitLength: UInt16 = 0
    var cpuPLimit: UInt32 = 0
    var gpuPLimit: UInt32 = 0
    var memPLimit: UInt32 = 0
    var dataSize: UInt32 = 0
    var dataType: UInt32 = 0
    var dataAttributes: UInt8 = 0
    var pad1: UInt8 = 0
    var pad2: UInt8 = 0
    var pad3: UInt8 = 0
    var result: UInt8 = 0
    var status: UInt8 = 0
    var data8: UInt8 = 0
    var pad4: UInt8 = 0
    var data32: UInt32 = 0
    var bytes: SMCBytes = (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                           0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
}

final class SMC {
    struct KeyInfo { let size: UInt32; let type: UInt32 }
    private var conn: io_connect_t = 0
    private var infoCache: [UInt32: KeyInfo] = [:]
    private var missing = Set<UInt32>()
    private(set) var ok = false
    private(set) var problem: String? = nil

    init() {
        typealias L = MemoryLayout<SMCParam>
        guard L.size == 80, L.stride == 80,
              L.offset(of: \SMCParam.pLimitVersion) == 12,
              L.offset(of: \SMCParam.dataSize) == 28,
              L.offset(of: \SMCParam.dataType) == 32,
              L.offset(of: \SMCParam.result) == 40,
              L.offset(of: \SMCParam.data8) == 42,
              L.offset(of: \SMCParam.data32) == 44,
              L.offset(of: \SMCParam.bytes) == 48 else {
            problem = "SMC yapı yerleşimi beklenmedik (\(MemoryLayout<SMCParam>.size) bayt); SMC kapalı"
            return
        }
        let svc: io_service_t = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"))
        guard svc != 0 else { problem = "AppleSMC bulunamadı; fan/SMC değerleri yok"; return }
        defer { IOObjectRelease(svc) }
        var c: io_connect_t = 0
        let kr: kern_return_t = IOServiceOpen(svc, mach_task_self_, 0, &c)
        guard kr == KERN_SUCCESS, c != 0 else { problem = "AppleSMC açılamadı (\(kr))"; return }
        conn = c
        ok = true
    }

    func close() {
        if conn != 0 { IOServiceClose(conn); conn = 0 }
        ok = false
    }

    static func fourCC(_ s: String) -> UInt32 {
        var r: UInt32 = 0
        for c in s.utf8.prefix(4) { r = (r << 8) | UInt32(c) }
        return r
    }
    static func typeString(_ v: UInt32) -> String {
        let chars: [UInt8] = [UInt8((v >> 24) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff)]
        return String(decoding: chars, as: UTF8.self)
    }

    private func call(_ input: inout SMCParam) -> SMCParam? {
        var output = SMCParam()
        var outSize: Int = MemoryLayout<SMCParam>.stride
        let kr: kern_return_t = IOConnectCallStructMethod(conn, 2, &input, MemoryLayout<SMCParam>.stride, &output, &outSize)
        guard kr == KERN_SUCCESS, output.result == 0 else { return nil }
        return output
    }

    private func info(_ k: UInt32) -> KeyInfo? {
        if let i = infoCache[k] { return i }
        if missing.contains(k) { return nil }
        var inp = SMCParam()
        inp.key = k
        inp.data8 = 9                                         // kSMCGetKeyInfo
        guard let out = call(&inp), out.dataSize > 0, out.dataSize <= 32 else { missing.insert(k); return nil }
        let i = KeyInfo(size: out.dataSize, type: out.dataType)
        infoCache[k] = i
        return i
    }

    // Deger, anahtar turune gore (mimariye gore degil) cozulur
    func read(_ key: String) -> Double? {
        guard ok, conn != 0 else { return nil }
        let k = SMC.fourCC(key)
        guard let ki = info(k) else { return nil }
        var inp = SMCParam()
        inp.key = k
        inp.dataSize = ki.size
        inp.data8 = 5                                         // kSMCReadKey
        guard let out = call(&inp) else { return nil }
        var b: SMCBytes = out.bytes
        let bytes: [UInt8] = withUnsafeBytes(of: &b) { (p: UnsafeRawBufferPointer) -> [UInt8] in Array(p) }
        let v = SMC.decode(type: ki.type, size: Int(ki.size), bytes)
        guard let x = v, x.isFinite else { return nil }
        return x
    }

    static func decode(type: UInt32, size: Int, _ b: [UInt8]) -> Double? {
        guard b.count >= 32 else { return nil }
        let be16: UInt16 = (UInt16(b[0]) << 8) | UInt16(b[1])
        switch typeString(type) {
        case "sp78":
            guard size >= 2 else { return nil }
            return Double(Int16(bitPattern: be16)) / 256.0
        case "sp87":
            guard size >= 2 else { return nil }
            return Double(Int16(bitPattern: be16)) / 128.0
        case "sp96":
            guard size >= 2 else { return nil }
            return Double(Int16(bitPattern: be16)) / 64.0
        case "fpe2":
            guard size >= 2 else { return nil }
            return Double(be16) / 4.0
        case "fp88":
            guard size >= 2 else { return nil }
            return Double(be16) / 256.0
        case "flt ":
            guard size >= 4 else { return nil }
            let b0 = UInt32(b[0]), b1 = UInt32(b[1]) << 8, b2 = UInt32(b[2]) << 16, b3 = UInt32(b[3]) << 24
            let bits: UInt32 = b0 | b1 | b2 | b3
            return Double(Float(bitPattern: bits))
        case "ioft":
            guard size >= 8 else { return nil }
            var raw: UInt64 = 0
            for i in 0..<8 { raw |= UInt64(b[i]) << UInt64(8 * i) }
            return Double(raw) / 65536.0
        case "ui8 ":
            guard size >= 1 else { return nil }
            return Double(b[0])
        case "ui16":
            guard size >= 2 else { return nil }
            return Double(be16)
        case "ui32":
            guard size >= 4 else { return nil }
            let v: UInt32 = (UInt32(b[0]) << 24) | (UInt32(b[1]) << 16) | (UInt32(b[2]) << 8) | UInt32(b[3])
            return Double(v)
        default:
            return nil
        }
    }
}

// MARK: - Ekran FPS (CGDisplayStream, dlsym ile; SDK'da kullanimdan kalkmis olsa da calisir)
final class FrameCounter {
    private let lock = NSLock()
    private var n = 0
    func add() { lock.lock(); n += 1; lock.unlock() }
    func take() -> Int { lock.lock(); let v = n; n = 0; lock.unlock(); return v }
}

final class ScreenFPS {
    typealias Handler = @convention(block) (Int32, UInt64, UnsafeMutableRawPointer?, UnsafeMutableRawPointer?) -> Void
    typealias CreateFn = @convention(c) (UInt32, Int, Int, Int32, UnsafeRawPointer?, UnsafeMutableRawPointer?, Handler) -> UnsafeMutableRawPointer?
    typealias StartStopFn = @convention(c) (UnsafeMutableRawPointer?) -> Int32
    typealias PreflightFn = @convention(c) () -> Bool

    private let queue = DispatchQueue(label: "sistem-yardimcisi.fps")
    private let counter = FrameCounter()
    private var stream: UnsafeMutableRawPointer? = nil
    private var display: CGDirectDisplayID = 0
    private var since: TimeInterval = 0
    private(set) var on = false

    // Acik ise son cagridan beri saniyedeki ekran guncellemesi; kapali / izin yok ise nil
    func setOn(_ v: Bool) {
        on = v
        if v { start() } else { stop() }
    }

    private func start() {
        stop()
        guard let pPre = symbol(cgPath, "CGPreflightScreenCaptureAccess"),
              let pCreate = symbol(cgPath, "CGDisplayStreamCreateWithDispatchQueue"),
              let pStart = symbol(cgPath, "CGDisplayStreamStart") else {
            report("Ekran FPS ölçümü bu macOS sürümünde kullanılamıyor"); return
        }
        let preflight = unsafeBitCast(pPre, to: PreflightFn.self)
        guard preflight() else { report("Ekran kaydı izni yok"); return }
        let create = unsafeBitCast(pCreate, to: CreateFn.self)
        let startFn = unsafeBitCast(pStart, to: StartStopFn.self)
        let c = counter
        let handler: Handler = { (status: Int32, _: UInt64, _: UnsafeMutableRawPointer?, _: UnsafeMutableRawPointer?) in
            if status == 0 { c.add() }                        // kCGDisplayStreamFrameStatusFrameComplete
        }
        // Imlec hareketi ekran guncellemesi sayilmasin (kCGDisplayStreamShowCursor = false)
        var props: CFDictionary? = nil
        if let pKey = symbol(cgPath, "kCGDisplayStreamShowCursor"),
           let keyRaw = pKey.load(as: UnsafeRawPointer?.self) {
            let key: CFString = Unmanaged<CFString>.fromOpaque(keyRaw).takeUnretainedValue()
            let ks: String = key as String
            let d: [String: Any] = [ks: false]
            props = d as CFDictionary
        }
        let id: CGDirectDisplayID = CGMainDisplayID()
        let qPtr = Unmanaged.passUnretained(queue).toOpaque()
        var created: UnsafeMutableRawPointer? = nil
        if let p = props {
            withExtendedLifetime(p) {
                created = create(id, 64, 40, Int32(0x42475241), UnsafeRawPointer(Unmanaged.passUnretained(p).toOpaque()), qPtr, handler)  // 'BGRA'
            }
        } else {
            created = create(id, 64, 40, Int32(0x42475241), nil, qPtr, handler)
        }
        guard let s = created else { report("Ekran kaydı izni yok"); return }
        if startFn(s) != 0 {
            Unmanaged<AnyObject>.fromOpaque(UnsafeRawPointer(s)).release()
            report("Ekran FPS ölçümü başlatılamadı"); return
        }
        stream = s
        display = id
        _ = counter.take()
        since = ProcessInfo.processInfo.systemUptime
    }

    private func stop() {
        guard let s = stream else { return }
        stream = nil
        if let pStop = symbol(cgPath, "CGDisplayStreamStop") {
            let stopFn = unsafeBitCast(pStop, to: StartStopFn.self)
            _ = stopFn(s)
        }
        // Son (durdu) karesi teslim edilsin diye birakma biraz ertelenir
        let addr = UInt(bitPattern: s)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            if let p = UnsafeRawPointer(bitPattern: addr) { Unmanaged<AnyObject>.fromOpaque(p).release() }
        }
    }

    func shutdown() {
        if let s = stream, let pStop = symbol(cgPath, "CGDisplayStreamStop") {
            _ = unsafeBitCast(pStop, to: StartStopFn.self)(s)
        }
        stream = nil
    }

    func measure() -> Double? {
        guard on else { return nil }
        if stream != nil && CGMainDisplayID() != display { start() }   // ana ekran degisti
        guard stream != nil else { return nil }
        let now = ProcessInfo.processInfo.systemUptime
        let dt = now - since
        let frames = counter.take()
        since = now
        guard dt > 0.05 else { return nil }
        return Double(frames) / dt
    }
}

// MARK: - Izleyici
final class Monitor {
    let cpu = CPULoad()
    let hid = HIDTemps()
    let smc = SMC()
    let fps = ScreenFPS()
    private let host: host_t = mach_host_self()
    private var pageSize: UInt64 = 4096

    // Onbellekli IOKit girdileri (30 sn'de bir yenilenir)
    private var gpuEntries: [io_service_t] = []
    private var diskEntries: [io_service_t] = []
    private var batteryEntry: io_service_t = 0
    private var lastScan: TimeInterval = -1000

    // Fark sayaclari
    private var netPrev: [String: (UInt32, UInt32)] = [:]
    private var netTime: TimeInterval = 0
    private var diskPrev: [UInt64: (UInt64, UInt64)] = [:]
    private var diskTime: TimeInterval = 0
    private var freeCache: (value: Int?, at: TimeInterval) = (nil, -1000)
    private var hzCache: (value: Double?, at: TimeInterval) = (nil, -1000)
    private var fanCount: Int? = nil

    init() {
        var ps: vm_size_t = 0
        if host_page_size(host, &ps) == KERN_SUCCESS, ps > 0 { pageSize = UInt64(ps) }
        if let p = smc.problem { report(p) }
        // Baslangic degerleri: ilk istatistik satirindaki farklar anlamli olsun
        _ = cpu.sample()
        _ = netRates()
        rescan()
        _ = diskRates()
    }

    private func releaseAll(_ a: [io_service_t]) { for e in a { IOObjectRelease(e) } }

    private func rescan() {
        lastScan = ProcessInfo.processInfo.systemUptime
        releaseAll(gpuEntries); gpuEntries = ioServices("IOAccelerator")
        releaseAll(diskEntries); diskEntries = ioServices("IOBlockStorageDriver")
        if batteryEntry != 0 { IOObjectRelease(batteryEntry); batteryEntry = 0 }
        batteryEntry = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
    }

    // MARK: sicakliklar
    private static let smcCPUPrimary = ["TC0F", "TC0E", "TC0D", "TC0P", "TC0H"]
    private static let smcCPUCores: [String] = (0..<16).map { (i: Int) -> String in "TC" + String(i, radix: 16, uppercase: true) + "C" }
    private static let smcCPUOther: [String] = smcCPUCores + [
         "Tp01", "Tp05", "Tp09", "Tp0D", "Tp0H", "Tp0L", "Tp0P", "Tp0T", "Tp0X", "Tp0b", "Tp0f", "Tp0j",
         "Te05", "Te0L", "Te0P", "Te0S", "Tf04", "Tf09", "Tf0A", "Tf0B", "Tf0D", "Tf0E"]
    private static let smcGPU = ["TG0P", "TG0D", "TG0H", "Tg05", "Tg0D", "Tg0L", "Tg0T", "Tg0f", "Tg0j"]

    private func validTemp(_ v: Double?) -> Double? {
        guard let x = v, x.isFinite, x >= 1, x <= 130 else { return nil }
        return x
    }

    private func temps() -> (cpu: Double?, cpuMax: Double?, gpu: Double?, battery: Double?) {
        let h = hid.read()
        var cpuT: Double? = nil, cpuMax: Double? = nil, gpuT: Double? = nil
        var cpuVals = h.cpu
        if cpuVals.isEmpty { cpuVals = h.soc }
        if !cpuVals.isEmpty {
            cpuT = cpuVals.reduce(0, +) / Double(cpuVals.count)
            cpuMax = cpuVals.max()
        } else if smc.ok {
            var primary: Double? = nil
            var all: [Double] = []
            for k in Monitor.smcCPUPrimary {
                if let v = validTemp(smc.read(k)) { if primary == nil { primary = v }; all.append(v) }
            }
            for k in Monitor.smcCPUOther {
                if let v = validTemp(smc.read(k)) { all.append(v) }
            }
            if !all.isEmpty {
                cpuT = primary ?? (all.reduce(0, +) / Double(all.count))
                cpuMax = all.max()
            }
        }
        if !h.gpu.isEmpty {
            gpuT = h.gpu.reduce(0, +) / Double(h.gpu.count)
        } else if smc.ok {
            for k in Monitor.smcGPU {
                if let v = validTemp(smc.read(k)) { gpuT = v; break }
            }
        }
        let batT: Double? = h.battery.isEmpty ? nil : h.battery.max()
        return (cpuT, cpuMax, gpuT, batT)
    }

    // MARK: fanlar, guc
    private func fans() -> [Int] {
        guard smc.ok else { return [] }
        if fanCount == nil {
            if let n = smc.read("FNum"), n >= 0, n <= 16 { fanCount = Int(n) } else { fanCount = 0 }
        }
        let n = fanCount ?? 0
        var out: [Int] = []
        if n > 0 {
            for i in 0..<n {
                if let v = smc.read("F\(i)Ac"), v >= 0, v < 20000 { out.append(Int(v.rounded())) }
            }
        }
        return out
    }
    private func systemPower() -> Double? {
        guard smc.ok, let w = smc.read("PSTR"), w > 0, w < 1000 else { return nil }
        return w
    }

    // MARK: GPU kullanimi
    private func gpuUsage() -> Double? {
        var best: Double? = nil
        for e in gpuEntries {
            guard let st = regProp(e, "PerformanceStatistics") as? [String: Any] else { continue }
            let n: NSNumber? = (st["Device Utilization %"] as? NSNumber) ?? (st["GPU Activity(%)"] as? NSNumber)
            guard let v = n?.doubleValue, v.isFinite else { continue }
            let c = min(100, max(0, v))
            best = max(best ?? 0, c)
        }
        return best
    }

    // MARK: bellek
    private func memory() -> [String: Any] {
        let total = Int(clamping: ProcessInfo.processInfo.physicalMemory)
        var used: Int? = nil
        var stats = vm_statistics64_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.stride / MemoryLayout<integer_t>.stride)
        let h = host
        let kr: kern_return_t = withUnsafeMutablePointer(to: &stats) { (p: UnsafeMutablePointer<vm_statistics64_data_t>) -> kern_return_t in
            p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { (ip: UnsafeMutablePointer<integer_t>) -> kern_return_t in
                host_statistics64(h, HOST_VM_INFO64, ip, &count)
            }
        }
        if kr == KERN_SUCCESS {
            let pages: UInt64 = UInt64(stats.active_count) + UInt64(stats.wire_count) + UInt64(stats.compressor_page_count)
            used = Int(clamping: pages &* pageSize)
        }
        var pressure: Any = NSNull()
        if let lvl = sysctlInt32("kern.memorystatus_vm_pressure_level") {
            switch lvl {
            case 1: pressure = "normal"
            case 2: pressure = "warn"
            case 4: pressure = "critical"
            default: break
            }
        }
        var swap: Int = 0
        var xs = xsw_usage()
        var size: Int = MemoryLayout<xsw_usage>.size
        if sysctlbyname("vm.swapusage", &xs, &size, nil, 0) == 0 { swap = Int(clamping: xs.xsu_used) }
        return ["used": jint(used), "total": total, "pressure": pressure, "swap": swap]
    }

    // MARK: ekran
    private func displayHz() -> Double? {
        let now = ProcessInfo.processInfo.systemUptime
        if now - hzCache.at < 5 { return hzCache.value }
        var hz: Double? = nil
        let id: CGDirectDisplayID = CGMainDisplayID()
        if let mode = CGDisplayCopyDisplayMode(id), mode.refreshRate > 0 { hz = mode.refreshRate }
        if hz == nil {                                         // dahili ekran (ProMotion/LCD) 0 bildirir
            let key = NSDeviceDescriptionKey(rawValue: "NSScreenNumber")
            for s in NSScreen.screens {
                if let n = s.deviceDescription[key] as? NSNumber, n.uint32Value == id {
                    let f: Int = s.maximumFramesPerSecond
                    if f > 0 { hz = Double(f) }
                }
            }
            if hz == nil, let f = NSScreen.screens.first?.maximumFramesPerSecond, f > 0 { hz = Double(f) }
        }
        hzCache = (hz, now)
        return hz
    }

    // MARK: pil
    private func battery() -> Any {
        guard let blobU = IOPSCopyPowerSourcesInfo() else { return NSNull() }
        let blob: CFTypeRef = blobU.takeRetainedValue()
        guard let listU = IOPSCopyPowerSourcesList(blob) else { return NSNull() }
        let list: NSArray = listU.takeRetainedValue() as NSArray
        var desc: [String: Any]? = nil
        for item in list {
            let ps: CFTypeRef = item as AnyObject
            guard let dU = IOPSGetPowerSourceDescription(blob, ps) else { continue }
            guard let d = dU.takeUnretainedValue() as NSDictionary as? [String: Any] else { continue }
            if (d["Type"] as? String) == "InternalBattery" { desc = d; break }
        }
        guard let d = desc else { return NSNull() }           // masaustu: pil yok
        let cur = (d["Current Capacity"] as? NSNumber)?.doubleValue ?? 0
        let mx = (d["Max Capacity"] as? NSNumber)?.doubleValue ?? 100
        let pct: Int = mx > 0 ? Int(min(100, max(0, cur / mx * 100)).rounded()) : Int(min(100, max(0, cur)))
        let charging: Bool = (d["Is Charging"] as? Bool) ?? false
        var temp: Double? = nil, cycles: Int? = nil, watts: Double? = nil
        if batteryEntry != 0 {
            if let t = regNumber(batteryEntry, "Temperature")?.doubleValue { temp = validTemp(t / 100) }
            if let c = regNumber(batteryEntry, "CycleCount")?.intValue, c >= 0 { cycles = c }
            let amp = regNumber(batteryEntry, "InstantAmperage") ?? regNumber(batteryEntry, "Amperage")
            if let a = amp, let v = regNumber(batteryEntry, "Voltage") {
                var ma: Int64 = a.int64Value
                if ma > 0x7fff_ffff && ma <= 0xffff_ffff { ma = Int64(Int32(truncatingIfNeeded: ma)) }  // 32 bit isaretsiz okunmus negatif
                let w = Double(ma) * v.doubleValue / 1_000_000
                if w.isFinite, abs(w) < 500 { watts = w }
            }
        }
        if temp == nil { temp = hidBatteryTemp }
        return ["pct": pct, "charging": charging, "temp": jnum(temp), "cycles": jint(cycles), "watts": jnum(watts)]
    }
    private var hidBatteryTemp: Double? = nil

    // MARK: ag
    private func netRates() -> (down: Int, up: Int) {
        var ifap: UnsafeMutablePointer<ifaddrs>? = nil
        guard getifaddrs(&ifap) == 0, let first = ifap else { return (0, 0) }
        defer { freeifaddrs(ifap) }
        var cur: [String: (UInt32, UInt32)] = [:]
        var p: UnsafeMutablePointer<ifaddrs>? = first
        while let ifa = p {
            p = ifa.pointee.ifa_next
            guard let sa = ifa.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_LINK) else { continue }
            let flags: UInt32 = ifa.pointee.ifa_flags
            guard (flags & UInt32(IFF_UP)) != 0, (flags & UInt32(IFF_LOOPBACK)) == 0 else { continue }
            guard let namePtr = ifa.pointee.ifa_name else { continue }
            let name = String(cString: namePtr)
            if name.hasPrefix("utun") || name.hasPrefix("lo") || name.hasPrefix("gif") || name.hasPrefix("stf") { continue }
            guard let raw = ifa.pointee.ifa_data else { continue }
            let data: if_data = raw.load(as: if_data.self)
            cur[name] = (data.ifi_ibytes, data.ifi_obytes)
        }
        let now = ProcessInfo.processInfo.systemUptime
        let dt = now - netTime
        var down: UInt64 = 0, up: UInt64 = 0
        for (name, v) in cur {
            guard let pv = netPrev[name] else { continue }
            down += UInt64(v.0 &- pv.0)                        // 32 bit sayac tasmasi
            up += UInt64(v.1 &- pv.1)
        }
        let hadPrev = !netPrev.isEmpty
        netPrev = cur
        netTime = now
        guard hadPrev, dt > 0.05 else { return (0, 0) }
        return (Int(Double(down) / dt), Int(Double(up) / dt))
    }

    // MARK: disk
    private func diskRates() -> (read: Int, write: Int) {
        var cur: [UInt64: (UInt64, UInt64)] = [:]
        for e in diskEntries {
            guard let st = regProp(e, "Statistics") as? [String: Any] else { continue }
            let r = (st["Bytes (Read)"] as? NSNumber)?.uint64Value ?? 0
            let w = (st["Bytes (Write)"] as? NSNumber)?.uint64Value ?? 0
            cur[registryID(e)] = (r, w)
        }
        let now = ProcessInfo.processInfo.systemUptime
        let dt = now - diskTime
        var rd: UInt64 = 0, wr: UInt64 = 0
        for (id, v) in cur {
            guard let pv = diskPrev[id] else { continue }
            if v.0 >= pv.0 { rd += v.0 - pv.0 }
            if v.1 >= pv.1 { wr += v.1 - pv.1 }
        }
        let hadPrev = !diskPrev.isEmpty
        diskPrev = cur
        diskTime = now
        guard hadPrev, dt > 0.05 else { return (0, 0) }
        return (Int(clamping: UInt64(Double(rd) / dt)), Int(clamping: UInt64(Double(wr) / dt)))
    }
    private func diskFree() -> Int? {
        let now = ProcessInfo.processInfo.systemUptime
        if now - freeCache.at < 10 { return freeCache.value }
        var free: Int? = nil
        let url = URL(fileURLWithPath: "/")
        if let vals = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
           let v = vals.volumeAvailableCapacityForImportantUsage, v > 0 {
            free = Int(clamping: v)
        } else {
            var s = statfs()
            if statfs("/", &s) == 0 { free = Int(clamping: UInt64(s.f_bavail) &* UInt64(s.f_bsize)) }
        }
        freeCache = (free, now)
        return free
    }

    // MARK: isil durum
    private func thermal() -> String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "nominal"
        }
    }

    // MARK: istatistik satiri
    func stats() -> [String: Any] {
        if ProcessInfo.processInfo.systemUptime - lastScan > 30 { rescan() }
        let c = cpu.sample()
        let t = temps()
        hidBatteryTemp = t.battery
        let n = netRates()
        let d = diskRates()
        return [
            "type": "stats",
            "t": Int(Date().timeIntervalSince1970 * 1000),
            "cpu": ["usage": jnum(c.total), "cores": c.cores, "temp": jnum(t.cpu), "tempMax": jnum(t.cpuMax)] as [String: Any],
            "gpu": ["usage": jnum(gpuUsage()), "temp": jnum(t.gpu)] as [String: Any],
            "mem": memory(),
            "fps": ["display": jnum(displayHz()), "screen": jnum(fps.measure())] as [String: Any],
            "fans": fans(),
            "battery": battery(),
            "net": ["down": n.down, "up": n.up] as [String: Any],
            "disk": ["read": d.read, "write": d.write, "free": jint(diskFree())] as [String: Any],
            "power": jnum(systemPower()),
            "thermal": thermal(),
        ]
    }

    func shutdown() {
        fps.shutdown()
        smc.close()
    }
}

// MARK: - Ana dongu
let args = CommandLine.arguments
if args.contains("--version") { print("sistem-yardimcisi 1"); exit(0) }
signal(SIGPIPE, SIG_IGN)

func helloLine() -> [String: Any] {
    var arch = "x86_64"
    #if arch(arm64)
    arch = "arm64"
    #endif
    if (sysctlInt32("sysctl.proc_translated") ?? 0) == 1 { arch = "arm64" }   // Rosetta altinda
    let chip: String? = sysctlString("machdep.cpu.brand_string").map { s in
        s.split(separator: " ").joined(separator: " ")       // Intel dizesindeki fazla bosluklar
    }
    return ["type": "hello", "version": 1, "arch": arch,
            "model": jstr(sysctlString("hw.model")), "chip": jstr(chip),
            "cores": ProcessInfo.processInfo.processorCount,
            "memTotal": Int(clamping: ProcessInfo.processInfo.physicalMemory)]
}
emit(helloLine())

let monitor = Monitor()
var intervalMs = 1000
let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
func schedule() {
    timer.schedule(deadline: .now() + .milliseconds(intervalMs), repeating: .milliseconds(intervalMs), leeway: .milliseconds(20))
}
timer.setEventHandler { emit(monitor.stats()) }
schedule()
timer.resume()

func finish() {
    timer.cancel()
    monitor.shutdown()
    exit(0)
}

func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let cmd = o["cmd"] as? String else { return }
    switch cmd {
    case "interval":
        if let n = o["ms"] as? NSNumber {
            let d = n.doubleValue
            let ms: Int = d.isFinite ? Int(max(250, min(10000, d))) : 1000
            if ms != intervalMs { intervalMs = ms; schedule() }
        }
    case "fps":
        let on: Bool = (o["on"] as? Bool) ?? false
        if on != monitor.fps.on { monitor.fps.setOn(on) }
    case "once":
        emit(monitor.stats())
    case "quit":
        finish()
    default:
        break
    }
}

// stdin satirlari arka planda okunur, komutlar ana kuyrukta islenir; EOF = ana surec kapandi
DispatchQueue.global().async {
    while let line = readLine() {
        DispatchQueue.main.async { handle(line) }
    }
    DispatchQueue.main.async { finish() }
}
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: DispatchQueue.main)
term.setEventHandler { finish() }
term.resume()
RunLoop.main.run()
