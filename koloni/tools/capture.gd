## Ekran goruntusu alir: ana sahneyi yukler, simulasyonu ileri sarar, PNG kaydeder.
## Calistirma (ekran gerekir; bulutta xvfb-run ile):
##   godot --path koloni --rendering-driver opengl3 --script res://tools/capture.gd -- out.png [gun]
## gun: 0..1 gunun saati (varsayilan 0.42; 0.05 gece).
extends SceneTree

const WARMUP_STEPS := 2400  # ~40 sn simulasyon: izler olussun.

var _frames := 0
var _out := "capture.png"
var _day := 0.42
var _spider := false


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		_out = args[0]
	if args.size() > 1:
		_day = float(args[1])
	_spider = args.size() > 2 and args[2] == "orumcek"
	var main: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)


func _warm_up() -> void:
	var world := root.get_node("Main/World")
	for i in WARMUP_STEPS:
		world.sim.step(1.0 / 60.0)
		world._handle_events()
	world.day_time = _day
	var cam := root.get_node("Main/Camera")
	cam.target_zoom = 1.05
	cam.zoom = Vector2.ONE * cam.target_zoom
	# Yuva ile en yakin yiyecek arasini kadrajla.
	var best: Vector2 = world.sim.foods[0]["pos"]
	for f in world.sim.foods:
		if f["pos"].distance_to(world.sim.nest_pos) < best.distance_to(world.sim.nest_pos):
			best = f["pos"]
	cam.position = (world.sim.nest_pos + best) * 0.5
	if _spider:
		for k in 8:
			world.sim.spawn_ant(world.sim.Role.SOLDIER)
		world.sim.spawn_spider()
		world.sim.spider["pos"] = cam.position + Vector2(140, -40)
		world.sim.spider["hp"] = 34.0
		for k in 90:
			world.sim.step(1.0 / 60.0)
	cam.target_pos = cam.position
	root.get_node("Main/HUD").skip_intro()


func _process(_delta: float) -> bool:
	_frames += 1
	if _frames == 2:
		_warm_up()
	elif _frames == 40:
		var img := root.get_viewport().get_texture().get_image()
		img.save_png(_out)
		print("Kaydedildi: ", _out)
		return true
	return false
