## Ses: olay sesleri havuzu (spam engeli + perde cesitliligi) ve gun/gece ambiyans gecisi.
extends Node

const SOUNDS := {
	"pickup": ["res://audio/pickup.wav", -16.0],
	"drop": ["res://audio/drop.wav", -8.0],
	"birth": ["res://audio/birth.wav", -14.0],
	"discover": ["res://audio/discover.wav", -9.0],
	"milestone": ["res://audio/milestone.wav", -6.0],
}
const POOL := 6
const MIN_GAP := 0.08

var _streams := {}
var _volumes := {}
var _last_played := {}
var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _day: AudioStreamPlayer
var _night: AudioStreamPlayer
var _clock := 0.0


func _ready() -> void:
	for key in SOUNDS:
		_streams[key] = load(SOUNDS[key][0])
		_volumes[key] = SOUNDS[key][1]
	for i in POOL:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)
	_day = _make_loop("res://audio/ambient_day.wav")
	_night = _make_loop("res://audio/ambient_night.wav")


func _exit_tree() -> void:
	# Cikista dongusel oynaticilari durdur; aksi halde motor kapanirken kaynak sizar.
	_day.stop()
	_night.stop()


func _process(delta: float) -> void:
	_clock += delta


func play(key: String) -> void:
	if _clock - _last_played.get(key, -1.0) < MIN_GAP:
		return
	_last_played[key] = _clock
	var p := _players[_next]
	_next = (_next + 1) % POOL
	p.stream = _streams[key]
	p.volume_db = _volumes[key]
	p.pitch_scale = randf_range(0.92, 1.08)
	p.play()


## night: 0 gunduz .. 1 gece; ambiyanslar capraz gecer.
func set_night(night: float) -> void:
	_day.volume_db = linear_to_db(maxf(0.001, (1.0 - night) * 0.13))
	_night.volume_db = linear_to_db(maxf(0.001, night * 0.15))


func _make_loop(path: String) -> AudioStreamPlayer:
	# Dongu ayari .wav.import dosyasinda (edit/loop_mode=2).
	var p := AudioStreamPlayer.new()
	p.stream = load(path)
	p.volume_db = -40.0
	add_child(p)
	# Basliksiz (test/CI) modda ses yok; dongusel oynatma orada kapanista kaynak sizdirir.
	if DisplayServer.get_name() != "headless":
		p.play()
	return p
