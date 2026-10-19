## Ekran goruntusu alir: ana sahneyi yukler, simulasyonu ileri sarar, PNG kaydeder.
## Calistirma (ekran gerekir; bulutta xvfb-run ile):
##   godot --path koloni --rendering-driver opengl3 --script res://tools/capture.gd -- out.png
extends SceneTree

const WARMUP_STEPS := 2400  # ~40 sn simulasyon: izler olussun.

var _frames := 0
var _out := "capture.png"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		_out = args[0]
	var main: Node = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)


func _warm_up() -> void:
	var world := root.get_node("Main/World")
	for i in WARMUP_STEPS:
		world.sim.step(1.0 / 60.0)
	world.day_time = 0.42
	world.queue_redraw()


func _process(_delta: float) -> bool:
	_frames += 1
	if _frames == 2:
		_warm_up()
	elif _frames == 12:
		var img := root.get_viewport().get_texture().get_image()
		img.save_png(_out)
		print("Kaydedildi: ", _out)
		return true
	return false
