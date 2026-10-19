## Kiler harcamalari: her alim o kalemin fiyatini "growth" oraninda artirir.
## Saf veri; world.gd cagirir.
extends RefCounted

const ITEMS := [
	{"id": "eggs", "name": "Yumurta", "info": "+15 işçi", "cost": 30, "max": 99, "growth": 1.1},
	{"id": "soldiers", "name": "Asker", "info": "+3 asker", "cost": 45, "max": 99, "growth": 1.2},
	{
		"id": "smell",
		"name": "Keskin koku",
		"info": "daha uzağı sezerler",
		"cost": 70,
		"max": 3,
		"growth": 1.6
	},
	{
		"id": "legs",
		"name": "Uzun bacak",
		"info": "%10 daha hızlı",
		"cost": 90,
		"max": 3,
		"growth": 1.6
	},
]

var bought := {}


func cost(i: int) -> int:
	var n: int = bought.get(ITEMS[i]["id"], 0)
	return int(round(ITEMS[i]["cost"] * pow(ITEMS[i]["growth"], n)))


func maxed(i: int) -> bool:
	return bought.get(ITEMS[i]["id"], 0) >= ITEMS[i]["max"]


func can_buy(i: int, sim) -> bool:
	return not maxed(i) and sim.stored_food >= cost(i)


## Alimi uygular; basariliysa true.
func buy(i: int, sim) -> bool:
	if not can_buy(i, sim):
		return false
	sim.stored_food -= cost(i)
	var id: String = ITEMS[i]["id"]
	bought[id] = bought.get(id, 0) + 1
	match id:
		"eggs":
			for k in 15:
				sim.spawn_ant()
		"soldiers":
			for k in 3:
				sim.spawn_ant(sim.Role.SOLDIER)
		"smell":
			sim.sense_distance += 3.0
			sim.food_sense_radius += 14.0
		"legs":
			sim.speed *= 1.1
	return true
