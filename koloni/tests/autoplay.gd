## Demo akisi testi: ana sahneyi basliksiz oynatir (bot: firsat buldukca alim yapar)
## ve demonun kazanilabilir oldugunu dogrular.
## Calistirma: godot --headless --path koloni --script res://tests/autoplay.gd
extends SceneTree

const MAX_FRAMES := 60 * 60 * 12  # 12 dakikalik oyun (x4 hizla 3 dk gercek kare)

var _frames := 0
var _world: Node2D
var _last_chapter := -1


func _initialize() -> void:
	root.add_child(load("res://scenes/main.tscn").instantiate())


func _process(_delta: float) -> bool:
	_frames += 1
	if _frames == 2:
		_world = root.get_node("Main/World")
		_world.start_game()
		_world.time_scale = 4
	if _frames < 3:
		return false
	var prog = _world.progression
	if prog.index != _last_chapter:
		_last_chapter = prog.index
		print(
			(
				"t=%4ds bolum %d  karinca %d  asker %d  depo %d"
				% [
					int(_world.play_time),
					prog.index,
					_world.sim.ant_count(),
					_world.sim.soldier_count(),
					_world.sim.stored_food
				]
			)
		)
	# Bot: once yumurta, sonra 2 asker alimi, sonra yumurta
	var want := 0 if _world.sim.soldier_count() >= 6 or prog.index < 2 else 1
	_world.buy(want)
	if _world.phase == _world.Phase.WON:
		print("DEMO KAZANILDI t=%ds" % int(_world.play_time))
		quit(0)
		return true
	if _world.phase == _world.Phase.LOST or _frames > MAX_FRAMES:
		printerr("DEMO KAZANILAMADI: faz %d t=%ds" % [_world.phase, int(_world.play_time)])
		quit(1)
		return true
	return false
