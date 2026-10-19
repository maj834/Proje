## Arayuz: kaynak paneli, hedef karti + ilerleme cubugu, hiz/gun gostergesi, bildirimler (toast),
## kontrol ipuclari, acilis basligi ve vinyet. Hepsi kodla kurulur (koloni-arayuz-ses skill'i).
extends CanvasLayer

const VIGNETTE_SHADER := preload("res://shaders/vignette.gdshader")
const TEXT := Color(0.96, 0.9, 0.78)
const MUTED := Color(0.96, 0.9, 0.78, 0.6)
const GOLD := Color(1.0, 0.71, 0.23)
const BLUE := Color(0.29, 0.64, 1.0)
const HINT_TIME := 20.0
const HINTS := (
	"Sol tik: yiyecek birak    Shift+surukle / F: feromon fircasi    P: izler"
	+ "    Bosluk: duraklat    Q/E: hiz    WASD, sag tik, trackpad: kamera    H: ipuclari"
)

@export var world_path: NodePath

var _world: Node2D
var _shown := {"ants": 0.0, "stored": 0.0, "rate": 0.0}
var _value_labels := {}
var _goal_title: Label
var _goal_text: Label
var _goal_bar: ProgressBar
var _goal_shown := 0.0
var _speed_label: Label
var _clock_label: Label
var _toast: PanelContainer
var _toast_title: Label
var _toast_body: Label
var _toast_queue: Array[Array] = []
var _toast_busy := false
var _hints: Label
var _hint_timer := HINT_TIME
var _hints_forced := false
var _cover: ColorRect


func _ready() -> void:
	_world = get_node(world_path)
	_world.toast.connect(_on_toast)
	_build_vignette()
	_build_stats()
	_build_goal()
	_build_clock()
	_build_toast()
	_build_hints()
	_build_intro()


func _process(delta: float) -> void:
	var sim = _world.sim
	var k := 1.0 - exp(-6.0 * delta)
	_shown["ants"] = lerpf(_shown["ants"], sim.ant_count(), k)
	_shown["stored"] = lerpf(_shown["stored"], sim.stored_food, k)
	_shown["rate"] = lerpf(_shown["rate"], _world.food_per_minute, k)
	_value_labels["ants"].text = _fmt(roundi(_shown["ants"]))
	_value_labels["stored"].text = _fmt(roundi(_shown["stored"]))
	_value_labels["rate"].text = "%s/dk" % _fmt(roundi(_shown["rate"]))

	var prog = _world.progression
	_goal_text.text = prog.goal_text(sim)
	_goal_shown = lerpf(_goal_shown, prog.progress(sim), k)
	_goal_bar.value = _goal_shown * 100.0

	if _world.paused:
		_speed_label.text = "DURAKLATILDI"
		_speed_label.modulate = GOLD
	else:
		_speed_label.text = "Hiz x%d" % _world.time_scale
		_speed_label.modulate = TEXT
	var minutes := int(_world.day_time * 24.0 * 60.0)
	var icon := "Gece" if _world.night > 0.5 else "Gunduz"
	_clock_label.text = (
		"Gun %d  %02d:%02d  %s" % [_world.day_count, minutes / 60, minutes % 60, icon]
	)

	if not _hints_forced:
		_hint_timer -= delta
		_hints.modulate.a = clampf(_hint_timer / 2.0, 0.0, 1.0)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_H:
		_hints_forced = not _hints_forced
		_hints.modulate.a = 1.0 if _hints_forced else 0.0
		_hint_timer = 0.0


## Binlik ayiricili Turkce sayi: 12345 -> 12.345
static func _fmt(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "." + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out


func _panel_style(border := GOLD) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.035, 0.024, 0.78)
	sb.set_corner_radius_all(10)
	sb.border_color = Color(border, 0.28)
	sb.set_border_width_all(1)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_size = 6
	return sb


func _label(text: String, size: int, col := TEXT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	l.add_theme_constant_override("shadow_offset_y", 1)
	return l


func _build_vignette() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 1
	add_child(layer)
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = VIGNETTE_SHADER
	rect.material = mat
	layer.add_child(rect)


func _build_stats() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style())
	panel.position = Vector2(16, 16)
	add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)
	box.add_child(_label("KOLONI", 13, GOLD))
	for row in [
		["ants", "Karinca", StatIcon.ANT],
		["stored", "Depo", StatIcon.SEED],
		["rate", "Gelir", StatIcon.ARROW]
	]:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 10)
		var icon := StatIcon.new()
		icon.kind = row[2]
		h.add_child(icon)
		var value := _label("0", 20)
		value.custom_minimum_size.x = 86
		h.add_child(value)
		h.add_child(_label(row[1], 13, MUTED))
		box.add_child(h)
		_value_labels[row[0]] = value


func _build_goal() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_CENTER_TOP)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style())
	panel.custom_minimum_size = Vector2(380, 0)
	panel.position = Vector2(-190, 16)
	root.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)
	_goal_title = _label("HEDEF", 12, GOLD)
	box.add_child(_goal_title)
	_goal_text = _label("", 16)
	box.add_child(_goal_text)
	_goal_bar = ProgressBar.new()
	_goal_bar.show_percentage = false
	_goal_bar.custom_minimum_size = Vector2(0, 8)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(1, 1, 1, 0.08)
	bg.set_corner_radius_all(4)
	var fill := StyleBoxFlat.new()
	fill.bg_color = GOLD
	fill.set_corner_radius_all(4)
	_goal_bar.add_theme_stylebox_override("background", bg)
	_goal_bar.add_theme_stylebox_override("fill", fill)
	box.add_child(_goal_bar)


func _build_clock() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style(BLUE))
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.offset_left = -236.0
	panel.offset_right = -16.0
	panel.offset_top = 16.0
	add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	_speed_label = _label("", 16)
	_clock_label = _label("", 13, MUTED)
	box.add_child(_speed_label)
	box.add_child(_clock_label)


func _build_toast() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_CENTER_TOP)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_toast = PanelContainer.new()
	_toast.add_theme_stylebox_override("panel", _panel_style())
	_toast.custom_minimum_size = Vector2(320, 0)
	_toast.position = Vector2(-160, 128)
	_toast.modulate.a = 0.0
	root.add_child(_toast)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	_toast.add_child(box)
	_toast_title = _label("", 20, GOLD)
	_toast_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_body = _label("", 14)
	_toast_body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_toast_title)
	box.add_child(_toast_body)


func _on_toast(title: String, body: String, color: Color) -> void:
	if _toast_queue.size() < 3:
		_toast_queue.append([title, body, color])
	if not _toast_busy:
		_show_next_toast()


func _show_next_toast() -> void:
	if _toast_queue.is_empty():
		_toast_busy = false
		return
	_toast_busy = true
	var t: Array = _toast_queue.pop_front()
	_toast_title.text = t[0]
	_toast_title.add_theme_color_override("font_color", t[2])
	_toast_body.text = t[1]
	_toast.position.y = 112
	_toast.scale = Vector2.ONE * 0.92
	_toast.pivot_offset = Vector2(160, 30)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(_toast, "modulate:a", 1.0, 0.25)
	tw.tween_property(_toast, "position:y", 128.0, 0.35).set_trans(Tween.TRANS_QUART).set_ease(
		Tween.EASE_OUT
	)
	tw.tween_property(_toast, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(
		Tween.EASE_OUT
	)
	tw.chain().tween_interval(2.2)
	tw.chain().tween_property(_toast, "modulate:a", 0.0, 0.4)
	tw.chain().tween_callback(_show_next_toast)


func _build_hints() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_hints = _label(HINTS, 13, MUTED)
	_hints.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_hints.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hints.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_hints.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hints.position.y -= 18
	root.add_child(_hints)


func _build_intro() -> void:
	var cover := ColorRect.new()
	_cover = cover
	cover.color = Color(0.03, 0.02, 0.015)
	cover.set_anchors_preset(Control.PRESET_FULL_RECT)
	cover.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(cover)
	var title := _label("KOLONI", 64, GOLD)
	title.set_anchors_preset(Control.PRESET_FULL_RECT)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	title.add_theme_constant_override("outline_size", 0)
	cover.add_child(title)
	var tw := create_tween()
	tw.tween_interval(0.9)
	tw.tween_property(cover, "modulate:a", 0.0, 1.6).set_trans(Tween.TRANS_SINE)
	tw.tween_callback(cover.queue_free)


## Acilis perdesini hemen kaldirir (ekran goruntusu araci icin).
func skip_intro() -> void:
	if is_instance_valid(_cover):
		_cover.queue_free()
	_hint_timer = HINT_TIME
	_toast_queue.clear()
	_toast.modulate.a = 0.0


## Panel ikonlari: dosya yerine basit cizim (karinca silueti, tohum, yukari ok).
class StatIcon:
	extends Control

	enum { ANT, SEED, ARROW }

	var kind := ANT

	func _init() -> void:
		custom_minimum_size = Vector2(20, 20)

	func _draw() -> void:
		var c := Vector2(10, 10)
		match kind:
			ANT:
				var col := Color(0.96, 0.9, 0.78)
				draw_circle(c + Vector2(-4, 0), 3.4, col)
				draw_circle(c + Vector2(1, 0), 2.2, col)
				draw_circle(c + Vector2(5.5, 0), 2.4, col)
				for x in [-1.0, 1.0, 3.0]:
					draw_line(c + Vector2(x, 0), c + Vector2(x - 2, -6), col, 1.2, true)
					draw_line(c + Vector2(x, 0), c + Vector2(x - 2, 6), col, 1.2, true)
			SEED:
				draw_set_transform(c, -0.5, Vector2(1.5, 1.0))
				draw_circle(Vector2.ZERO, 5.0, Color(1.0, 0.71, 0.23))
				draw_circle(Vector2(-1.5, -1.8), 2.0, Color(1.0, 0.9, 0.6))
				draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
			ARROW:
				var col := Color(0.29, 0.64, 1.0)
				draw_line(c + Vector2(0, 7), c + Vector2(0, -6), col, 2.4, true)
				draw_line(c + Vector2(0, -7), c + Vector2(-5, -1), col, 2.4, true)
				draw_line(c + Vector2(0, -7), c + Vector2(5, -1), col, 2.4, true)
