## Ana dunya: simulasyonu ilerletir ve hafif gorsel katmanlari kurar.
## Cizim butcesi: zemin (1 shader), feromon (1 shader), karinca+golge (2 MultiMesh),
## yuva (1 shader), yiyecekler (_draw), parcaciklar (CPU, havuzlu), 1 isik.
extends Node2D

const ColonySim := preload("res://scripts/colony_sim.gd")
const GROUND_SHADER := preload("res://shaders/ground.gdshader")
const PHEROMONE_SHADER := preload("res://shaders/pheromone.gdshader")
const NEST_SHADER := preload("res://shaders/nest.gdshader")

const COLOR_SEARCH := Color(0.09, 0.06, 0.04)
const COLOR_CARRY := Color(0.55, 0.36, 0.08)
const PARTICLE_POOL := 16
const DAY_LENGTH := 150.0

@export var world_size := Vector2(1920, 1080)
@export var start_ants := 300
@export var sim_seed := 1

var sim: ColonySim
var paused := false
var time_scale := 1
var show_pheromones := true
var day_time := 0.25  # 0..1, 0.25 = sabah

var _ants: MultiMeshInstance2D
var _shadows: MultiMeshInstance2D
var _pheromone_sprite: Sprite2D
var _home_tex: ImageTexture
var _food_tex: ImageTexture
var _tex_timer := 0.0
var _particles: Array[CPUParticles2D] = []
var _next_particle := 0
var _modulate: CanvasModulate
var _nest_light: PointLight2D


func _ready() -> void:
	sim = ColonySim.new()
	sim.setup(sim_seed, start_ants, world_size)
	_build_ground()
	_build_pheromones()
	_build_nest()
	_build_ants()
	_build_particles()
	_build_lighting()


func _process(delta: float) -> void:
	if not paused:
		var dt := minf(delta, 1.0 / 30.0)  # Takilmada sicrama yapmasin.
		for i in time_scale:
			sim.step(dt)
			_spawn_effects()
		if sim.foods_changed or time_scale > 1:
			queue_redraw()
		day_time = fmod(day_time + delta * time_scale / DAY_LENGTH, 1.0)
	_update_ants()
	_update_lighting()
	_tex_timer -= delta
	if _tex_timer <= 0.0 and show_pheromones:
		_tex_timer = 0.1
		_upload_pheromones()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_pause"):
		paused = not paused
	elif event.is_action_pressed("toggle_pheromones"):
		show_pheromones = not show_pheromones
		_pheromone_sprite.visible = show_pheromones
	elif event.is_action_pressed("speed_up"):
		time_scale = mini(time_scale * 2, 8)
	elif event.is_action_pressed("speed_down"):
		time_scale = maxi(time_scale / 2, 1)
	elif (
		event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT
	):
		var p := get_global_mouse_position()
		if Rect2(Vector2.ZERO, world_size).has_point(p):
			sim.add_food(p, 60)
			queue_redraw()


## Yiyecekler: tohum/yaprak kirintisi kumesi; miktar azaldikca kuculur.
func _draw() -> void:
	for f in sim.foods:
		var pos: Vector2 = f["pos"]
		var frac: float = float(f["amount"]) / float(f["max"])
		var r: float = f["radius"] * (0.45 + 0.55 * frac)
		draw_circle(pos + Vector2(2, 3), r * 1.05, Color(0, 0, 0, 0.25))
		draw_circle(pos, r, Color(0.55, 0.42, 0.12))
		var seed_rng := RandomNumberGenerator.new()
		seed_rng.seed = hash(pos)
		var crumbs := int(6 + 18 * frac)
		for c in crumbs:
			var o := Vector2.from_angle(seed_rng.randf() * TAU) * seed_rng.randf() * r * 0.85
			var col := Color(0.95, 0.78, 0.3).lerp(Color(0.6, 0.75, 0.25), seed_rng.randf() * 0.5)
			draw_circle(pos + o, 1.5 + seed_rng.randf() * 1.8, col)


func _build_ground() -> void:
	var ground := ColorRect.new()
	ground.size = world_size
	ground.z_index = -10
	ground.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = GROUND_SHADER
	mat.set_shader_parameter("world_size", world_size)
	ground.material = mat
	add_child(ground)


func _build_pheromones() -> void:
	var f := sim.field
	var img := Image.create_empty(f.width, f.height, false, Image.FORMAT_RF)
	_home_tex = ImageTexture.create_from_image(img)
	_food_tex = ImageTexture.create_from_image(img)
	_pheromone_sprite = Sprite2D.new()
	_pheromone_sprite.texture = _home_tex  # Boyut icin; renk shader'dan gelir.
	_pheromone_sprite.centered = false
	_pheromone_sprite.scale = Vector2.ONE * f.cell_size
	_pheromone_sprite.z_index = -5
	_pheromone_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	var mat := ShaderMaterial.new()
	mat.shader = PHEROMONE_SHADER
	mat.set_shader_parameter("home_tex", _home_tex)
	mat.set_shader_parameter("food_tex", _food_tex)
	_pheromone_sprite.material = mat
	add_child(_pheromone_sprite)


func _upload_pheromones() -> void:
	var f := sim.field
	var fmt := Image.FORMAT_RF
	_home_tex.update(Image.create_from_data(f.width, f.height, false, fmt, f.home.to_byte_array()))
	_food_tex.update(Image.create_from_data(f.width, f.height, false, fmt, f.food.to_byte_array()))


func _build_nest() -> void:
	var size := Vector2.ONE * sim.nest_radius * 3.2
	var nest := ColorRect.new()
	nest.size = size
	nest.position = sim.nest_pos - size * 0.5
	nest.z_index = 0
	nest.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = NEST_SHADER
	nest.material = mat
	add_child(nest)


func _build_ants() -> void:
	var mesh := _make_ant_mesh()
	_shadows = _make_multimesh(mesh)
	_shadows.modulate = Color(0, 0, 0, 0.3)
	_shadows.position = Vector2(1.5, 2.0)
	_shadows.z_index = 1
	add_child(_shadows)
	_ants = _make_multimesh(mesh)
	_ants.z_index = 2
	add_child(_ants)


func _make_multimesh(mesh: Mesh) -> MultiMeshInstance2D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_2D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = ColonySim.MAX_ANTS
	mm.visible_instance_count = 0
	var node := MultiMeshInstance2D.new()
	node.multimesh = mm
	return node


func _update_ants() -> void:
	var n := sim.ant_count()
	var amm := _ants.multimesh
	var smm := _shadows.multimesh
	amm.visible_instance_count = n
	smm.visible_instance_count = n
	for i in n:
		var t := Transform2D(sim.headings[i], sim.positions[i])
		var c := COLOR_CARRY if sim.states[i] == ColonySim.State.RETURN else COLOR_SEARCH
		amm.set_instance_transform_2d(i, t)
		amm.set_instance_color(i, c)
		smm.set_instance_transform_2d(i, t)
		smm.set_instance_color(i, Color.WHITE)


## +X yonune bakan ~9px karinca: bas, gogus, karin + 6 bacak + 2 anten. Tek yuzey.
func _make_ant_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_add_ellipse(st, Vector2(3.4, 0), 1.3, 1.2)
	_add_ellipse(st, Vector2(1.0, 0), 1.3, 0.9)
	_add_ellipse(st, Vector2(-2.4, 0), 2.3, 1.6)
	for leg in [
		[Vector2(1.0, 0), Vector2(2.6, 3.0)],
		[Vector2(1.0, 0), Vector2(-0.4, 3.4)],
		[Vector2(0.6, 0), Vector2(-2.2, 2.8)],
		[Vector2(3.8, 0), Vector2(5.6, 1.8)]
	]:
		_add_line(st, leg[0], leg[1], 0.35)
		_add_line(st, Vector2(leg[0].x, -leg[0].y), Vector2(leg[1].x, -leg[1].y), 0.35)
	return st.commit()


func _add_ellipse(st: SurfaceTool, c: Vector2, rx: float, ry: float, seg := 10) -> void:
	for s in seg:
		var a0 := TAU * s / seg
		var a1 := TAU * (s + 1) / seg
		st.set_color(Color.WHITE)
		st.add_vertex(Vector3(c.x, c.y, 0))
		st.add_vertex(Vector3(c.x + cos(a0) * rx, c.y + sin(a0) * ry, 0))
		st.add_vertex(Vector3(c.x + cos(a1) * rx, c.y + sin(a1) * ry, 0))


func _add_line(st: SurfaceTool, a: Vector2, b: Vector2, w: float) -> void:
	var n := (b - a).orthogonal().normalized() * w
	st.set_color(Color.WHITE)
	for v in [a + n, b + n, b - n, a + n, b - n, a - n]:
		st.add_vertex(Vector3(v.x, v.y, 0))


func _build_particles() -> void:
	for i in PARTICLE_POOL:
		var p := CPUParticles2D.new()
		p.emitting = false
		p.one_shot = true
		p.amount = 10
		p.lifetime = 0.6
		p.explosiveness = 0.9
		p.spread = 180.0
		p.gravity = Vector2.ZERO
		p.initial_velocity_min = 12.0
		p.initial_velocity_max = 30.0
		p.damping_min = 20.0
		p.damping_max = 40.0
		p.scale_amount_min = 1.0
		p.scale_amount_max = 2.2
		var ramp := Gradient.new()
		ramp.set_color(0, Color(1, 1, 1, 1))
		ramp.set_color(1, Color(1, 1, 1, 0))
		p.color_ramp = ramp
		p.z_index = 3
		add_child(p)
		_particles.append(p)


func _spawn_effects() -> void:
	for e in sim.events:
		var col: Color
		match e["type"]:
			"pickup":
				col = Color(1.0, 0.8, 0.3)
			"birth":
				col = Color(0.6, 0.9, 1.0)
			_:
				continue  # Teslimat cok sik; efekt yalnizca yuva nabzinda.
		var p := _particles[_next_particle]
		_next_particle = (_next_particle + 1) % PARTICLE_POOL
		p.position = e["pos"]
		p.color = col
		p.restart()


func _build_lighting() -> void:
	_modulate = CanvasModulate.new()
	add_child(_modulate)
	_nest_light = PointLight2D.new()
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 1))
	grad.set_color(1, Color(1, 1, 1, 0))
	var tex := GradientTexture2D.new()
	tex.gradient = grad
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	tex.width = 256
	tex.height = 256
	_nest_light.texture = tex
	_nest_light.texture_scale = 2.4
	_nest_light.color = Color(1.0, 0.75, 0.45)
	_nest_light.position = sim.nest_pos
	add_child(_nest_light)


## Gun dongusu: ogle beyaz, gece mavi-mor; gece yuva isigi guclenir.
func _update_lighting() -> void:
	var sun := clampf(sin(day_time * TAU - PI * 0.5) * 0.5 + 0.5, 0.0, 1.0)
	var night := Color(0.28, 0.32, 0.55)
	var dusk := Color(1.0, 0.78, 0.6)
	var c := night.lerp(dusk, smoothstep(0.0, 0.35, sun)).lerp(
		Color.WHITE, smoothstep(0.35, 0.8, sun)
	)
	_modulate.color = c
	_nest_light.energy = lerpf(1.3, 0.15, sun)
