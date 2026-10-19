## Feromon izgarasi: iki katman (yuva izi, yiyecek izi), hucre basina 0..1 yogunluk.
## Saf veri; cizim world.gd icinde dokuya aktarilir.
extends RefCounted

enum Layer { HOME, FOOD }

var width: int
var height: int
var cell_size: float
var home := PackedFloat32Array()
var food := PackedFloat32Array()


func _init(world_size: Vector2, p_cell_size: float) -> void:
	cell_size = p_cell_size
	width = int(ceil(world_size.x / cell_size))
	height = int(ceil(world_size.y / cell_size))
	home.resize(width * height)
	food.resize(width * height)
	home.fill(0.0)
	food.fill(0.0)


func cell_index(pos: Vector2) -> int:
	var x := int(pos.x / cell_size)
	var y := int(pos.y / cell_size)
	if x < 0 or y < 0 or x >= width or y >= height:
		return -1
	return y * width + x


## Miktari en yakin 4 hucreye agirlikli dagitir: izler ekranda basamakli degil yumusak gorunur.
func deposit(layer: Layer, pos: Vector2, amount: float) -> void:
	var g := pos / cell_size - Vector2(0.5, 0.5)
	var x0 := int(floor(g.x))
	var y0 := int(floor(g.y))
	var fx := g.x - x0
	var fy := g.y - y0
	_add(layer, x0, y0, amount * (1.0 - fx) * (1.0 - fy))
	_add(layer, x0 + 1, y0, amount * fx * (1.0 - fy))
	_add(layer, x0, y0 + 1, amount * (1.0 - fx) * fy)
	_add(layer, x0 + 1, y0 + 1, amount * fx * fy)


func _add(layer: Layer, x: int, y: int, amount: float) -> void:
	if x < 0 or y < 0 or x >= width or y >= height:
		return
	var i := y * width + x
	if layer == Layer.HOME:
		home[i] = minf(1.0, home[i] + amount)
	else:
		food[i] = minf(1.0, food[i] + amount)


func sample(layer: Layer, pos: Vector2) -> float:
	var i := cell_index(pos)
	if i < 0:
		return -1.0  # Dunya disi: karinca oraya donmesin.
	return home[i] if layer == Layer.HOME else food[i]


## Her iki katmani `factor` ile carpar (0..1). Dusuk frekansta cagirin (~10 Hz).
func evaporate(factor: float) -> void:
	for i in home.size():
		home[i] *= factor
		food[i] *= factor
