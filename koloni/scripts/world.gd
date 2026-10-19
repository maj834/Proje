## Ana dunya: simulasyonu ilerletir, gorsel katmanlari kurar, olaylari efekt/ses/arayuze cevirir.
## Cizim butcesi (GDD §7): zemin, feromon, kanopi = 3 tam ekran gecis; karinca+golge 2 MultiMesh;
## dekor bir kez cizilir; parcaciklar CPU havuzlu; tek isik.
extends Node2D

signal toast(title: String, body: String, color: Color)
signal phase_changed(phase: int)

enum Phase { TITLE, PLAYING, WON, LOST }

const ColonySim := preload("res://scripts/colony_sim.gd")
const Progression := preload("res://scripts/progression.gd")
const Economy := preload("res://scripts/economy.gd")
const SpiderView := preload("res://scripts/spider_view.gd")
const AntSwarm := preload("res://scripts/ant_swarm.gd")
const Decor := preload("res://scripts/decor.gd")
const FoodLayer := preload("res://scripts/food_layer.gd")
const Fx := preload("res://scripts/fx.gd")
const GameAudio := preload("res://scripts/audio.gd")
const GROUND_SHADER := preload("res://shaders/ground.gdshader")
const PHEROMONE_SHADER := preload("res://shaders/pheromone.gdshader")
const NEST_SHADER := preload("res://shaders/nest.gdshader")
const CANOPY_SHADER := preload("res://shaders/canopy.gdshader")

const GOLD := Color(1.0, 0.71, 0.23)
const BLUE := Color(0.62, 0.91, 1.0)
const DAY_LENGTH := 180.0
const BRUSH_STRENGTH := 2.5
const RED := Color(0.85, 0.22, 0.18)
const LOSE_BELOW := 40

@export var world_size := Vector2(1920, 1080)
@export var start_ants := 300
@export var sim_seed := 1
@export var camera_path: NodePath

var sim: ColonySim
var progression := Progression.new()
var economy := Economy.new()
var phase := Phase.TITLE
var play_time := 0.0
## Rehber adimlari icin: oyuncu bunlari yapti mi
var did_drop := false
var did_buy := false
var did_paint := false
var paused := false
var time_scale := 1
var show_pheromones := true
var day_time := 0.3  # 0..1; 0.5 ogle, 0 gece yarisi
var day_count := 1
var night := 0.0
var food_per_minute := 0.0

var _swarm: AntSwarm
var _fx: Fx
var _audio: GameAudio
var _foods: FoodLayer
var _camera: Camera2D
var _pheromone_sprite: Sprite2D
var _pheromone_mat: ShaderMaterial
var _canopy_mat: ShaderMaterial
var _nest_mat: ShaderMaterial
var _home_tex: ImageTexture
var _food_tex: ImageTexture
var _tex_timer := 0.0
var _modulate: CanvasModulate
var _nest_light: PointLight2D
var _nest_pulse := 0.0
var _delivered_bucket := 0
var _bucket_timer := 0.0
var _rate_history := PackedInt32Array()
var _milestone_timer := 0.0
var _painting := false
var _spider_spawned_tonight := false
var _was_night := false
var _starve_warned := 0.0


func _ready() -> void:
	sim = ColonySim.new()
	sim.setup(sim_seed, start_ants, world_size)
	sim.hunger_enabled = false
	if not camera_path.is_empty():
		_camera = get_node(camera_path)
	_build_ground()
	var decor := Decor.new()
	decor.world_size = world_size
	decor.nest_pos = sim.nest_pos
	decor.z_index = -8
	add_child(decor)
	_build_pheromones()
	_foods = FoodLayer.new()
	_foods.sim = sim
	add_child(_foods)
	_build_nest()
	var spider := SpiderView.new()
	spider.sim = sim
	spider.z_index = 2
	add_child(spider)
	_swarm = AntSwarm.new()
	_swarm.setup(sim)
	add_child(_swarm)
	_fx = Fx.new()
	_fx.world_size = world_size
	add_child(_fx)
	_build_canopy()
	_build_lighting()
	_audio = GameAudio.new()
	add_child(_audio)
	_rate_history.resize(60)
	_rate_history.fill(0)


func _process(delta: float) -> void:
	if not paused:
		var dt := minf(delta, 1.0 / 30.0)  # Takilmada sicrama yapmasin.
		for i in time_scale:
			_paint_brush(dt)
			sim.step(dt)
			_handle_events()
		_advance_day(delta * time_scale)
		_tick_stats(delta * time_scale)
		if phase == Phase.PLAYING:
			play_time += delta * time_scale
			_update_threats()
			_check_end()
	_swarm.refresh()
	_update_lighting(delta)
	_tex_timer -= delta
	if _tex_timer <= 0.0 and show_pheromones:
		_tex_timer = 0.1
		_upload_pheromones()


func _unhandled_input(event: InputEvent) -> void:
	if phase == Phase.TITLE:
		if (event is InputEventMouseButton or event is InputEventKey) and event.pressed:
			start_game()
			get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_R and phase != Phase.PLAYING:
			get_tree().reload_current_scene()
			return
		if event.keycode >= KEY_1 and event.keycode <= KEY_4:
			buy(event.keycode - KEY_1)
			return
	if event.is_action_pressed("toggle_pause"):
		paused = not paused
	elif event.is_action_pressed("toggle_pheromones"):
		show_pheromones = not show_pheromones
		_pheromone_sprite.visible = show_pheromones
	elif event.is_action_pressed("speed_up"):
		time_scale = mini(time_scale * 2, 8)
	elif event.is_action_pressed("speed_down"):
		time_scale = maxi(time_scale / 2, 1)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed and event.shift_pressed:
			_painting = true
		elif event.pressed:
			drop_food(get_global_mouse_position())
		else:
			_painting = false


func start_game() -> void:
	if phase != Phase.TITLE:
		return
	phase = Phase.PLAYING
	sim.hunger_enabled = true
	phase_changed.emit(phase)


## Kilerden harcama (HUD dugmeleri ve 1-4 tuslari).
func buy(i: int) -> void:
	if phase != Phase.PLAYING or i < 0 or i >= Economy.ITEMS.size():
		return
	if not economy.buy(i, sim):
		_audio.play("pickup")
		return
	did_buy = true
	var id: String = Economy.ITEMS[i]["id"]
	if id == "eggs":
		progression.eggs_bought += 1
		_fx.ring(sim.nest_pos, Color(BLUE, 0.9), 70.0, 0.6, 3.0)
		_fx.burst(sim.nest_pos, BLUE, 16)
	elif id == "soldiers":
		_fx.ring(sim.nest_pos, Color(RED, 0.9), 70.0, 0.6, 3.0)
		_fx.burst(sim.nest_pos, RED, 16)
	else:
		_fx.ring(sim.nest_pos, Color(GOLD, 0.9), 90.0, 0.7, 3.0)
	_audio.play("buy")


func drop_food(p: Vector2) -> void:
	if not Rect2(Vector2.ZERO, world_size).has_point(p):
		return
	if phase != Phase.PLAYING:
		return
	did_drop = true
	sim.add_food(p, 50)
	_fx.ring(p, Color(GOLD, 0.9), 34.0, 0.45)
	_fx.burst(p, GOLD, 14)
	_audio.play("drop")
	if _camera and _camera.has_method("kick"):
		_camera.kick(0.015)


func _paint_brush(dt: float) -> void:
	var held := _painting or Input.is_key_pressed(KEY_F)
	_fx.brush_visible = held or Input.is_key_pressed(KEY_SHIFT)
	_fx.brush_pos = get_global_mouse_position()
	if not held or phase != Phase.PLAYING:
		return
	did_paint = true
	var c := _fx.brush_pos
	var r := _fx.brush_radius
	for o in [Vector2.ZERO, Vector2(r, 0), Vector2(-r, 0), Vector2(0, r), Vector2(0, -r)]:
		sim.field.deposit(sim.field.Layer.FOOD, c + o * 0.6, BRUSH_STRENGTH * dt)


func _handle_events() -> void:
	for e in sim.events:
		match e["type"]:
			"pickup":
				_fx.burst(e["pos"], GOLD, 6)
				_audio.play("pickup")
			"deliver":
				_delivered_bucket += 1
				_nest_pulse = minf(1.0, _nest_pulse + 0.08)
			"birth":
				_fx.ring(sim.nest_pos, Color(BLUE, 0.8), sim.nest_radius * 2.2, 0.6)
				_fx.burst(sim.nest_pos, BLUE, 12)
				_audio.play("birth")
				_nest_pulse = 1.0
			"discover":
				_fx.ring(e["pos"], Color(GOLD, 1.0), 60.0, 0.8, 3.0)
				_audio.play("discover")
			"bite":
				_fx.burst(e["pos"], RED, 8)
				_audio.play("bite")
			"starve":
				_fx.burst(e["pos"], Color(0.6, 0.6, 0.6), 4)
				if phase == Phase.PLAYING and play_time - _starve_warned > 20.0:
					_starve_warned = play_time
					_audio.play("warn")
					toast.emit("Kiler boş", "Karıncalar açlıktan ölüyor. Yiyecek bırak.", RED)
			"spider_dead":
				_fx.ring(e["pos"], Color(1, 0.9, 0.6), 120.0, 1.0, 4.0)
				_fx.burst(e["pos"], GOLD, 24)
				_fx.float_text(e["pos"], "+%d" % ColonySim.SPIDER_BOUNTY, GOLD)
				_audio.play("milestone")
				if _camera and _camera.has_method("kick"):
					_camera.kick(0.05)


func _tick_stats(dt: float) -> void:
	_bucket_timer += dt
	if _bucket_timer >= 1.0:
		_bucket_timer -= 1.0
		if _delivered_bucket > 0:
			_fx.float_text(sim.nest_pos + Vector2(0, -34), "+%d" % _delivered_bucket, GOLD)
		_rate_history.remove_at(0)
		_rate_history.append(_delivered_bucket)
		_delivered_bucket = 0
		var total := 0
		for v in _rate_history:
			total += v
		food_per_minute = float(total)
	_milestone_timer += dt
	if _milestone_timer >= 0.25 and phase == Phase.PLAYING:
		_milestone_timer = 0.0
		var done := progression.check(sim)
		if not done.is_empty():
			_audio.play("milestone")
			_fx.ring(sim.nest_pos, Color(1, 0.9, 0.6, 1), 140.0, 1.0, 4.0)
			if _camera and _camera.has_method("kick"):
				_camera.kick(0.04)
			toast.emit(done["title"], done["done"], Color(1, 0.9, 0.6))


## Orumcek: "Orumcek" bolumune gelindiginde ve sonrasinda her gece bir kez gelir; safakta cekilir.
func _update_threats() -> void:
	var is_night := night > 0.5
	if is_night and not _was_night:
		_spider_spawned_tonight = false
	var spider_time := progression.index >= 3
	if is_night and spider_time and not _spider_spawned_tonight and sim.spider.is_empty():
		_spider_spawned_tonight = true
		sim.spawn_spider()
		_audio.play("warn")
		toast.emit("Örümcek geliyor", "Ağaç kökünden bir gölge indi.", RED)
	if not is_night and _was_night and not sim.spider.is_empty():
		sim.spider["leaving"] = true
		toast.emit("Şafak", "Örümcek gün ışığında çekildi.", GOLD)
	_was_night = is_night


func _check_end() -> void:
	if sim.ant_count() < LOSE_BELOW:
		phase = Phase.LOST
		_audio.play("warn")
		phase_changed.emit(phase)
	elif progression.finished():
		phase = Phase.WON
		phase_changed.emit(phase)


func _advance_day(dt: float) -> void:
	day_time += dt / DAY_LENGTH
	if day_time >= 1.0:
		day_time -= 1.0
		day_count += 1


func _build_ground() -> void:
	var ground := ColorRect.new()
	ground.size = world_size
	ground.z_index = -10
	ground.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = GROUND_SHADER
	mat.set_shader_parameter("world_size", world_size)
	mat.set_shader_parameter("nest_pos", sim.nest_pos)
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
	_pheromone_mat = ShaderMaterial.new()
	_pheromone_mat.shader = PHEROMONE_SHADER
	_pheromone_mat.set_shader_parameter("home_tex", _home_tex)
	_pheromone_mat.set_shader_parameter("food_tex", _food_tex)
	_pheromone_sprite.material = _pheromone_mat
	add_child(_pheromone_sprite)


func _upload_pheromones() -> void:
	var f := sim.field
	var fmt := Image.FORMAT_RF
	_home_tex.update(Image.create_from_data(f.width, f.height, false, fmt, f.home.to_byte_array()))
	_food_tex.update(Image.create_from_data(f.width, f.height, false, fmt, f.food.to_byte_array()))


func _build_nest() -> void:
	var size := Vector2.ONE * sim.nest_radius * 4.0
	var nest := ColorRect.new()
	nest.size = size
	nest.position = sim.nest_pos - size * 0.5
	nest.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_nest_mat = ShaderMaterial.new()
	_nest_mat.shader = NEST_SHADER
	nest.material = _nest_mat
	add_child(nest)


func _build_canopy() -> void:
	var canopy := ColorRect.new()
	canopy.size = world_size
	canopy.z_index = 5
	canopy.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canopy_mat = ShaderMaterial.new()
	_canopy_mat.shader = CANOPY_SHADER
	_canopy_mat.set_shader_parameter("world_size", world_size)
	canopy.material = _canopy_mat
	add_child(canopy)


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
	_nest_light.texture_scale = 2.6
	_nest_light.color = Color(1.0, 0.72, 0.42)
	_nest_light.position = sim.nest_pos
	add_child(_nest_light)


## Gun dongusu: ogle beyaz, gun batimi sicak, gece mavi-mor; gece yuva isigi ve izler parlar.
func _update_lighting(delta: float) -> void:
	var sun := clampf(sin(day_time * TAU - PI * 0.5) * 0.5 + 0.5, 0.0, 1.0)
	night = 1.0 - smoothstep(0.1, 0.45, sun)
	var night_col := Color(0.23, 0.28, 0.47)
	var dusk := Color(1.0, 0.77, 0.6)
	var c := night_col.lerp(dusk, smoothstep(0.0, 0.35, sun)).lerp(
		Color.WHITE, smoothstep(0.35, 0.8, sun)
	)
	_modulate.color = c
	_nest_pulse = lerpf(_nest_pulse, 0.0, 1.0 - exp(-3.0 * delta))
	_nest_light.energy = lerpf(0.2, 1.4, night) + _nest_pulse * 0.4
	_nest_mat.set_shader_parameter("pulse", _nest_pulse)
	_canopy_mat.set_shader_parameter("night", night)
	_pheromone_mat.set_shader_parameter("night", night)
	_fx.set_night(night)
	_audio.set_night(night)
