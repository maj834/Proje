## Yiyecek kumeleri: tohum / meyve / yaprak kirintisi, nabiz atan parilti, belirirken "pop".
extends Node2D

const ColonySim := preload("res://scripts/colony_sim.gd")
const KIND_COLORS := [
	[Color(0.86, 0.62, 0.22), Color(1.0, 0.88, 0.55)],  # tohum
	[Color(0.72, 0.12, 0.16), Color(1.0, 0.55, 0.5)],  # meyve
	[Color(0.42, 0.62, 0.18), Color(0.75, 0.9, 0.45)],  # yaprak
]
const GLOW := Color(1.0, 0.75, 0.3)

var sim: ColonySim
var _time := 0.0
var _rng := RandomNumberGenerator.new()


func _process(delta: float) -> void:
	_time += delta
	for f in sim.foods:
		f["pop"] = minf(1.0, f.get("pop", 0.0) + delta * 2.5)
	queue_redraw()


func _draw() -> void:
	for f in sim.foods:
		_draw_food(f)


func _draw_food(f: Dictionary) -> void:
	var pos: Vector2 = f["pos"]
	var frac: float = float(f["amount"]) / float(f["max"])
	var pop := _elastic(f.get("pop", 1.0))
	var r: float = f["radius"] * (0.65 + 0.6 * frac) * pop
	var cols: Array = KIND_COLORS[f["kind"]]
	# Parilti halkalari (ust uste yari saydam daireler)
	var pulse := 1.0 + 0.08 * sin(_time * 3.0 + pos.x)
	for k in 3:
		var gr := r * (1.5 + k * 0.45) * pulse
		draw_circle(pos, gr, Color(GLOW, 0.1 - k * 0.025))
	draw_circle(pos + Vector2(3, 4), r * 0.95, Color(0, 0, 0, 0.3))
	_rng.seed = hash(pos)
	var pieces := int(5 + 22 * frac)
	for c in pieces:
		var o := Vector2.from_angle(_rng.randf() * TAU) * sqrt(_rng.randf()) * r * 0.8
		var rot := _rng.randf() * TAU
		var size := (3.0 + _rng.randf() * 2.2) * pop
		_draw_piece(pos + o, rot, size, cols, f["kind"])


func _draw_piece(p: Vector2, rot: float, size: float, cols: Array, kind: int) -> void:
	var stretch := Vector2(1.6, 1.0) if kind == 0 else Vector2(1.0, 1.0)
	if kind == 2:
		stretch = Vector2(1.8, 0.8)
	draw_set_transform(p, rot, stretch)
	draw_circle(Vector2(0.6, 0.8), size, Color(0, 0, 0, 0.35))
	draw_circle(Vector2.ZERO, size, cols[0])
	draw_circle(Vector2(-0.35, -0.45) * size, size * 0.42, cols[1])
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _elastic(t: float) -> float:
	if t >= 1.0:
		return 1.0
	return maxf(0.0, 1.0 + pow(2.0, -10.0 * t) * sin((t - 0.075) * TAU / 0.3))
