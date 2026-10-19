## Efektler: parcacik havuzu, genisleyen halkalar, ucan yazilar, atmosfer (toz, ates bocegi),
## feromon fircasi imleci. Hepsi tek dugum altinda; halkalar ve yazilar _draw ile.
extends Node2D

const POOL := 24

var world_size := Vector2(1920, 1080)
var brush_visible := false
var brush_pos := Vector2.ZERO
var brush_radius := 22.0

var _dot: ImageTexture
var _pool: Array[CPUParticles2D] = []
var _next := 0
var _rings: Array[Dictionary] = []
var _texts: Array[Dictionary] = []
var _fireflies: CPUParticles2D
var _dust: CPUParticles2D
var _font: Font
var _time := 0.0


func _ready() -> void:
	_font = ThemeDB.fallback_font
	_dot = _make_dot_texture()
	for i in POOL:
		var p := _make_particles(10, 0.55)
		p.one_shot = true
		p.emitting = false
		p.explosiveness = 0.95
		p.initial_velocity_min = 18.0
		p.initial_velocity_max = 46.0
		p.damping_min = 50.0
		p.damping_max = 80.0
		add_child(p)
		_pool.append(p)
	_fireflies = _make_ambient(70, 7.0, Color(0.8, 1.0, 0.45), 6.0, 1.6)
	_dust = _make_ambient(50, 9.0, Color(1.0, 0.92, 0.75), 4.0, 0.9)
	add_child(_dust)
	add_child(_fireflies)


func _process(delta: float) -> void:
	_time += delta
	for i in range(_rings.size() - 1, -1, -1):
		_rings[i]["t"] += delta / _rings[i]["dur"]
		if _rings[i]["t"] >= 1.0:
			_rings.remove_at(i)
	for i in range(_texts.size() - 1, -1, -1):
		_texts[i]["t"] += delta / 1.2
		if _texts[i]["t"] >= 1.0:
			_texts.remove_at(i)
	queue_redraw()


## night: 0 gunduz .. 1 gece
func set_night(night: float) -> void:
	_fireflies.modulate.a = smoothstep(0.35, 0.9, night)
	_dust.modulate.a = (1.0 - night) * 0.55


func burst(pos: Vector2, col: Color, amount := 10) -> void:
	var p := _pool[_next]
	_next = (_next + 1) % POOL
	p.position = pos
	p.color = col
	p.amount = amount
	p.restart()


func ring(pos: Vector2, col: Color, max_radius: float, dur := 0.5, width := 2.5) -> void:
	_rings.append({"pos": pos, "col": col, "r": max_radius, "t": 0.0, "dur": dur, "w": width})


func float_text(pos: Vector2, text: String, col: Color) -> void:
	_texts.append({"pos": pos, "text": text, "col": col, "t": 0.0})


func _draw() -> void:
	for r in _rings:
		var t: float = r["t"]
		var e := 1.0 - pow(1.0 - t, 3.0)
		var col: Color = r["col"]
		col.a *= 1.0 - t
		draw_arc(r["pos"], r["r"] * e, 0.0, TAU, 48, col, r["w"] * (1.0 - t * 0.5), true)
	for tx in _texts:
		var t: float = tx["t"]
		var col: Color = tx["col"]
		col.a = 1.0 - t * t
		var p: Vector2 = tx["pos"] + Vector2(0, -26.0 * (1.0 - pow(1.0 - t, 2.0)))
		draw_string_outline(
			_font,
			p,
			tx["text"],
			HORIZONTAL_ALIGNMENT_CENTER,
			-1,
			15,
			4,
			Color(0, 0, 0, col.a * 0.6)
		)
		draw_string(_font, p, tx["text"], HORIZONTAL_ALIGNMENT_CENTER, -1, 15, col)
	if brush_visible:
		var a := 0.55 + 0.2 * sin(_time * 6.0)
		draw_arc(brush_pos, brush_radius, 0.0, TAU, 40, Color(1.0, 0.75, 0.3, a), 1.5, true)
		draw_circle(brush_pos, brush_radius, Color(1.0, 0.75, 0.3, 0.07))


func _make_particles(amount: int, lifetime: float) -> CPUParticles2D:
	var p := CPUParticles2D.new()
	p.amount = amount
	p.lifetime = lifetime
	p.texture = _dot
	p.spread = 180.0
	p.gravity = Vector2.ZERO
	p.scale_amount_min = 0.25
	p.scale_amount_max = 0.55
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1, 1, 1, 1))
	ramp.set_color(1, Color(1, 1, 1, 0))
	p.color_ramp = ramp
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	mat.light_mode = CanvasItemMaterial.LIGHT_MODE_UNSHADED
	p.material = mat
	p.z_index = 3
	return p


## Dunya geneline yayilan surekli suzulen zerreler (ates bocegi / toz).
func _make_ambient(
	amount: int, lifetime: float, col: Color, speed: float, size: float
) -> CPUParticles2D:
	var p := _make_particles(amount, lifetime)
	p.local_coords = false
	p.preprocess = lifetime
	p.emission_shape = CPUParticles2D.EMISSION_SHAPE_RECTANGLE
	p.emission_rect_extents = world_size * 0.5
	p.position = world_size * 0.5
	p.initial_velocity_min = speed * 0.3
	p.initial_velocity_max = speed
	p.scale_amount_min = 0.2 * size
	p.scale_amount_max = 0.4 * size
	var ramp := Gradient.new()
	ramp.offsets = PackedFloat32Array([0.0, 0.2, 0.5, 0.8, 1.0])
	ramp.colors = PackedColorArray(
		[
			Color(1, 1, 1, 0),
			Color(1, 1, 1, 1),
			Color(1, 1, 1, 0.3),
			Color(1, 1, 1, 1),
			Color(1, 1, 1, 0)
		]
	)
	p.color_ramp = ramp
	p.color = col
	p.z_index = 6
	return p


## 32x32 yumusak daire; tum parcaciklar paylasir.
func _make_dot_texture() -> ImageTexture:
	var img := Image.create_empty(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(x - 15.5, y - 15.5).length() / 15.5
			var a := clampf(1.0 - d, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, a * a))
	return ImageTexture.create_from_image(img)
