## Statik dekor: dusmus yapraklar, dallar, taslar, cimen tutamlari. Bir kez cizilir.
extends Node2D

const LIGHT_DIR := Vector2(-0.6, -0.8)
const SHADOW := Vector2(3.0, 4.0)
const LEAF_COLORS := [
	Color(0.55, 0.32, 0.12),
	Color(0.68, 0.45, 0.14),
	Color(0.42, 0.22, 0.1),
	Color(0.47, 0.5, 0.18),
	Color(0.6, 0.24, 0.1),
]

var world_size := Vector2(1920, 1080)
var nest_pos := Vector2(960, 540)
var decor_seed := 5

var _rng := RandomNumberGenerator.new()


func _draw() -> void:
	_rng.seed = decor_seed
	for i in 70:
		_draw_grass(_free_point(60.0))
	for i in 22:
		_draw_twig(_free_point(90.0))
	for i in 55:
		_draw_leaf(_free_point(80.0), _rng.randf_range(10.0, 26.0))
	for i in 40:
		_draw_rock(_free_point(70.0), _rng.randf_range(2.5, 9.0))


func _free_point(min_nest_dist: float) -> Vector2:
	for attempt in 10:
		var p := Vector2(_rng.randf() * world_size.x, _rng.randf() * world_size.y)
		if p.distance_to(nest_pos) > min_nest_dist:
			return p
	return Vector2.ZERO


func _draw_leaf(p: Vector2, size: float) -> void:
	var rot := _rng.randf() * TAU
	var col: Color = LEAF_COLORS[_rng.randi() % LEAF_COLORS.size()]
	col = col.darkened(_rng.randf_range(0.0, 0.25))
	var pts := PackedVector2Array()
	var curl := _rng.randf_range(-0.25, 0.25)
	for k in 20:
		var t := float(k) / 19.0 * TAU
		# Uclu yaprak profili: bir ucu sivri
		var r := size * (0.5 + 0.5 * sin(t * 0.5)) * 0.45
		var v := Vector2(cos(t) * size * 0.5, sin(t) * r)
		v.y += curl * v.x * v.x / size
		pts.append(p + v.rotated(rot))
	var shadow := PackedVector2Array()
	for v in pts:
		shadow.append(v + SHADOW)
	draw_colored_polygon(shadow, Color(0, 0, 0, 0.28))
	draw_colored_polygon(pts, col)
	# Isik tarafi acik ton (ust yarim), damar
	var tip := p + Vector2(size * 0.5, 0).rotated(rot)
	var base := p - Vector2(size * 0.55, 0).rotated(rot)
	draw_line(base, tip, col.lightened(0.25), 1.2, true)
	for k in 4:
		var t := 0.2 + k * 0.18
		var q := base.lerp(tip, t)
		var side := Vector2(size * 0.12, size * 0.16).rotated(rot)
		draw_line(q, q + side, col.lightened(0.15), 0.8, true)
		draw_line(q, q + Vector2(side.x, -side.y).rotated(0), col.darkened(0.15), 0.8, true)


func _draw_twig(p: Vector2) -> void:
	var rot := _rng.randf() * TAU
	var length := _rng.randf_range(40.0, 110.0)
	var pts := PackedVector2Array()
	var dir := Vector2.from_angle(rot)
	var q := p
	for k in 6:
		pts.append(q)
		dir = dir.rotated(_rng.randf_range(-0.25, 0.25))
		q += dir * length / 5.0
	var w := _rng.randf_range(2.5, 4.5)
	var shadow := PackedVector2Array()
	for v in pts:
		shadow.append(v + SHADOW)
	draw_polyline(shadow, Color(0, 0, 0, 0.3), w + 1.0, true)
	draw_polyline(pts, Color(0.22, 0.14, 0.08), w, true)
	var hl := PackedVector2Array()
	for v in pts:
		hl.append(v + LIGHT_DIR * w * 0.25)
	draw_polyline(hl, Color(0.45, 0.32, 0.2), w * 0.35, true)
	# Yan filiz
	var mid := pts[3]
	var side := mid + Vector2.from_angle(rot + 0.7) * length * 0.25
	draw_line(mid, side, Color(0.22, 0.14, 0.08), w * 0.6, true)


func _draw_rock(p: Vector2, r: float) -> void:
	var base := Color(0.42, 0.4, 0.37).darkened(_rng.randf_range(0.0, 0.3))
	draw_circle(p + SHADOW * (r / 8.0 + 0.4), r * 1.05, Color(0, 0, 0, 0.3))
	draw_circle(p, r, base.darkened(0.3))
	draw_circle(p + LIGHT_DIR * r * 0.15, r * 0.82, base)
	draw_circle(p + LIGHT_DIR * r * 0.4, r * 0.35, base.lightened(0.3))


func _draw_grass(p: Vector2) -> void:
	var blades := _rng.randi_range(4, 9)
	var col := Color(0.36, 0.46, 0.14).darkened(_rng.randf_range(0.0, 0.35))
	for k in blades:
		var a := -PI * 0.5 + _rng.randf_range(-0.9, 0.9)
		var l := _rng.randf_range(8.0, 18.0)
		var tip := p + Vector2.from_angle(a) * l
		var bend := tip + Vector2(_rng.randf_range(-3, 3), 0)
		draw_line(p + SHADOW * 0.5, bend + SHADOW * 0.5, Color(0, 0, 0, 0.2), 1.6, true)
		draw_line(p, bend, col.lightened(_rng.randf() * 0.25), 1.4, true)
