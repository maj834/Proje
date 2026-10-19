## Koloni simulasyonu: karincalar (isci/asker), feromon izleri, yiyecek, aclik, orumcek tehdidi.
## Rendering'den bagimsiz ve tohumla deterministik; testler dogrudan bunu calistirir.
extends RefCounted

enum State { SEARCH, RETURN }
enum Role { WORKER, SOLDIER }

const PheromoneField := preload("res://scripts/pheromone_field.gd")

const MAX_ANTS := 1200
const ANTS_PER_FOOD := 0.1  # Kralice her 10 yiyecekte bir isci dogurur.
const EVAPORATE_INTERVAL := 0.1
const EAT_PER_ANT := 0.0012  # Karinca basina saniyede yenen yiyecek.
const SOLDIER_EAT := 3.0  # Asker iscinin kac kati yer.
const SPIDER_HP := 60.0
const SPIDER_SPEED := 44.0
const SPIDER_BITE_COOLDOWN := 1.1
const SPIDER_BOUNTY := 40

var world_size: Vector2
var nest_pos: Vector2
var nest_radius := 26.0

var speed := 62.0
var sense_distance := 16.0
var sense_angle := 0.55
var turn_rate := 4.0
var wander := 3.0
var deposit_rate := 1.6
var trail_decay := 0.35  # Saniyede iz gucu kaybi orani.
var evaporation_per_second := 0.12
var food_sense_radius := 40.0
var nest_sense_radius := 70.0
var patrol_radius := 140.0
var hunger_enabled := true

var positions := PackedVector2Array()
var headings := PackedFloat32Array()
var states := PackedByteArray()
var roles := PackedByteArray()
var trail_strength := PackedFloat32Array()

## Her biri: { "pos", "radius", "amount", "max", "kind", "found" }
var foods: Array[Dictionary] = []
## Bos ya da { "pos", "heading", "hp", "bite", "leaving" }
var spider: Dictionary = {}
var stored_food := 0
var delivered_total := 0
var ants_lost := 0
var spiders_killed := 0
var field: PheromoneField
var rng := RandomNumberGenerator.new()

## Son adimdaki olaylar: pickup, deliver, birth, discover, bite, spider_dead, spider_gone, starve
var events: Array[Dictionary] = []
var foods_changed := false

var _evaporate_timer := 0.0
var _birth_progress := 0.0
var _hunger := 0.0


func setup(p_seed: int, ant_count: int, p_world_size: Vector2, cell_size := 8.0) -> void:
	rng.seed = p_seed
	world_size = p_world_size
	nest_pos = world_size * 0.5
	field = PheromoneField.new(world_size, cell_size)
	positions.clear()
	headings.clear()
	states.clear()
	roles.clear()
	trail_strength.clear()
	for i in ant_count:
		spawn_ant()
	foods.clear()
	for i in 6:
		spawn_random_food()


func ant_count() -> int:
	return positions.size()


func soldier_count() -> int:
	return roles.count(Role.SOLDIER)


## Saniyedeki yiyecek tuketimi (arayuz icin).
func eat_rate() -> float:
	var workers := ant_count() - soldier_count()
	return (workers + soldier_count() * SOLDIER_EAT) * EAT_PER_ANT


## kind: 0 tohum, 1 meyve, 2 yaprak kirintisi (yalnizca gorunus).
func add_food(pos: Vector2, amount: int, kind := -1) -> void:
	var radius := 8.0 + sqrt(float(amount)) * 1.2
	if kind < 0:
		kind = rng.randi_range(0, 2)
	var f := {"pos": pos, "radius": radius, "amount": amount, "max": amount}
	f["kind"] = kind
	f["found"] = false
	foods.append(f)
	foods_changed = true


func spawn_random_food() -> void:
	# Yuvadan makul uzaklikta, kenara yapismayan rastgele bir nokta.
	var margin := 60.0
	for attempt in 20:
		var p := Vector2(
			rng.randf_range(margin, world_size.x - margin),
			rng.randf_range(margin, world_size.y - margin)
		)
		if p.distance_to(nest_pos) > 170.0:
			add_food(p, rng.randi_range(90, 220))
			return


func spawn_ant(role := Role.WORKER) -> void:
	if positions.size() >= MAX_ANTS:
		return
	var a := rng.randf() * TAU
	positions.append(nest_pos + Vector2.from_angle(a) * rng.randf() * nest_radius * 0.6)
	headings.append(a)
	states.append(State.SEARCH)
	roles.append(role)
	trail_strength.append(1.0)


## Orumcek dunya kenarinda, yuvadan en uzak tarafta belirir.
func spawn_spider() -> void:
	var side := rng.randi_range(0, 3)
	var p := Vector2(rng.randf() * world_size.x, rng.randf() * world_size.y)
	match side:
		0:
			p.x = 10.0
		1:
			p.x = world_size.x - 10.0
		2:
			p.y = 10.0
		_:
			p.y = world_size.y - 10.0
	spider = {"pos": p, "heading": (nest_pos - p).angle(), "hp": SPIDER_HP, "bite": 0.0}
	spider["leaving"] = false


func step(dt: float) -> void:
	events.clear()
	foods_changed = false
	var i := 0
	while i < positions.size():
		if roles[i] == Role.SOLDIER:
			_step_soldier(i, dt)
		else:
			_step_ant(i, dt)
		i += 1
	if not spider.is_empty():
		_step_spider(dt)
	if hunger_enabled:
		_eat(dt)
	_evaporate_timer += dt
	while _evaporate_timer >= EVAPORATE_INTERVAL:
		_evaporate_timer -= EVAPORATE_INTERVAL
		field.evaporate(pow(1.0 - evaporation_per_second, EVAPORATE_INTERVAL))
	_update_foods()


func remove_ant(i: int) -> void:
	var last := positions.size() - 1
	positions[i] = positions[last]
	headings[i] = headings[last]
	states[i] = states[last]
	roles[i] = roles[last]
	trail_strength[i] = trail_strength[last]
	positions.resize(last)
	headings.resize(last)
	states.resize(last)
	roles.resize(last)
	trail_strength.resize(last)
	ants_lost += 1


func _eat(dt: float) -> void:
	_hunger += eat_rate() * dt
	while _hunger >= 1.0:
		_hunger -= 1.0
		if stored_food > 0:
			stored_food -= 1
		elif ant_count() > 0:
			# Kiler bos: bir karinca acliktan olur.
			var idx := rng.randi_range(0, ant_count() - 1)
			events.append({"type": "starve", "pos": positions[idx]})
			remove_ant(idx)


func _step_ant(i: int, dt: float) -> void:
	var p := positions[i]
	var h := headings[i]
	var state := states[i]
	var follow := PheromoneField.Layer.FOOD if state == State.SEARCH else PheromoneField.Layer.HOME
	var lay := PheromoneField.Layer.HOME if state == State.SEARCH else PheromoneField.Layer.FOOD

	var steer := 0.0
	var target := _visible_target(p, state)
	if target != Vector2.INF:
		steer = clampf(angle_difference(h, (target - p).angle()) * 3.0, -1.0, 1.0)
	else:
		var l := field.sample(follow, p + Vector2.from_angle(h - sense_angle) * sense_distance)
		var c := field.sample(follow, p + Vector2.from_angle(h) * sense_distance)
		var r := field.sample(follow, p + Vector2.from_angle(h + sense_angle) * sense_distance)
		if c >= l and c >= r:
			steer = 0.0
		elif l > r:
			steer = -1.0
		else:
			steer = 1.0
	h += steer * turn_rate * dt + rng.randf_range(-1.0, 1.0) * wander * dt
	var moved := _move(p, h, speed * dt)
	p = moved[0]
	h = moved[1]

	field.deposit(lay, p, trail_strength[i] * deposit_rate * dt)
	trail_strength[i] = maxf(0.05, trail_strength[i] - trail_decay * dt)

	if state == State.SEARCH:
		var fi := _food_at(p)
		if fi >= 0:
			if not foods[fi]["found"]:
				foods[fi]["found"] = true
				events.append({"type": "discover", "pos": foods[fi]["pos"]})
			foods[fi]["amount"] -= 1
			foods_changed = true
			states[i] = State.RETURN
			h += PI
			trail_strength[i] = 1.0
			events.append({"type": "pickup", "pos": p})
	elif p.distance_squared_to(nest_pos) < nest_radius * nest_radius:
		stored_food += 1
		delivered_total += 1
		states[i] = State.SEARCH
		h += PI
		trail_strength[i] = 1.0
		events.append({"type": "deliver", "pos": p})
		_birth_progress += ANTS_PER_FOOD
		if _birth_progress >= 1.0:
			_birth_progress -= 1.0
			spawn_ant()
			events.append({"type": "birth", "pos": nest_pos})

	positions[i] = p
	headings[i] = wrapf(h, -PI, PI)


## Asker: yuva cevresinde devriye gezer; orumcek varsa ona kosar ve isirir.
func _step_soldier(i: int, dt: float) -> void:
	var p := positions[i]
	var h := headings[i]
	var target := Vector2.INF
	if not spider.is_empty() and not spider["leaving"]:
		target = spider["pos"]
	elif p.distance_to(nest_pos) > patrol_radius:
		target = nest_pos
	if target != Vector2.INF:
		h += clampf(angle_difference(h, (target - p).angle()) * 3.0, -1.0, 1.0) * turn_rate * dt
	h += rng.randf_range(-1.0, 1.0) * wander * dt
	var run := 1.25 if target != Vector2.INF and not spider.is_empty() else 0.7
	var moved := _move(p, h, speed * run * dt)
	positions[i] = moved[0]
	headings[i] = wrapf(moved[1], -PI, PI)
	if not spider.is_empty() and moved[0].distance_squared_to(spider["pos"]) < 24.0 * 24.0:
		spider["hp"] -= 4.0 * dt


func _step_spider(dt: float) -> void:
	var s := spider
	var p: Vector2 = s["pos"]
	var h: float = s["heading"]
	if s["hp"] <= 0.0:
		spiders_killed += 1
		stored_food += SPIDER_BOUNTY
		events.append({"type": "spider_dead", "pos": p})
		spider = {}
		return
	var target := nest_pos
	if s["leaving"]:
		target = p + (p - nest_pos).normalized() * 200.0
	else:
		# En yakin isciye yonel (orneklem: her adimda 40 karinca, ucuz).
		var best := 260.0 * 260.0
		var n := ant_count()
		for k in mini(40, n):
			var j := rng.randi_range(0, n - 1)
			var d := p.distance_squared_to(positions[j])
			if d < best:
				best = d
				target = positions[j]
	h += clampf(angle_difference(h, (target - p).angle()) * 2.0, -1.0, 1.0) * 2.2 * dt
	p += Vector2.from_angle(h) * SPIDER_SPEED * dt
	s["bite"] = maxf(0.0, s["bite"] - dt)
	if s["leaving"] and not Rect2(Vector2(-30, -30), world_size + Vector2(60, 60)).has_point(p):
		events.append({"type": "spider_gone", "pos": p})
		spider = {}
		return
	p = p.clamp(Vector2(-40, -40), world_size + Vector2(40, 40))
	s["pos"] = p
	s["heading"] = h
	if s["bite"] <= 0.0 and not s["leaving"]:
		for j in ant_count():
			if positions[j].distance_squared_to(p) < 20.0 * 20.0:
				events.append({"type": "bite", "pos": positions[j]})
				remove_ant(j)
				s["bite"] = SPIDER_BITE_COOLDOWN
				break


func _move(p: Vector2, h: float, dist: float) -> Array:
	p += Vector2.from_angle(h) * dist
	# Kenarda yansit.
	if p.x < 2.0 or p.x > world_size.x - 2.0:
		h = PI - h
		p.x = clampf(p.x, 2.0, world_size.x - 2.0)
	if p.y < 2.0 or p.y > world_size.y - 2.0:
		h = -h
		p.y = clampf(p.y, 2.0, world_size.y - 2.0)
	return [p, h]


## Gorus mesafesindeki hedef (yiyecek ya da yuva); yoksa Vector2.INF.
func _visible_target(p: Vector2, state: int) -> Vector2:
	if state == State.RETURN:
		if p.distance_squared_to(nest_pos) < nest_sense_radius * nest_sense_radius:
			return nest_pos
		return Vector2.INF
	for f in foods:
		var reach: float = f["radius"] + food_sense_radius
		if f["amount"] > 0 and p.distance_squared_to(f["pos"]) < reach * reach:
			return f["pos"]
	return Vector2.INF


func _food_at(p: Vector2) -> int:
	for fi in foods.size():
		var f := foods[fi]
		var r: float = f["radius"]
		if f["amount"] > 0 and p.distance_squared_to(f["pos"]) < r * r:
			return fi
	return -1


func _update_foods() -> void:
	for fi in range(foods.size() - 1, -1, -1):
		if foods[fi]["amount"] <= 0:
			foods.remove_at(fi)
			foods_changed = true
			spawn_random_food()
