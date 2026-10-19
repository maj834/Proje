## Kilometre taslari: oyuncuya hep bir sonraki hedefi gosterir, tamamlaninca odul verir.
## Saf veri; world.gd odulleri simulasyona uygular.
extends RefCounted

const MILESTONES := [
	{"kind": "stored", "target": 50, "title": "Ilk Kiler", "reward": "sense"},
	{"kind": "ants", "target": 400, "title": "Buyuyen Yuva", "reward": "speed"},
	{"kind": "sources", "target": 6, "title": "Kasifler", "reward": "ants"},
	{"kind": "stored", "target": 400, "title": "Dolu Ambar", "reward": "trail"},
	{"kind": "ants", "target": 600, "title": "Kalabalik Koloni", "reward": "speed"},
	{"kind": "stored", "target": 1200, "title": "Bereket", "reward": "ants"},
	{"kind": "ants", "target": 900, "title": "Karinca Imparatorlugu", "reward": "sense"},
	{"kind": "stored", "target": 3000, "title": "Efsanevi Koloni", "reward": "trail"},
]
const REWARD_TEXT := {
	"sense": "Karincalar daha uzagi seziyor",
	"speed": "Karincalar %12 daha hizli",
	"ants": "Kralice 30 yeni isci dogurdu",
	"trail": "Izler daha uzun kaliyor",
}
const KIND_TEXT := {
	"stored": "yiyecek depola", "ants": "karincaya ulas", "sources": "kaynak kesfet"
}

var index := 0
var sources_found := 0


func current() -> Dictionary:
	return MILESTONES[index] if index < MILESTONES.size() else {}


func value_for(m: Dictionary, sim) -> int:
	match m.get("kind", ""):
		"stored":
			return sim.stored_food
		"ants":
			return sim.ant_count()
		"sources":
			return sources_found
	return 0


func progress(sim) -> float:
	var m := current()
	if m.is_empty():
		return 1.0
	return clampf(float(value_for(m, sim)) / float(m["target"]), 0.0, 1.0)


func goal_text(sim) -> String:
	var m := current()
	if m.is_empty():
		return "Tum hedefler tamam!"
	return "%s: %d / %d %s" % [m["title"], value_for(m, sim), m["target"], KIND_TEXT[m["kind"]]]


## Tamamlanan kilometre tasini dondurur (yoksa bos sozluk) ve bir sonrakine gecer.
func check(sim) -> Dictionary:
	var m := current()
	if m.is_empty() or value_for(m, sim) < m["target"]:
		return {}
	index += 1
	return m


static func apply_reward(reward: String, sim) -> void:
	match reward:
		"sense":
			sim.sense_distance += 3.0
			sim.food_sense_radius += 12.0
		"speed":
			sim.speed *= 1.12
		"ants":
			for i in 30:
				sim.spawn_ant()
		"trail":
			sim.evaporation_per_second *= 0.8
