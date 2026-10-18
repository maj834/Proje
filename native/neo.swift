// Neo yardimcisi: sesli asistan "Neo"nun kulagi ve agzi.
// - "Hey Neo" uyandirma sozcugu cihaz uzerinde (cevrimdisi) SFSpeechRecognizer ile dinlenir: tr-TR cihaz uzerinde
//   destekleniyorsa o, yoksa yalnizca uyandirma icin en-US cihaz uzerinde tanimlayici kullanilir.
// - Bostayken CPU dusuk kalsin diye "ses kapisi": mikrofon seviyesi gurultu tabaninin uzerine cikmadikca tanima
//   gorevi calismaz (yalnizca tek bir AVAudioEngine dinleme ucu + RMS). Ses gelince son ~0.6 sn'lik on-kayitla gorev baslar.
// - Komut tr-TR tanimlayiciyla yakalanir (cihaz uzerinde destekleniyorsa cevrimdisi); sessizlik/sure/elle biter.
// - Seslendirme AVSpeechSynthesizer ile; konusurken uyandirma dinlemesi durur (Neo kendini duymasin).
// Iletisim: stdin satir basina JSON komut, stdout satir basina JSON olay (Electron ana sureci yonetir).
// Tum durum ana kuyrukta degisir; ses dinleme ucu (gercek zamanli olmayan tap is parcacigi) yalnizca kilitli TapShared'e dokunur.
import Foundation
import AVFoundation
import Speech

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
func report(_ code: String, _ msg: String) {
    if reportedErrors.insert(code + "|" + msg).inserted { emit(["type": "error", "code": code, "msg": msg]) }
}

func up() -> Double { return ProcessInfo.processInfo.systemUptime }
func round1(_ v: Double) -> Double { return (v * 10).rounded() / 10 }

// MARK: - Metin normallestirme ve uyandirma eslesmesi
let trLocale = Locale(identifier: "tr_TR")
let foldMap: [Character: String] = ["ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g", "â": "a", "î": "i", "û": "u"]

// Kucuk harf (Turkce kurallariyla), Turkce harfler ASCII'ye, noktalama atilir: "Neo," -> "neo", "NİYO" -> "niyo"
func normWord(_ w: String) -> String {
    let low: String = w.lowercased(with: trLocale)
    var out = ""
    for ch in low {
        if let r = foldMap[ch] { out += r; continue }
        if ch.isLetter || ch.isNumber {
            out += String(ch).folding(options: [.diacriticInsensitive], locale: nil)
        }
    }
    return out
}

struct Tok { let norm: String; let idx: Int }       // idx: ozgun kelime dizisindeki yeri

func tokenize(_ text: String) -> (words: [String], toks: [Tok]) {
    let words: [String] = text.split(whereSeparator: { (c: Character) -> Bool in c.isWhitespace }).map { String($0) }
    var toks: [Tok] = []
    for (i, w) in words.enumerated() {
        let n = normWord(w)
        if !n.isEmpty { toks.append(Tok(norm: n, idx: i)) }
    }
    return (words, toks)
}

func editDistance(_ a: String, _ b: String) -> Int {
    let x = Array(a), y = Array(b)
    if x.isEmpty { return y.count }
    if y.isEmpty { return x.count }
    var prev: [Int] = Array(0...y.count)
    var cur = [Int](repeating: 0, count: y.count + 1)
    for i in 1...x.count {
        cur[0] = i
        for j in 1...y.count {
            let cost = x[i - 1] == y[j - 1] ? 0 : 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        }
        swap(&prev, &cur)
    }
    return prev[y.count]
}

// Bastaki bosluk/noktalama atilir: ", sesi aç" -> "sesi aç"
func cleanText(_ s: String) -> String {
    var t = Substring(s)
    while let f = t.first, f.isWhitespace || f.isPunctuation { t = t.dropFirst() }
    return t.trimmingCharacters(in: .whitespacesAndNewlines)
}

let defaultWake: [String] = ["hey neo", "hey nio", "hey niyo", "hey neyo", "hey new", "hey nee oh", "hey ne o"]

final class WakeMatcher {
    static let greetings: Set<String> = ["hey", "hei", "hay", "hej", "heyy", "ey", "hi"]
    static let baseNeo: Set<String> = ["neo", "nio", "niyo", "neyo", "nyo", "neoo"]
    // "neo"ya 1 harf uzak ama gercek kelime olan, "hey"den sonra sik duyulabilecekler (yanlis uyanma olmasin)
    static let blocked: Set<String> = ["net", "nem", "nel", "nez", "neh", "nes", "nev", "now", "not", "nor", "nap", "nah", "yeo"]
    private(set) var phrases: [[String]] = []
    private var neoSet: Set<String> = WakeMatcher.baseNeo

    init() { set(defaultWake) }

    func set(_ list: [String]) {
        var ps: [[String]] = []
        var ns: Set<String> = WakeMatcher.baseNeo
        for s in list {
            let t: [String] = tokenize(s).toks.map { $0.norm }
            if t.isEmpty { continue }
            ps.append(t)
            if t.count >= 2 && WakeMatcher.greetings.contains(t[0]) { ns.insert(t[1...].joined()) }
        }
        if ps.isEmpty { return }
        phrases = ps
        neoSet = ns
    }

    func neoLike(_ t: String) -> Bool {
        if neoSet.contains(t) { return true }
        let c = t.count
        guard c >= 3 && c <= 4, !WakeMatcher.blocked.contains(t) else { return false }
        return editDistance(t, "neo") <= 1
    }

    // Ilk eslesme: [start, end) jeton araligi. Selamlama ("hey") + neo benzeri jeton bitisik olmali.
    func match(_ t: [String]) -> (start: Int, end: Int)? {
        let n = t.count
        var i = 0
        while i < n {
            for p in phrases where i + p.count <= n {
                if Array(t[i..<(i + p.count)]) == p { return (i, i + p.count) }
            }
            if WakeMatcher.greetings.contains(t[i]) && i + 1 < n {
                if neoLike(t[i + 1]) { return (i, i + 2) }
                // "ne o", "ni yo" gibi bolunmus hali
                if i + 2 < n && t[i + 1].count <= 3 && t[i + 2].count <= 2 && neoSet.contains(t[i + 1] + t[i + 2]) { return (i, i + 3) }
            }
            // bitisik: "heyneo", "Hey-Neo"
            for g in WakeMatcher.greetings where t[i].count > g.count && t[i].hasPrefix(g) {
                if neoLike(String(t[i].dropFirst(g.count))) { return (i, i + 1) }
            }
            i += 1
        }
        return nil
    }

    // Uyandirma ifadesi ve ardindaki metin (ozgun yaziyla)
    func split(_ text: String) -> (wake: String, rest: String, restIdx: Int)? {
        let tk = tokenize(text)
        guard let m = match(tk.toks.map { $0.norm }) else { return nil }
        let label = tk.toks[m.start..<m.end].map { $0.norm }.joined(separator: " ")
        let restIdx: Int = m.end < tk.toks.count ? tk.toks[m.end].idx : tk.words.count
        let rest: String = restIdx < tk.words.count ? tk.words[restIdx...].joined(separator: " ") : ""
        return (label, cleanText(rest), restIdx)
    }
}

// --wake-test: stdin'deki her satir icin eslesmeyi yazar (CI'da eslestirici testi; ses/izin gerekmez)
let args = CommandLine.arguments
if args.contains("--version") { print("neo-yardimcisi 1"); exit(0) }
signal(SIGPIPE, SIG_IGN)
if args.contains("--wake-test") {
    let m = WakeMatcher()
    while let line = readLine() {
        if let r = m.split(line) {
            emit(["text": line, "wake": true, "phrase": r.wake, "command": r.rest])
        } else {
            emit(["text": line, "wake": false])
        }
    }
    exit(0)
}

// MARK: - Ses dinleme ucu (tap is parcacigi) ile paylasilan durum
final class TapShared {
    let lock = NSLock()
    var request: SFSpeechAudioBufferRecognitionRequest? = nil
    var ring: [AVAudioPCMBuffer] = []              // on-kayit (son ~1.5 sn, kopya)
    var ringFrames: Int = 0
    var maxRingFrames: Int = 0
    var levelOn = false
    var lastLevelAt: Double = 0
    var noiseFloor: Double = -60
    var gateArmed = false                           // true: ilk sesli tamponda onVoice cagrilir
    var lastVoiceAt: Double = -1000
    var onVoice: (() -> Void)? = nil
    var onLevel: ((Double) -> Void)? = nil
}

func rmsDB(_ b: AVAudioPCMBuffer) -> Double {
    let n = Int(b.frameLength)
    guard n > 0, let ch = b.floatChannelData else { return -100 }
    let p: UnsafeMutablePointer<Float> = ch[0]
    let st: Int = max(1, b.stride)
    var sum: Double = 0
    var i = 0
    while i < n {
        let x = Double(p[i * st])
        sum += x * x
        i += 1
    }
    let rms = (sum / Double(n)).squareRoot()
    return max(-100, 20 * log10(max(rms, 1e-9)))
}

func copyBuffer(_ b: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard b.frameLength > 0, let src = b.floatChannelData,
          let c = AVAudioPCMBuffer(pcmFormat: b.format, frameCapacity: b.frameLength),
          let dst = c.floatChannelData else { return nil }
    c.frameLength = b.frameLength
    let chans: Int = b.format.isInterleaved ? 1 : Int(b.format.channelCount)
    let count: Int = Int(b.frameLength) * max(1, b.stride)
    for k in 0..<chans {
        memcpy(dst[k], src[k], count * MemoryLayout<Float>.size)
    }
    return c
}

func processTap(_ buffer: AVAudioPCMBuffer, _ sh: TapShared) {
    let db = rmsDB(buffer)
    let now = up()
    let copy = copyBuffer(buffer)
    var voiceCb: (() -> Void)? = nil
    var levelCb: ((Double) -> Void)? = nil
    sh.lock.lock()
    sh.request?.append(buffer)
    if sh.maxRingFrames > 0, let c = copy {
        sh.ring.append(c)
        sh.ringFrames += Int(c.frameLength)
        while sh.ringFrames > sh.maxRingFrames && sh.ring.count > 1 {
            sh.ringFrames -= Int(sh.ring[0].frameLength)
            sh.ring.removeFirst()
        }
    }
    // Uyarlanir gurultu tabani: hizli iner, yavas cikar; esik = taban + 10 dB (-58..-28 dBFS arasi)
    if db < sh.noiseFloor { sh.noiseFloor = sh.noiseFloor * 0.7 + db * 0.3 } else { sh.noiseFloor = sh.noiseFloor * 0.995 + db * 0.005 }
    let thr = min(max(sh.noiseFloor + 10, -58), -28)
    if db > thr {
        sh.lastVoiceAt = now
        if sh.gateArmed { sh.gateArmed = false; voiceCb = sh.onVoice }
    }
    if sh.levelOn && now - sh.lastLevelAt >= 0.09 { sh.lastLevelAt = now; levelCb = sh.onLevel }
    sh.lock.unlock()
    if let f = voiceCb { DispatchQueue.main.async { f() } }
    if let f = levelCb { DispatchQueue.main.async { f(db) } }
}

func qualityName(_ q: AVSpeechSynthesisVoiceQuality) -> String {
    switch q {
    case .enhanced: return "enhanced"
    case .premium: return "premium"
    default: return "default"
    }
}

// MARK: - Neo
enum Phase { case idle, listening, thinking, speaking }
enum Role { case wake, command }

struct Speaking {
    let id: String
    let utt: AVSpeechUtterance
    let deadline: Double
}

final class Neo: NSObject, AVSpeechSynthesizerDelegate {
    // ayarlar
    var locale = "tr-TR"
    var silenceMs = 1200
    var maxMs = 15000
    var voiceId = ""
    var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    var gate = true
    let matcher = WakeMatcher()

    // tanimlayicilar
    var wakeRecognizer: SFSpeechRecognizer? = nil
    var cmdRecognizer: SFSpeechRecognizer? = nil
    var wakeOnDevice = false
    var cmdOnDevice = false
    var wakeSameAsCmd = false

    // ses motoru
    let engine = AVAudioEngine()
    var tapOn = false
    let shared = TapShared()
    var sampleRate: Double = 48000
    var observer: NSObjectProtocol? = nil
    var changeTimes: [Double] = []

    // durum
    var started = false
    var phase: Phase = .idle
    var lastState = ""

    // etkin tanima gorevi (en fazla bir tane)
    var task: SFSpeechRecognitionTask? = nil
    var request: SFSpeechAudioBufferRecognitionRequest? = nil
    var taskId = 0
    var role: Role = .wake
    var taskStartAt: Double = 0
    var taskLastChangeAt: Double = 0
    var taskText = ""
    var quickFails = 0
    var wakeRetryAt: Double = 0
    var wakeHoldUntil: Double = 0

    // komut yakalama
    var capStart: Double = 0
    var capSpeech = false
    var capLastChange: Double = 0
    var capText = ""
    var capViaWake = false
    var capFallbackIdx = 0
    var finishing = false
    var finishReason = "silence"
    var finishDeadline: Double = 0
    var lastPartial = ""
    var lastPartialAt: Double = 0
    var pendingPartial: String? = nil

    // seslendirme
    let synth = AVSpeechSynthesizer()
    var sayQueue: [(id: String, text: String)] = []
    var current: Speaking? = nil
    var restorePhase: Phase = .idle
    var speakLevel: Double = -60

    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
    var fast = false

    override init() {
        super.init()
        synth.delegate = self
        shared.onVoice = { [weak self] in self?.voiceDetected() }
        shared.onLevel = { [weak self] (db: Double) in self?.micLevel(db) }
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.schedule(deadline: .now() + .milliseconds(1000), repeating: .milliseconds(1000), leeway: .milliseconds(200))
        timer.resume()
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: OperationQueue.main) { [weak self] (_: Notification) in
            self?.engineChanged()
        }
        buildRecognizers()
    }

    // MARK: tanimlayicilar
    func buildRecognizers() {
        let en: SFSpeechRecognizer? = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        let tr: SFSpeechRecognizer? = SFSpeechRecognizer(locale: Locale(identifier: locale))
        cmdRecognizer = tr ?? en
        cmdOnDevice = cmdRecognizer?.supportsOnDeviceRecognition ?? false
        if let t = tr, t.supportsOnDeviceRecognition {
            wakeRecognizer = t
            wakeOnDevice = true
        } else if let e = en, e.supportsOnDeviceRecognition {
            wakeRecognizer = e                         // yalnizca uyandirma sozcugu icin
            wakeOnDevice = true
        } else {
            wakeRecognizer = tr ?? en
            wakeOnDevice = false
        }
        wakeSameAsCmd = wakeRecognizer != nil && wakeRecognizer === cmdRecognizer
    }

    func hello() -> [String: Any] {
        let prefix = String(locale.lowercased().prefix(2))
        var voices: [[String: Any]] = []
        for v in AVSpeechSynthesisVoice.speechVoices() where v.language.lowercased().hasPrefix(prefix) {
            voices.append(["id": v.identifier, "name": v.name, "lang": v.language, "quality": qualityName(v.quality)])
        }
        return ["type": "hello", "version": 1, "wakeOnDevice": wakeOnDevice, "cmdOnDevice": cmdOnDevice,
                "locale": locale, "voices": voices]
    }

    // MARK: durum
    func stateName() -> String {
        switch phase {
        case .speaking: return "speaking"
        case .listening: return "listening"
        case .thinking: return "thinking"
        case .idle: return started ? "idle" : "off"
        }
    }

    func emitState(force: Bool = false) {
        let s = stateName()
        if force || s != lastState {
            lastState = s
            emit(["type": "state", "state": s])
        }
        refreshTimer()
    }

    func refreshTimer() {
        let want = phase == .listening || phase == .speaking
        if want == fast { return }
        fast = want
        let ms = want ? 100 : 1000
        timer.schedule(deadline: .now() + .milliseconds(ms), repeating: .milliseconds(ms), leeway: .milliseconds(want ? 20 : 200))
    }

    func setLevel(_ on: Bool) {
        shared.lock.lock(); shared.levelOn = on; shared.lock.unlock()
    }

    func micLevel(_ db: Double) {
        if phase == .listening { emit(["type": "level", "db": round1(db)]) }
    }

    // MARK: izinler
    func withPermissions(_ then: @escaping () -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            checkSpeech(then)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { (ok: Bool) in
                DispatchQueue.main.async {
                    if ok { self.checkSpeech(then) } else { self.permissionDenied("mic_denied") }
                }
            }
        default:
            permissionDenied("mic_denied")
        }
    }

    func checkSpeech(_ then: @escaping () -> Void) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            then()
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { (st: SFSpeechRecognizerAuthorizationStatus) in
                DispatchQueue.main.async {
                    if st == .authorized { then() } else { self.permissionDenied("speech_denied") }
                }
            }
        default:
            permissionDenied("speech_denied")
        }
    }

    func permissionDenied(_ code: String) {
        if code == "mic_denied" {
            report(code, "Mikrofon izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Mikrofon bölümünden Cem App'e izin verin.")
        } else {
            report(code, "Konuşma tanıma izni yok. Sistem Ayarları › Gizlilik ve Güvenlik › Konuşma Tanıma bölümünden Cem App'e izin verin.")
        }
        started = false
        if phase == .listening { dropCapture(); phase = .idle }
        releaseEngineIfUnneeded()
        emitState(force: true)
    }

    // MARK: ses motoru
    func ensureEngine() -> Bool {
        if tapOn && engine.isRunning { return true }
        if tapOn { engine.inputNode.removeTap(onBus: 0); tapOn = false }
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else {
            report("engine", "Mikrofon bulunamadı (ses girişi yok).")
            return false
        }
        sampleRate = fmt.sampleRate
        let sh = shared
        sh.lock.lock()
        sh.ring = []
        sh.ringFrames = 0
        sh.maxRingFrames = Int(fmt.sampleRate * 1.5)
        sh.lock.unlock()
        input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { (buffer: AVAudioPCMBuffer, _: AVAudioTime) in
            processTap(buffer, sh)
        }
        tapOn = true
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            tapOn = false
            report("engine", "Mikrofon başlatılamadı: \(error.localizedDescription)")
            return false
        }
        return true
    }

    // Mikrofon gerekmiyorsa birakilir (macOS turuncu nokta kaybolur)
    func releaseEngineIfUnneeded() {
        if started || phase == .listening { return }
        endTask()
        guard tapOn else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        tapOn = false
        shared.lock.lock()
        shared.request = nil
        shared.ring = []
        shared.ringFrames = 0
        shared.gateArmed = false
        shared.lock.unlock()
    }

    // Aygit degisti (kulaklik takildi vb.): motor durur; ucu yeni bicimle yeniden kur
    func engineChanged() {
        guard tapOn else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        tapOn = false
        guard started || phase == .listening else { return }
        // Kisir dongu korumasi (or. Bluetooth kulaklik profil degistirirken art arda bildirim)
        let now = up()
        changeTimes = changeTimes.filter { now - $0 < 10 } + [now]
        if changeTimes.count > 6 { report("engine", "Ses aygıtı sürekli değişiyor; mikrofon durduruldu.") }
        if changeTimes.count > 6 || !ensureEngine() {
            started = false
            if phase == .listening { dropCapture(); phase = .idle }
            endTask()
            emitState(force: true)
            return
        }
        if task != nil && role == .wake {
            endTask()
            armOrStartWake()
        } else if phase == .listening && !finishing {
            if !capText.isEmpty {
                beginFinish("silence")
            } else {
                capViaWake = false
                if !startTask(.command, preroll: 0) { completeCapture() }
            }
        }
    }

    // MARK: tanima gorevi
    func prerollLocked(_ seconds: Double) -> [AVAudioPCMBuffer] {
        let want = Int(seconds * sampleRate)
        var out: [AVAudioPCMBuffer] = []
        var got = 0
        var i = shared.ring.count - 1
        while i >= 0 && got < want {
            out.append(shared.ring[i])
            got += Int(shared.ring[i].frameLength)
            i -= 1
        }
        return Array(out.reversed())
    }

    @discardableResult
    func startTask(_ r: Role, preroll: Double) -> Bool {
        endTask()
        guard let rec = (r == .wake ? wakeRecognizer : cmdRecognizer) else {
            report("no_recognizer", "Bu Mac'te \(locale) konuşma tanıma kullanılamıyor.")
            return false
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if r == .wake {
            req.requiresOnDeviceRecognition = wakeOnDevice
            req.contextualStrings = ["Neo", "Hey Neo"]
        } else {
            req.requiresOnDeviceRecognition = cmdOnDevice
            req.contextualStrings = ["Neo"]
        }
        taskId += 1
        let myId = taskId
        role = r
        taskText = ""
        taskStartAt = up()
        taskLastChangeAt = taskStartAt
        request = req
        task = rec.recognitionTask(with: req, resultHandler: { [weak self] (result: SFSpeechRecognitionResult?, error: Error?) in
            let text: String? = result?.bestTranscription.formattedString
            let isFinal: Bool = result?.isFinal ?? false
            let errMsg: String? = error?.localizedDescription
            DispatchQueue.main.async { self?.onResult(myId, text, isFinal, errMsg) }
        })
        shared.lock.lock()
        if preroll > 0 {
            for b in prerollLocked(preroll) { req.append(b) }
        }
        shared.request = req
        shared.gateArmed = false
        shared.lock.unlock()
        return true
    }

    func endTask() {
        guard task != nil || request != nil else { return }
        shared.lock.lock(); shared.request = nil; shared.lock.unlock()
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        taskId += 1                                   // eski gorevin geri cagrilari yok sayilir
    }

    func onResult(_ id: Int, _ text: String?, _ isFinal: Bool, _ err: String?) {
        guard id == taskId else { return }
        if let t = text, t != taskText { taskText = t; taskLastChangeAt = up() }
        switch role {
        case .wake: handleWake(isFinal, err)
        case .command: handleCommand(isFinal, err)
        }
    }

    // MARK: uyandirma
    func wakeWanted() -> Bool {
        return started && tapOn && (phase == .idle || phase == .thinking)
    }

    // Uyandirma dinlemesini surdur: kapi aciksa sesi bekle, degilse gorevi hemen baslat
    func armOrStartWake() {
        guard wakeWanted(), task == nil else { return }
        let now = up()
        if now < wakeHoldUntil || now < wakeRetryAt { return }      // tick yeniden dener
        if gate {
            shared.lock.lock()
            let recent = now - shared.lastVoiceAt < 0.5
            shared.gateArmed = !recent
            shared.lock.unlock()
            if recent { startTask(.wake, preroll: 0.6) }
        } else {
            startTask(.wake, preroll: 0)
        }
    }

    func voiceDetected() {
        guard wakeWanted(), task == nil else { return }
        let now = up()
        if now < wakeHoldUntil || now < wakeRetryAt { return }
        startTask(.wake, preroll: 0.6)
    }

    func handleWake(_ isFinal: Bool, _ err: String?) {
        if !taskText.isEmpty, let m = matcher.split(taskText) {
            quickFails = 0
            emit(["type": "wake", "text": m.wake])
            if wakeSameAsCmd && !isFinal && err == nil {
                // Ayni gorev komutu dinlemeye devam eder: "Hey Neo, sesi aç" tek nefeste
                role = .command
                resetCapture(viaWake: true, fallbackIdx: m.restIdx)
                phase = .listening
                setLevel(true)
                emitState()
                handleCommand(false, nil)
            } else {
                // Uyandirma baska dilde (en-US) ya da gorev bitti: tr-TR komut gorevi, on-kayitla
                endTask()
                resetCapture(viaWake: false, fallbackIdx: 0)
                phase = .listening
                setLevel(true)
                emitState()
                if !startTask(.command, preroll: wakeSameAsCmd ? 0.3 : 1.2) { completeCapture() }
            }
            return
        }
        if isFinal || err != nil {
            let age = up() - taskStartAt
            endTask()
            if age < 2 { quickFails += 1 } else { quickFails = 0 }
            if quickFails >= 3 {
                let d = min(30.0, 0.5 * pow(2.0, Double(quickFails - 2)))
                wakeRetryAt = up() + d
                if quickFails >= 5, let e = err {
                    report("engine", "\"Hey Neo\" dinlenemiyor: \(e)")
                }
            }
            armOrStartWake()
        }
    }

    // MARK: komut yakalama
    func resetCapture(viaWake: Bool, fallbackIdx: Int) {
        let now = up()
        capStart = now
        capSpeech = false
        capLastChange = now
        capText = ""
        capViaWake = viaWake
        capFallbackIdx = fallbackIdx
        finishing = false
        finishReason = "silence"
        lastPartial = ""
        lastPartialAt = 0
        pendingPartial = nil
    }

    func commandText(_ text: String) -> String {
        if capViaWake {
            if let m = matcher.split(text) { return stripLeadingWake(m.rest) }
            let words = tokenize(text).words
            return capFallbackIdx < words.count ? stripLeadingWake(words[capFallbackIdx...].joined(separator: " ")) : ""
        }
        // Yeni gorev (kisayol ya da en-US uyandirma sonrasi): bastaki "hey neo" atilir
        return stripLeadingWake(text)
    }

    // Metnin basindaki (en fazla 1 kelime sonra baslayan) uyandirma ifadesi atilir: "hey neo sesi aç" -> "sesi aç"
    func stripLeadingWake(_ text: String) -> String {
        let tk = tokenize(text)
        if let m = matcher.match(tk.toks.map { $0.norm }), m.start <= 1 {
            if m.end >= tk.toks.count { return "" }
            return cleanText(tk.words[tk.toks[m.end].idx...].joined(separator: " "))
        }
        return cleanText(text)
    }

    func queuePartial(_ text: String) {
        if text == lastPartial { pendingPartial = nil; return }
        let now = up()
        if now - lastPartialAt >= 0.125 {
            emit(["type": "partial", "text": text])
            lastPartial = text
            lastPartialAt = now
            pendingPartial = nil
        } else {
            pendingPartial = text
        }
    }

    func handleCommand(_ isFinal: Bool, _ err: String?) {
        guard phase == .listening else { endTask(); return }
        let cmd = commandText(taskText)
        if cmd != capText {
            capText = cmd
            if !cmd.isEmpty {
                capSpeech = true
                capLastChange = up()
                queuePartial(cmd)
            }
        }
        if finishing {
            if isFinal || err != nil { completeCapture() }
            return
        }
        if isFinal || err != nil {
            if !capText.isEmpty {
                finishReason = "silence"
                completeCapture()
            } else if let e = err, up() - taskStartAt < 1.5 {
                report("engine", "Konuşma tanıma hatası: \(e)")
                completeCapture()
            } else {
                // metin yok, gorev erken bitti: yeni gorevle dinlemeye devam (6 sn kurali tick'te)
                capViaWake = false
                if !startTask(.command, preroll: 0.3) { completeCapture() }
            }
        }
    }

    func beginListen() {
        if phase == .listening { return }
        guard ensureEngine() else {
            releaseEngineIfUnneeded()
            emitState(force: true)
            return
        }
        endTask()
        resetCapture(viaWake: false, fallbackIdx: 0)
        phase = .listening
        setLevel(true)
        emitState()
        if !startTask(.command, preroll: 0) { completeCapture() }
    }

    // Ses akisi kesilir, son sonuc kisa sure beklenir (cihaz uzerinde genelde <300 ms)
    func beginFinish(_ reason: String) {
        guard phase == .listening, !finishing else { return }
        finishing = true
        finishReason = reason
        finishDeadline = up() + 0.8
        shared.lock.lock(); shared.request = nil; shared.lock.unlock()
        request?.endAudio()
        if task == nil { completeCapture() }
    }

    func completeCapture() {
        guard phase == .listening else { return }
        let text = capText
        let reason = finishReason
        dropCapture()
        if text.isEmpty {
            emit(["type": "nocommand"])
        } else {
            emit(["type": "command", "text": text, "reason": reason])
        }
        phase = .idle
        wakeHoldUntil = up() + 0.3
        emitState()
        releaseEngineIfUnneeded()
        armOrStartWake()
    }

    // Yakalamayi olaysiz birakir (durum/faz cagiran tarafindan ayarlanir)
    func dropCapture() {
        endTask()
        finishing = false
        pendingPartial = nil
        setLevel(false)
    }

    func cancelCapture() {
        guard phase == .listening else { return }
        dropCapture()
        phase = .idle
        emitState()
        releaseEngineIfUnneeded()
        armOrStartWake()
    }

    // MARK: seslendirme
    func pickVoice() -> AVSpeechSynthesisVoice? {
        if !voiceId.isEmpty, let v = AVSpeechSynthesisVoice(identifier: voiceId) { return v }
        if let v = AVSpeechSynthesisVoice(language: locale) { return v }
        report("tts", "Türkçe ses bulunamadı; varsayılan ses kullanılıyor. Sistem Ayarları › Erişilebilirlik › Seslendirilen İçerik › Sistem Sesi'nden Türkçe bir ses indirin.")
        return nil
    }

    func say(_ id: String, _ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { emit(["type": "spoken", "id": id]); return }
        sayQueue.append((id: id, text: t))
        if current == nil { speakNext() }
    }

    func speakNext() {
        guard current == nil else { return }
        if sayQueue.isEmpty { endSpeaking(); return }
        let item = sayQueue.removeFirst()
        if phase != .speaking {
            if phase == .listening { dropCapture() }
            restorePhase = phase == .thinking ? .thinking : .idle
            phase = .speaking
            if task != nil { endTask() }              // uyandirma dinlemesi durur
            shared.lock.lock(); shared.gateArmed = false; shared.lock.unlock()
            emitState()
        }
        let u = AVSpeechUtterance(string: item.text)
        u.voice = pickVoice()
        u.rate = rate
        // Bekci: ses cikisi yoksa/takilirsa sonsuza dek "speaking" kalinmasin
        let scale = Double(AVSpeechUtteranceDefaultSpeechRate) / Double(max(rate, 0.05))
        let est = 4.0 + Double(item.text.count) * 0.12 * scale
        current = Speaking(id: item.id, utt: u, deadline: up() + min(est, 600))
        speakLevel = -30
        synth.speak(u)
    }

    func utteranceEnded(_ u: AVSpeechUtterance, stopped: Bool) {
        guard let c = current, c.utt === u else { return }
        current = nil
        var o: [String: Any] = ["type": "spoken", "id": c.id]
        if stopped { o["stopped"] = true }
        emit(o)
        speakNext()
    }

    func endSpeaking() {
        guard phase == .speaking else { return }
        phase = restorePhase
        speakLevel = -60
        wakeHoldUntil = up() + 0.4                    // hoparlor kuyrugu duyulmasin
        emitState()
        armOrStartWake()
    }

    // Kuyruk ve gecerli cumle hemen durur; "spoken stopped" olaylari esZamanli gonderilir
    func stopSay() {
        let pending = sayQueue
        sayQueue = []
        if let c = current {
            current = nil
            synth.stopSpeaking(at: .immediate)        // gec gelen didCancel yok sayilir (current bos)
            emit(["type": "spoken", "id": c.id, "stopped": true])
        }
        for p in pending { emit(["type": "spoken", "id": p.id, "stopped": true]) }
        endSpeaking()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.utteranceEnded(utterance, stopped: false) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.utteranceEnded(utterance, stopped: true) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.speakLevel = -14 }
    }

    // MARK: zamanlayici
    func flushPartial(_ now: Double) {
        if let p = pendingPartial, now - lastPartialAt >= 0.125 {
            pendingPartial = nil
            if p != lastPartial {
                emit(["type": "partial", "text": p])
                lastPartial = p
                lastPartialAt = now
            }
        }
    }

    func tick() {
        let now = up()
        if phase == .listening {
            flushPartial(now)
            if finishing {
                if now >= finishDeadline { completeCapture() }
            } else if capSpeech && (now - capLastChange) * 1000 >= Double(silenceMs) {
                beginFinish("silence")
            } else if (now - capStart) * 1000 >= Double(maxMs) {
                beginFinish("timeout")
            } else if !capSpeech && now - capStart >= 6 {
                completeCapture()                     // hic konusma yok -> nocommand
            }
        }
        if let c = current, now > c.deadline {
            current = nil
            synth.stopSpeaking(at: .immediate)
            report("tts", "Seslendirme tamamlanamadı (ses çıkışı yok ya da konuşma motoru yanıt vermiyor).")
            emit(["type": "spoken", "id": c.id, "stopped": true])
            speakNext()
        }
        if phase == .speaking {
            speakLevel = max(-60, speakLevel - 3)
            emit(["type": "level", "db": round1(speakLevel)])
        }
        if task != nil && role == .wake {
            let age = now - taskStartAt
            shared.lock.lock(); let lastVoice = shared.lastVoiceAt; shared.lock.unlock()
            let quiet = now - lastVoice
            if gate && age > 2 && quiet > 4 && now - taskLastChangeAt > 3 {
                endTask()                             // sessizlik: tanima durur, kapi yeniden kurulur
                armOrStartWake()
            } else if (age > 50 && (quiet > 0.4 || age > 58)) || (taskText.count > 160 && now - taskLastChangeAt > 0.5) {
                startTask(.wake, preroll: 0.3)        // ~1 dk gorev siniri ve biriken metin
            }
        } else if task == nil && wakeWanted() {
            armOrStartWake()
        }
        refreshTimer()
    }

    // MARK: komutlar
    func configure(_ o: [String: Any]) {
        if let w = o["wake"] as? [String] { matcher.set(w) }
        if let n = o["silenceMs"] as? NSNumber, n.doubleValue.isFinite { silenceMs = Int(max(300, min(10000, n.doubleValue))) }
        if let n = o["maxMs"] as? NSNumber, n.doubleValue.isFinite { maxMs = Int(max(2000, min(120000, n.doubleValue))) }
        if let v = o["voice"] as? String { voiceId = v }
        if let n = o["rate"] as? NSNumber, n.doubleValue.isFinite {
            rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, n.floatValue))
        }
        if let g = o["gate"] as? Bool { gate = g }
        if let l = o["locale"] as? String, !l.isEmpty, l != locale {
            locale = l
            if phase == .listening { dropCapture(); phase = .idle }
            endTask()
            buildRecognizers()
            emit(hello())
            emitState()
            armOrStartWake()
        }
    }

    func start() {
        started = true
        withPermissions {
            guard self.started else { return }
            guard self.ensureEngine() else {
                self.started = false
                self.emitState(force: true)
                return
            }
            let wasOn = (self.wakeOnDevice, self.cmdOnDevice)
            if self.task == nil { self.buildRecognizers() }   // dil paketi sonradan inmis olabilir
            if wasOn != (self.wakeOnDevice, self.cmdOnDevice) { emit(self.hello()) }
            if self.wakeRecognizer == nil {
                report("no_recognizer", "Bu Mac'te konuşma tanıma kullanılamıyor.")
                self.started = false
                self.releaseEngineIfUnneeded()
                self.emitState(force: true)
                return
            }
            if !self.wakeOnDevice {
                report("no_recognizer", "Cihaz üzerinde (çevrimdışı) konuşma tanıma yok; \"Hey Neo\" internet üzerinden algılanacak. Sistem Ayarları › Klavye › Dikte'den Türkçe dikteyi açın.")
            }
            self.emitState()
            self.armOrStartWake()
        }
    }

    func stop() {
        started = false
        if phase == .listening { dropCapture(); phase = .idle }
        endTask()
        releaseEngineIfUnneeded()
        emitState()
    }

    func listen() {
        if phase == .listening {
            if !finishing { beginFinish("manual") }   // ikinci basis: simdiye kadar soyleneni gonder
            return
        }
        if phase == .speaking { stopSay() }
        withPermissions {
            self.beginListen()
        }
    }

    func setThinking() {
        if phase == .speaking { restorePhase = .thinking; return }
        if phase == .listening { dropCapture() }
        phase = .thinking
        emitState()
        releaseEngineIfUnneeded()
        armOrStartWake()
    }

    func setIdle() {
        if phase == .speaking { restorePhase = .idle; return }
        if phase == .listening { dropCapture() }
        phase = .idle
        emitState()
        releaseEngineIfUnneeded()
        armOrStartWake()
    }

    func shutdown() {
        synth.stopSpeaking(at: .immediate)
        endTask()
        if tapOn {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
            tapOn = false
        }
        exit(0)
    }

    func handle(_ line: String) {
        guard let data = line.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let cmd = o["cmd"] as? String else { return }
        switch cmd {
        case "config": configure(o)
        case "start": start()
        case "stop": stop()
        case "listen": listen()
        case "cancel": cancelCapture()
        case "thinking": setThinking()
        case "idle": setIdle()
        case "say":
            let id: String = (o["id"] as? String) ?? ((o["id"] as? NSNumber)?.stringValue ?? "")
            say(id, (o["text"] as? String) ?? "")
        case "stopSay": stopSay()
        case "quit": shutdown()
        default: break
        }
    }
}

// MARK: - Ana dongu
let neo = Neo()
emit(neo.hello())
neo.emitState(force: true)

// stdin satirlari arka planda okunur, komutlar ana kuyrukta islenir; EOF = ana surec kapandi
DispatchQueue.global().async {
    while let line = readLine() {
        DispatchQueue.main.async { neo.handle(line) }
    }
    DispatchQueue.main.async { neo.shutdown() }
}
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: DispatchQueue.main)
term.setEventHandler { neo.shutdown() }
term.resume()
RunLoop.main.run()
