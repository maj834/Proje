## Karinca surusu cizimi: tek mesh, iki MultiMesh (golge + govde), ortak tampon.
## Kare basina tek `buffer` atamasi; bacak animasyonu ant.gdshader'da.
extends Node2D

const ColonySim := preload("res://scripts/colony_sim.gd")
const ANT_SHADER := preload("res://shaders/ant.gdshader")

const STRIDE := 16  # 8 (Transform2D) + 4 (renk) + 4 (ozel veri)
const GROUP_BODY := 0.0
const GROUP_CARGO := 0.25
const GROUP_A := 0.5
const GROUP_B := 1.0
const BODY_DARK := Color(0.075, 0.048, 0.03)
const BODY_LIGHT := Color(0.42, 0.29, 0.19)
const LIGHT_DIR := Vector2(-0.6, -0.8)

var sim: ColonySim

var _ants: MultiMeshInstance2D
var _shadows: MultiMeshInstance2D
var _buffer := PackedFloat32Array()
var _scales := PackedFloat32Array()
var _tints := PackedFloat32Array()


func setup(p_sim: ColonySim) -> void:
	sim = p_sim
	var mesh := _make_ant_mesh()
	var mat := ShaderMaterial.new()
	mat.shader = ANT_SHADER
	_shadows = _make_multimesh(mesh, mat)
	_shadows.modulate = Color(0, 0, 0, 0.32)
	_shadows.position = Vector2(1.6, 2.2)
	_shadows.z_index = 1
	add_child(_shadows)
	_ants = _make_multimesh(mesh, mat)
	_ants.z_index = 2
	add_child(_ants)
	_buffer.resize(ColonySim.MAX_ANTS * STRIDE)
	_buffer.fill(0.0)
	# Karinca basina sabit boy ve ton cesitliligi (tohumlu, her kare ayni).
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	_scales.resize(ColonySim.MAX_ANTS)
	_tints.resize(ColonySim.MAX_ANTS)
	for i in ColonySim.MAX_ANTS:
		_scales[i] = rng.randf_range(0.88, 1.12)
		_tints[i] = rng.randf_range(0.85, 1.2)


func refresh() -> void:
	var n := sim.ant_count()
	var b := _buffer
	for i in n:
		var h := sim.headings[i]
		var p := sim.positions[i]
		var soldier := sim.roles[i] == ColonySim.Role.SOLDIER
		var s := _scales[i] * (1.45 if soldier else 1.0)
		var c := cos(h) * s
		var sn := sin(h) * s
		var o := i * STRIDE
		b[o] = c
		b[o + 1] = -sn
		b[o + 3] = p.x
		b[o + 4] = sn
		b[o + 5] = c
		b[o + 7] = p.y
		var t := _tints[i]
		# Askerler kizil-kahve: gece de govdeleri ayirt edilir.
		b[o + 8] = t * (2.6 if soldier else 1.0)
		b[o + 9] = t * (1.1 if soldier else 1.0)
		b[o + 10] = t * (0.8 if soldier else 1.0)
		b[o + 11] = 1.0
		b[o + 12] = float(i % 97) / 97.0
		b[o + 13] = 1.0
		b[o + 14] = 1.0 if sim.states[i] == ColonySim.State.RETURN else 0.0
	_buffer = b
	for mi in [_ants, _shadows]:
		mi.multimesh.buffer = _buffer
		mi.multimesh.visible_instance_count = n


func _make_multimesh(mesh: Mesh, mat: Material) -> MultiMeshInstance2D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_2D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = mesh
	mm.instance_count = ColonySim.MAX_ANTS
	mm.visible_instance_count = 0
	var node := MultiMeshInstance2D.new()
	node.multimesh = mm
	node.material = mat
	return node


## +X yonune bakan ~14px karinca: bas, gogus, bel, karin, cene, anten, 6 bacak, yuk.
func _make_ant_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	# Bacaklar once (govdenin altinda kalsin). Tripod A: sol-on, sag-orta, sol-arka.
	var legs := [
		[Vector2(2.3, -0.6), Vector2(3.6, -2.6), Vector2(5.0, -4.2), GROUP_A],
		[Vector2(1.6, -0.7), Vector2(1.4, -3.0), Vector2(0.6, -4.9), GROUP_B],
		[Vector2(0.9, -0.6), Vector2(-0.6, -2.8), Vector2(-2.8, -4.4), GROUP_A],
		[Vector2(2.3, 0.6), Vector2(3.6, 2.6), Vector2(5.0, 4.2), GROUP_B],
		[Vector2(1.6, 0.7), Vector2(1.4, 3.0), Vector2(0.6, 4.9), GROUP_A],
		[Vector2(0.9, 0.6), Vector2(-0.6, 2.8), Vector2(-2.8, 4.4), GROUP_B],
	]
	for leg in legs:
		_add_segment(st, leg[0], leg[1], 0.42, leg[3], 0.0, 0.5)
		_add_segment(st, leg[1], leg[2], 0.32, leg[3], 0.5, 1.0)
	# Antenler ve ceneler (govde grubu, sabit)
	for sy in [-1.0, 1.0]:
		_add_segment(st, Vector2(5.6, 0.5 * sy), Vector2(6.8, 2.0 * sy), 0.26, GROUP_BODY, 0, 0)
		_add_segment(st, Vector2(6.8, 2.0 * sy), Vector2(8.4, 2.3 * sy), 0.22, GROUP_BODY, 0, 0)
		_add_segment(st, Vector2(6.0, 0.6 * sy), Vector2(7.0, 0.15 * sy), 0.3, GROUP_BODY, 0, 0)
	_add_shaded_ellipse(st, Vector2(-3.6, 0), 3.0, 2.2)  # karin
	_add_shaded_ellipse(st, Vector2(-0.4, 0), 0.7, 0.55)  # bel
	_add_shaded_ellipse(st, Vector2(1.6, 0), 1.9, 1.15)  # gogus
	_add_shaded_ellipse(st, Vector2(4.7, 0), 1.7, 1.55)  # bas
	# Yuk: altin tohum, yalnizca tasiyan karincada gorunur
	_add_ellipse(
		st, Vector2(8.2, 0), 1.9, 1.5, Color(0.85, 0.6, 0.2), Color(1.0, 0.88, 0.5), GROUP_CARGO
	)
	return st.commit()


func _add_shaded_ellipse(st: SurfaceTool, c: Vector2, rx: float, ry: float) -> void:
	_add_ellipse(st, c, rx, ry, BODY_DARK, BODY_LIGHT, GROUP_BODY)


## Merkez kosesi isik yonune kaydirilmis ucgen yelpazesi: tek renk gecisiyle parlak govde.
func _add_ellipse(
	st: SurfaceTool, c: Vector2, rx: float, ry: float, rim: Color, core: Color, group: float
) -> void:
	var seg := 12
	var hl := c + Vector2(LIGHT_DIR.x * rx * 0.35, LIGHT_DIR.y * ry * 0.35)
	for s in seg:
		var a0 := TAU * s / seg
		var a1 := TAU * (s + 1) / seg
		_vertex(st, hl, core, group, 0.0)
		_vertex(st, c + Vector2(cos(a0) * rx, sin(a0) * ry), rim, group, 0.0)
		_vertex(st, c + Vector2(cos(a1) * rx, sin(a1) * ry), rim, group, 0.0)


func _add_segment(
	st: SurfaceTool, a: Vector2, b: Vector2, w: float, group: float, wa: float, wb: float
) -> void:
	var n := (b - a).orthogonal().normalized() * w
	var col := BODY_DARK
	_vertex(st, a + n, col, group, wa)
	_vertex(st, b + n, col, group, wb)
	_vertex(st, b - n, col, group, wb)
	_vertex(st, a + n, col, group, wa)
	_vertex(st, b - n, col, group, wb)
	_vertex(st, a - n, col, group, wa)


func _vertex(st: SurfaceTool, v: Vector2, col: Color, group: float, weight: float) -> void:
	st.set_color(col)
	st.set_uv(Vector2(weight, group))
	st.add_vertex(Vector3(v.x, v.y, 0))
