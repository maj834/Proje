## Ust bilgi cubugu: koloni sayilari, hiz, FPS ve kontrol ipuclari.
extends CanvasLayer

@export var world_path: NodePath

@onready var _world: Node2D = get_node(world_path)
@onready var _label: Label = $Panel/Label


func _process(_delta: float) -> void:
	var sim = _world.sim
	var state := "DURAKLATILDI" if _world.paused else "x%d" % _world.time_scale
	_label.text = (
		"Karinca %d   Depo %d   Kaynak %d   %s   %d FPS\n%s"
		% [
			sim.ant_count(),
			sim.stored_food,
			sim.foods.size(),
			state,
			Engine.get_frames_per_second(),
			"Sol tik: yiyecek birak   P: feromon   Bosluk: duraklat   Q/E: hiz   WASD/sag tik: kamera",
		]
	)
