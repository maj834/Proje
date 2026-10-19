## Orumcek cizimi: golge, 8 eklemli bacak (adim animasyonu), killi karin deseni, can cubugu.
extends Node2D

const ColonySim := preload("res://scripts/colony_sim.gd")
const BODY := Color(0.12, 0.09, 0.08)
const PATTERN := Color(0.55, 0.42, 0.28)
const SCALE := Vector2(1.7, 1.7)

var sim: ColonySim
var _time := 0.0
var _hurt := 0.0
var _last_hp := 0.0


func _process(delta: float) -> void:
	_time += delta
	if not sim.spider.is_empty():
		var hp: float = sim.spider["hp"]
		if hp < _last_hp - 0.01:
			_hurt = 1.0
		_last_hp = hp
	_hurt = maxf(0.0, _hurt - delta * 4.0)
	queue_redraw()


func _draw() -> void:
	if sim.spider.is_empty():
		return
	var s := sim.spider
	var p: Vector2 = s["pos"]
	var h: float = s["heading"]
	draw_set_transform(p + Vector2(6, 9), h, SCALE)
	_draw_body(Color(0, 0, 0, 0.3), Color(0, 0, 0, 0.0), true)
	draw_set_transform(p, h, SCALE)
	var tint := BODY.lerp(Color(0.8, 0.2, 0.15), _hurt)
	_draw_body(tint, PATTERN, false)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if s["hp"] < ColonySim.SPIDER_HP:
		var frac: float = s["hp"] / ColonySim.SPIDER_HP
		var bar := Rect2(p + Vector2(-24, -48), Vector2(48, 4))
		draw_rect(bar, Color(0, 0, 0, 0.6))
		draw_rect(Rect2(bar.position, Vector2(48 * frac, 4)), Color(0.85, 0.25, 0.2))


## +X yonune bakan orumcek; govde ~30 px.
func _draw_body(col: Color, pattern: Color, shadow: bool) -> void:
	var leg_col := col if shadow else col.lightened(0.08)
	for side in [-1.0, 1.0]:
		for k in 4:
			var root := Vector2(4.0 - k * 2.6, side * 3.0)
			var phase := _time * 9.0 + k * 1.6 + (0.0 if side > 0 else PI)
			var swing := sin(phase) * 3.0
			var knee := root + Vector2(10.0 - k * 5.0 + swing, side * (11.0 + k * 0.5))
			var tip := knee + Vector2(8.0 - k * 6.0 + swing * 1.4, side * 9.0)
			draw_line(root, knee, leg_col, 2.2, true)
			draw_line(knee, tip, leg_col, 1.6, true)
	# Karin
	_ellipse(Vector2(-10, 0), Vector2(11, 8.5), col)
	_ellipse(Vector2(5, 0), Vector2(7, 6), col)
	if shadow:
		return
	_ellipse(Vector2(-8, -1.5), Vector2(5, 3), col.lightened(0.12))
	for k in 3:
		_ellipse(Vector2(-14 + k * 4.5, 0), Vector2(1.6, 3.6 - k * 0.6), pattern)
	draw_circle(Vector2(10.5, -2), 1.1, Color(0.9, 0.3, 0.2))
	draw_circle(Vector2(10.5, 2), 1.1, Color(0.9, 0.3, 0.2))


func _ellipse(c: Vector2, r: Vector2, col: Color) -> void:
	var pts := PackedVector2Array()
	for k in 16:
		var a := TAU * k / 16.0
		pts.append(c + Vector2(cos(a) * r.x, sin(a) * r.y))
	draw_colored_polygon(pts, col)
