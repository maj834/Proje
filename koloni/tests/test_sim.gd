## Basliksiz duman testi: simulasyonu sabit tohumla calistirir ve temel davranisi dogrular.
## Calistirma: godot --headless --path koloni --script res://tests/test_sim.gd
extends SceneTree

const ColonySim := preload("res://scripts/colony_sim.gd")
const Progression := preload("res://scripts/progression.gd")
const Economy := preload("res://scripts/economy.gd")

var _failures := 0


func _init() -> void:
	_test_ants_collect_food()
	_test_deterministic()
	_test_pheromone_evaporates()
	_test_ants_stay_in_world()
	_test_progression()
	_test_economy()
	_test_hunger()
	_test_spider()
	_test_discover_event()
	print("BASARISIZ: %d" % _failures if _failures else "Tum testler gecti")
	quit(1 if _failures else 0)


func _check(cond: bool, msg: String) -> void:
	if cond:
		print("  ok   ", msg)
	else:
		_failures += 1
		printerr("  HATA ", msg)


func _run(seed: int, ants: int, seconds: float) -> ColonySim:
	var sim := ColonySim.new()
	sim.setup(seed, ants, Vector2(1280, 720))
	for i in int(seconds * 60.0):
		sim.step(1.0 / 60.0)
	return sim


func _test_ants_collect_food() -> void:
	var sim := _run(7, 200, 120.0)
	_check(sim.delivered_total > 0, "karincalar yuvaya yiyecek tasir (%d)" % sim.delivered_total)
	_check(sim.ant_count() > 200, "teslimatla koloni buyur (%d)" % sim.ant_count())


func _test_deterministic() -> void:
	var a := _run(3, 50, 10.0)
	var b := _run(3, 50, 10.0)
	_check(a.positions == b.positions, "ayni tohum ayni sonuc")


func _test_pheromone_evaporates() -> void:
	var sim := ColonySim.new()
	sim.setup(1, 0, Vector2(320, 320))
	var p := Vector2(100, 100)
	sim.field.deposit(sim.field.Layer.FOOD, p, 1.0)
	for i in 600:
		sim.step(1.0 / 60.0)
	var v := sim.field.sample(sim.field.Layer.FOOD, p)
	_check(v > 0.0 and v < 0.5, "feromon zamanla buharlasir (%.3f)" % v)


func _test_ants_stay_in_world() -> void:
	var sim := _run(11, 100, 30.0)
	var rect := Rect2(Vector2.ZERO, sim.world_size)
	var inside := true
	for p in sim.positions:
		inside = inside and rect.has_point(p)
	_check(inside, "karincalar dunya sinirlarinda kalir")


func _test_progression() -> void:
	var sim := _run(7, 200, 60.0)
	var prog := Progression.new()
	var first: Dictionary = prog.current()
	_check(prog.progress(sim) > 0.0, "hedef ilerlemesi olculur (%.2f)" % prog.progress(sim))
	sim.stored_food = 10000
	var done := prog.check(sim)
	_check(done == first, "hedef tamamlaninca dondurulur")
	_check(prog.check(sim).is_empty(), "yumurta alinmadan ikinci bolum bitmez")


func _test_economy() -> void:
	var sim := ColonySim.new()
	sim.setup(2, 100, Vector2(640, 480))
	var eco := Economy.new()
	_check(not eco.buy(0, sim), "kiler bosken alim yapilamaz")
	sim.stored_food = 500
	var cost0 := eco.cost(0)
	_check(eco.buy(0, sim) and sim.ant_count() == 115, "yumurta 15 isci ekler")
	_check(eco.cost(0) > cost0 and sim.stored_food == 500 - cost0, "fiyat artar, kilerden duser")
	_check(eco.buy(1, sim) and sim.soldier_count() == 3, "asker alimi 3 asker ekler")


func _test_hunger() -> void:
	var sim := ColonySim.new()
	sim.setup(3, 300, Vector2(640, 480))
	sim.foods.clear()
	sim.stored_food = 0
	for i in 60 * 30:
		sim.step(1.0 / 60.0)
	_check(sim.ant_count() < 300, "kiler bosken karincalar acliktan olur (%d)" % sim.ant_count())


func _test_spider() -> void:
	var sim := ColonySim.new()
	sim.setup(4, 300, Vector2(800, 600))
	sim.hunger_enabled = false
	sim.spawn_spider()
	for i in 60 * 40:
		sim.step(1.0 / 60.0)
	_check(sim.ants_lost > 0, "orumcek karinca avlar (%d)" % sim.ants_lost)
	var sim2 := ColonySim.new()
	sim2.setup(4, 50, Vector2(800, 600))
	sim2.hunger_enabled = false
	for i in 40:
		sim2.spawn_ant(ColonySim.Role.SOLDIER)
	sim2.spawn_spider()
	for i in 60 * 60:
		sim2.step(1.0 / 60.0)
		if sim2.spider.is_empty():
			break
	_check(sim2.spiders_killed == 1, "askerler orumcegi oldurur")
	_check(sim2.stored_food >= ColonySim.SPIDER_BOUNTY, "orumcek odulu kilere eklenir")


func _test_discover_event() -> void:
	var sim := ColonySim.new()
	sim.setup(5, 200, Vector2(1280, 720))
	var found := false
	for i in 60 * 90:
		sim.step(1.0 / 60.0)
		for e in sim.events:
			found = found or e["type"] == "discover"
		if found:
			break
	_check(found, "ilk alimda 'discover' olayi uretilir")
