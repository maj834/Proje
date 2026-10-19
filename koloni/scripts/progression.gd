## Demo bolumleri: oyuncuya hep bir sonraki hedefi gosterir; son hedefle demo biter.
## Saf veri; world.gd kontrol eder ve odulleri uygular. Metinler oyuncuya gorunur (Turkce).
extends RefCounted

const CHAPTERS := [
	{
		"kind": "stored",
		"target": 40,
		"title": "İlk hasat",
		"story": "Kraliçe yeni yuvasını kazdı. Kilere biraz yiyecek lazım.",
		"done": "Kiler kokmaya başladı. İşçiler yolu ezberledi.",
	},
	{
		"kind": "eggs",
		"target": 1,
		"title": "Yuvayı büyüt",
		"story": "Depodaki yiyecekle kraliçeye yumurta bıraktır.",
		"done": "Kuluçka odası doldu. Yeni işçiler yolda.",
	},
	{
		"kind": "soldiers",
		"target": 6,
		"title": "Nöbetçiler",
		"story": "Geceleri ağaç kökünden bir şey iniyor. Asker yetiştir.",
		"done": "Yuvanın ağzında nöbet başladı.",
	},
	{
		"kind": "spider_kills",
		"target": 1,
		"title": "Örümcek",
		"story": "Gece çökünce örümcek gelecek. Askerlerin onu durdursun.",
		"done": "Örümcek düştü. Kilere 40 yiyecek taşındı.",
	},
	{
		"kind": "ants",
		"target": 500,
		"title": "Kışa hazırlık",
		"story": "İlk soğuklar yakın. Koloniyi 500 karıncaya çıkar.",
		"done": "Koloni kışa hazır.",
	},
]
const KIND_UNIT := {
	"stored": "yiyecek",
	"eggs": "yumurta",
	"soldiers": "asker",
	"spider_kills": "örümcek",
	"ants": "karınca",
}

var index := 0
var eggs_bought := 0


func finished() -> bool:
	return index >= CHAPTERS.size()


func current() -> Dictionary:
	return {} if finished() else CHAPTERS[index]


func value_for(m: Dictionary, sim) -> int:
	match m.get("kind", ""):
		"stored":
			return sim.stored_food
		"ants":
			return sim.ant_count()
		"soldiers":
			return sim.soldier_count()
		"spider_kills":
			return sim.spiders_killed
		"eggs":
			return eggs_bought
	return 0


func progress(sim) -> float:
	var m := current()
	if m.is_empty():
		return 1.0
	return clampf(float(value_for(m, sim)) / float(m["target"]), 0.0, 1.0)


func goal_text(sim) -> String:
	var m := current()
	if m.is_empty():
		return "Demo tamamlandı"
	return (
		"%s  ·  %d / %d %s"
		% [m["title"], mini(value_for(m, sim), m["target"]), m["target"], KIND_UNIT[m["kind"]]]
	)


## Tamamlanan bolumu dondurur (yoksa bos sozluk) ve bir sonrakine gecer.
func check(sim) -> Dictionary:
	var m := current()
	if m.is_empty() or value_for(m, sim) < m["target"]:
		return {}
	index += 1
	return m
