## Koloni simulasyonu: karinca durumu, feromon izleri, yiyecek kaynaklari.
## Rendering'den bagimsiz ve tohumla deterministik; testler dogrudan bunu calistirir.
extends RefCounted

enum State { SEARCH, RETURN }

const PheromoneField := preload("res://scripts/pheromone_field.gd")

const MAX_ANTS := 1200
const ANTS_PER_FOOD := 0.2  # Yuvaya gelen her yiyecek 0.2 yeni karinca.
const EVAPORATE_INTERVAL := 0.1

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

var positions := PackedVector2Array()
var headings := PackedFloat32Array()
var states := PackedByteArray()
var trail_strength := PackedFloat32Array()

## Her biri: { "pos": Vector2, "radius": float, "amount": int, "max": int }
var foods: Array[Dictionary] = []
var stored_food := 0
var delivered_total := 0
var field: PheromoneField
var rng := RandomNumberGenerator.new()

## Son adimdaki olaylar (gorsel efekt icin): { "type": "pickup"|"deliver"|"birth", "pos": Vector2 }
var events: Array[Dictionary] = []
var foods_changed := false

var _evaporate_timer := 0.0
var _birth_progress := 0.0


func setup(p_seed: int, ant_count: int, p_world_size: Vector2, cell_size := 8.0) -> void:
	rng.seed = p_seed
	world_size = p_world_size
	nest_pos = world_size * 0.5
	field = PheromoneField.new(world_size, cell_size)
	positions.clear()
	headings.clear()
	states.clear()
	trail_strength.clear()
	for i in ant_count:
		spawn_ant()
	foods.clear()
	for i in 4:
		spawn_random_food()


func ant_count() -> int:
	return positions.size()


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
		if p.distance_to(nest_pos) > 220.0:
			add_food(p, rng.randi_range(80, 200))
			return


func step(dt: float) -> void:
	events.clear()
	foods_changed = false
	for i in positions.size():
		_step_ant(i, dt)
	_evaporate_timer += dt
	while _evaporate_timer >= EVAPORATE_INTERVAL:
		_evaporate_timer -= EVAPORATE_INTERVAL
		field.evaporate(pow(1.0 - evaporation_per_second, EVAPORATE_INTERVAL))
	_update_foods()


func spawn_ant() -> void:
	if positions.size() >= MAX_ANTS:
		return
	var a := rng.randf() * TAU
	positions.append(nest_pos + Vector2.from_angle(a) * rng.randf() * nest_radius * 0.6)
	headings.append(a)
	states.append(State.SEARCH)
	trail_strength.append(1.0)


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

	p += Vector2.from_angle(h) * speed * dt
	# Kenarda yansit.
	if p.x < 2.0 or p.x > world_size.x - 2.0:
		h = PI - h
		p.x = clampf(p.x, 2.0, world_size.x - 2.0)
	if p.y < 2.0 or p.y > world_size.y - 2.0:
		h = -h
		p.y = clampf(p.y, 2.0, world_size.y - 2.0)

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
