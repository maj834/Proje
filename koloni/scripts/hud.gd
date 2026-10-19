## Arayuz: koloni paneli, bolum karti, saat, kiler dukkani, rehber, bildirimler, baslik ve
## oyun sonu ekranlari, vinyet. Hepsi kodla kurulur (koloni-arayuz-ses skill'i).
## Oyuncuya gorunen metinler Turkce karakterlerle yazilir.
extends CanvasLayer

const Economy := preload("res://scripts/economy.gd")
const VIGNETTE_SHADER := preload("res://shaders/vignette.gdshader")
const TEXT := Color(0.96, 0.9, 0.78)
const MUTED := Color(0.96, 0.9, 0.78, 0.62)
const GOLD := Color(1.0, 0.71, 0.23)
const BLUE := Color(0.29, 0.64, 1.0)
const RED := Color(0.95, 0.38, 0.3)
const COLONY_NAME := "Meşe Dibi Kolonisi"
const KEYS := (
	"Tıkla: yiyecek bırak   ·   Shift + sürükle: yol çiz   ·   1-4: kiler   ·   P: izler"
	+ "   ·   Boşluk: duraklat   ·   Q / E: hız   ·   WASD, sağ tık, trackpad: kamera"
)

@export var world_path: NodePath

var _world: Node2D
var _shown := {"ants": 0.0, "stored": 0.0, "rate": 0.0}
var _value_labels := {}
var _soldier_label: Label
var _eat_label: Label
var _chapter_label: Label
var _goal_text: Label
var _story: Label
var _goal_bar: ProgressBar
var _goal_shown := 0.0
var _speed_label: Label
var _clock_label: Label
var _shop_buttons: Array[Button] = []
var _toast: PanelContainer
var _toast_title: Label
var _toast_body: Label
var _toast_queue: Array[Array] = []
var _toast_busy := false
var _toast_tween: Tween
var _guide: Label
var _guide_panel: PanelContainer
var _keys: Label
var _keys_forced := false
var _title_screen: Control
var _end_screen: Control
var _cover: ColorRect
var _game_ui: Array[Control] = []


func _ready() -> void:
	_world = get_node(world_path)
	_world.toast.connect(_on_toast)
	_world.phase_changed.connect(_on_phase)
	_build_vignette()
	_build_stats()
	_build_goal()
	_build_clock()
	_build_shop()
	_build_guide()
	_build_toast()
	_build_title()
	_build_cover()
	for c in _game_ui:
		c.modulate.a = 0.0


func _process(delta: float) -> void:
	var sim = _world.sim
	var k := 1.0 - exp(-6.0 * delta)
	_shown["ants"] = lerpf(_shown["ants"], sim.ant_count(), k)
	_shown["stored"] = lerpf(_shown["stored"], sim.stored_food, k)
	_shown["rate"] = lerpf(_shown["rate"], _world.food_per_minute, k)
	_value_labels["ants"].text = _fmt(roundi(_shown["ants"]))
	_value_labels["stored"].text = _fmt(roundi(_shown["stored"]))
	_value_labels["rate"].text = "%s / dk" % _fmt(roundi(_shown["rate"]))
	var soldiers: int = sim.soldier_count()
	_soldier_label.text = "%d asker nöbette" % soldiers
	_soldier_label.visible = soldiers > 0
	var eat := roundi(sim.eat_rate() * 60.0)
	_eat_label.text = "yenen %d / dk" % eat
	var starving: bool = sim.stored_food == 0 and _world.phase == _world.Phase.PLAYING
	_eat_label.add_theme_color_override("font_color", RED if starving else MUTED)
	_value_labels["stored"].add_theme_color_override("font_color", RED if starving else TEXT)

	var prog = _world.progression
	var total: int = prog.CHAPTERS.size()
	_chapter_label.text = (
		"BÖLÜM %d / %d" % [mini(prog.index + 1, total), total]
		if not prog.finished()
		else "DEMO SONU"
	)
	_goal_text.text = prog.goal_text(sim)
	var cur: Dictionary = prog.current()
	_story.text = cur.get("story", "")
	_goal_shown = lerpf(_goal_shown, prog.progress(sim), k)
	_goal_bar.value = _goal_shown * 100.0

	if _world.paused:
		_speed_label.text = "Duraklatıldı"
		_speed_label.modulate = GOLD
	else:
		_speed_label.text = "Hız ×%d" % _world.time_scale
		_speed_label.modulate = TEXT
	var minutes := int(fmod(_world.day_time * 24.0 + 0.0, 24.0) * 60.0)
	var part := "gece" if _world.night > 0.5 else "gündüz"
	_clock_label.text = (
		"%d. gün  ·  %02d:%02d  ·  %s" % [_world.day_count, minutes / 60, minutes % 60, part]
	)
	_update_shop()
	_update_guide()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_H:
		_keys_forced = not _keys_forced
		_keys.visible = _keys_forced


## Binlik ayiricili Turkce sayi: 12345 -> 12.345
static func _fmt(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "." + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + s + out


## Ekran goruntusu araci icin: baslik ve perdeyi gec, oyunu baslat.
func skip_intro() -> void:
	if is_instance_valid(_cover):
		_cover.queue_free()
	if is_instance_valid(_title_screen):
		_title_screen.free()
	_world.start_game()
	for c in _game_ui:
		c.modulate.a = 1.0
	_toast_queue.clear()
	if _toast_tween:
		_toast_tween.kill()
	_toast.modulate.a = 0.0
	_toast_busy = false


func _on_phase(phase: int) -> void:
	if phase == _world.Phase.PLAYING:
		if not is_instance_valid(_title_screen):
			return
		var tw := create_tween().set_parallel(true)
		tw.tween_property(_title_screen, "modulate:a", 0.0, 0.6)
		for c in _game_ui:
			tw.tween_property(c, "modulate:a", 1.0, 0.8).set_delay(0.3)
		tw.chain().tween_callback(_title_screen.queue_free)
	elif phase == _world.Phase.WON or phase == _world.Phase.LOST:
		_show_end(phase == _world.Phase.WON)


func _panel_style(border := GOLD, alpha := 0.8) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.042, 0.028, alpha)
	sb.set_corner_radius_all(8)
	sb.border_color = Color(border, 0.22)
	sb.set_border_width_all(1)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	sb.shadow_color = Color(0, 0, 0, 0.3)
	sb.shadow_size = 5
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
	_game_ui.append(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 5)
	panel.add_child(box)
	box.add_child(_label(COLONY_NAME, 13, GOLD))
	for row in [
		["ants", "karınca", StatIcon.ANT],
		["stored", "kilerde", StatIcon.SEED],
		["rate", "gelen", StatIcon.ARROW]
	]:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 10)
		var icon := StatIcon.new()
		icon.kind = row[2]
		h.add_child(icon)
		var value := _label("0", 20)
		value.custom_minimum_size.x = 92
		h.add_child(value)
		h.add_child(_label(row[1], 13, MUTED))
		box.add_child(h)
		_value_labels[row[0]] = value
	_soldier_label = _label("", 13, RED)
	_eat_label = _label("", 12, MUTED)
	box.add_child(_soldier_label)
	box.add_child(_eat_label)


func _build_goal() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style())
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.offset_left = -210
	panel.offset_right = 210
	panel.offset_top = 16
	add_child(panel)
	_game_ui.append(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 5)
	panel.add_child(box)
	_chapter_label = _label("", 11, GOLD)
	box.add_child(_chapter_label)
	_goal_text = _label("", 17)
	box.add_child(_goal_text)
	_goal_bar = ProgressBar.new()
	_goal_bar.show_percentage = false
	_goal_bar.custom_minimum_size = Vector2(0, 6)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(1, 1, 1, 0.08)
	bg.set_corner_radius_all(3)
	var fill := StyleBoxFlat.new()
	fill.bg_color = GOLD
	fill.set_corner_radius_all(3)
	_goal_bar.add_theme_stylebox_override("background", bg)
	_goal_bar.add_theme_stylebox_override("fill", fill)
	box.add_child(_goal_bar)
	_story = _label("", 13, MUTED)
	_story.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_story)


func _build_clock() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _panel_style(BLUE))
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.offset_left = -246.0
	panel.offset_right = -16.0
	panel.offset_top = 16.0
	add_child(panel)
	_game_ui.append(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	_speed_label = _label("", 16)
	_clock_label = _label("", 13, MUTED)
	box.add_child(_speed_label)
	box.add_child(_clock_label)


func _build_shop() -> void:
	var bar := HBoxContainer.new()
	bar.anchor_left = 0.5
	bar.anchor_right = 0.5
	bar.anchor_top = 1.0
	bar.anchor_bottom = 1.0
	bar.offset_left = -330
	bar.offset_right = 330
	bar.offset_top = -78
	bar.offset_bottom = -16
	bar.add_theme_constant_override("separation", 8)
	add_child(bar)
	_game_ui.append(bar)
	for i in Economy.ITEMS.size():
		var b := Button.new()
		b.custom_minimum_size = Vector2(158, 62)
		b.focus_mode = Control.FOCUS_NONE
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.add_theme_font_size_override("font_size", 13)
		b.add_theme_color_override("font_color", TEXT)
		b.add_theme_color_override("font_hover_color", Color.WHITE)
		b.add_theme_color_override("font_disabled_color", Color(TEXT, 0.35))
		var normal := _panel_style(GOLD, 0.82)
		normal.content_margin_top = 6
		normal.content_margin_bottom = 6
		var hover := normal.duplicate()
		hover.border_color = Color(GOLD, 0.7)
		hover.bg_color = Color(0.12, 0.08, 0.04, 0.9)
		var disabled := normal.duplicate()
		disabled.bg_color = Color(0.05, 0.035, 0.025, 0.6)
		b.add_theme_stylebox_override("normal", normal)
		b.add_theme_stylebox_override("hover", hover)
		b.add_theme_stylebox_override("pressed", hover)
		b.add_theme_stylebox_override("disabled", disabled)
		b.pressed.connect(_on_buy.bind(i))
		bar.add_child(b)
		_shop_buttons.append(b)


func _update_shop() -> void:
	var eco = _world.economy
	for i in _shop_buttons.size():
		var item: Dictionary = Economy.ITEMS[i]
		var b := _shop_buttons[i]
		if eco.maxed(i):
			b.text = "%d  %s\n     tamamlandı" % [i + 1, item["name"]]
			b.disabled = true
		else:
			b.text = "%d  %s  ·  %d\n     %s" % [i + 1, item["name"], eco.cost(i), item["info"]]
			b.disabled = not eco.can_buy(i, _world.sim)


func _on_buy(i: int) -> void:
	_world.buy(i)
	var b := _shop_buttons[i]
	b.pivot_offset = b.size * 0.5
	var tw := create_tween()
	tw.tween_property(b, "scale", Vector2.ONE * 1.08, 0.08)
	tw.tween_property(b, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK)


func _build_guide() -> void:
	_guide_panel = PanelContainer.new()
	_guide_panel.add_theme_stylebox_override("panel", _panel_style(BLUE, 0.7))
	_guide_panel.anchor_left = 0.5
	_guide_panel.anchor_right = 0.5
	_guide_panel.anchor_top = 1.0
	_guide_panel.anchor_bottom = 1.0
	_guide_panel.offset_left = -300
	_guide_panel.offset_right = 300
	_guide_panel.offset_top = -130
	_guide_panel.offset_bottom = -88
	add_child(_guide_panel)
	_game_ui.append(_guide_panel)
	_guide = _label("", 14)
	_guide.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_guide_panel.add_child(_guide)
	_keys = _label(KEYS, 12, MUTED)
	_keys.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_keys.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_keys.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_keys.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_keys.position.y -= 140
	_keys.visible = false
	add_child(_keys)


## Rehber: oyuncu bir seyi yapana kadar o adimi gosterir, sonra bir sonrakine gecer.
func _update_guide() -> void:
	var w := _world
	var text := ""
	if w.phase != w.Phase.PLAYING:
		text = ""
	elif w.play_time < 7.0:
		text = "Altın izler yiyeceğe, mavi izler yuvaya gider. Karıncalar yolu kendi bulur."
	elif not w.did_drop:
		text = "Yuvanın yakınına tıkla: oraya yiyecek bırakırsın."
	elif not w.did_buy and w.economy.can_buy(0, w.sim):
		text = "Kiler doldu. Alttaki Yumurta düğmesiyle (ya da 1 tuşu) koloniyi büyüt."
	elif not w.did_paint and w.play_time > 40.0 and w.play_time < 70.0:
		text = "Shift'e basılı tutup sürükle: karıncalara yeni bir yol çizersin."
	elif not w.sim.spider.is_empty():
		text = "Örümcek karıncalarını avlıyor. Askerler onu kovalıyor."
	elif w.sim.stored_food == 0 and w.play_time > 20.0:
		text = "Kiler boş. Karıncaların aç kalmasın: yiyecek bırak."
	_guide.text = text
	var target := 1.0 if text != "" else 0.0
	_guide_panel.modulate.a = lerpf(_guide_panel.modulate.a, target, 0.1)


func _build_toast() -> void:
	_toast = PanelContainer.new()
	_toast.add_theme_stylebox_override("panel", _panel_style())
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.offset_left = -190
	_toast.offset_right = 190
	_toast.offset_top = 150
	_toast.modulate.a = 0.0
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_toast)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	_toast.add_child(box)
	_toast_title = _label("", 20, GOLD)
	_toast_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_body = _label("", 14)
	_toast_body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
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
	_toast.position.y = 134
	_toast_tween = create_tween()
	_toast_tween.set_parallel(true)
	_toast_tween.tween_property(_toast, "modulate:a", 1.0, 0.25)
	(
		_toast_tween
		. tween_property(_toast, "position:y", 150.0, 0.35)
		. set_trans(Tween.TRANS_QUART)
		. set_ease(Tween.EASE_OUT)
	)
	_toast_tween.chain().tween_interval(2.8)
	_toast_tween.chain().tween_property(_toast, "modulate:a", 0.0, 0.4)
	_toast_tween.chain().tween_callback(_show_next_toast)


func _build_title() -> void:
	_title_screen = Control.new()
	_title_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	_title_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_title_screen)
	var shade := ColorRect.new()
	shade.color = Color(0.03, 0.02, 0.015, 0.55)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_title_screen.add_child(shade)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 10)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_title_screen.add_child(box)
	for line in [
		["Koloni", 72, GOLD],
		["Bir meşenin dibinde, kışa kadar ayakta kalabilecek misin?", 18, TEXT],
		["", 10, TEXT],
		["Başlamak için tıkla", 16, MUTED],
	]:
		var l := _label(line[0], line[1], line[2])
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(l)
	var hint: Label = box.get_child(3)
	var tw := hint.create_tween().set_loops()
	tw.tween_property(hint, "modulate:a", 0.35, 1.2).set_trans(Tween.TRANS_SINE)
	tw.tween_property(hint, "modulate:a", 1.0, 1.2).set_trans(Tween.TRANS_SINE)


func _show_end(won: bool) -> void:
	_end_screen = Control.new()
	_end_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	_end_screen.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_end_screen.modulate.a = 0.0
	add_child(_end_screen)
	var shade := ColorRect.new()
	shade.color = Color(0.03, 0.02, 0.015, 0.7)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_end_screen.add_child(shade)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 10)
	_end_screen.add_child(box)
	var sim = _world.sim
	var minutes := int(_world.play_time / 60.0)
	var stats := (
		"%d. gün  ·  %s karınca  ·  %s yiyecek taşındı  ·  %d örümcek  ·  %d dk"
		% [
			_world.day_count,
			_fmt(sim.ant_count()),
			_fmt(sim.delivered_total),
			sim.spiders_killed,
			minutes
		]
	)
	var lines := [
		["Koloni kışa hazır" if won else "Koloni dağıldı", 52, GOLD if won else RED],
		[
			(
				"Meşe Dibi'nde ilk soğuklar başladığında kiler doluydu."
				if won
				else "Yuvada çok az karınca kaldı. Kraliçe yeni bir yer arayacak."
			),
			17,
			TEXT
		],
		[stats, 14, MUTED],
		["", 8, TEXT],
		["Demonun sonu. Yeniden oynamak için R." if won else "Yeniden denemek için R.", 15, MUTED],
	]
	for line in lines:
		var l := _label(line[0], line[1], line[2])
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(l)
	create_tween().tween_property(_end_screen, "modulate:a", 1.0, 1.0)


func _build_cover() -> void:
	_cover = ColorRect.new()
	_cover.color = Color(0.03, 0.02, 0.015)
	_cover.set_anchors_preset(Control.PRESET_FULL_RECT)
	_cover.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_cover)
	var tw := create_tween()
	tw.tween_interval(0.3)
	tw.tween_property(_cover, "modulate:a", 0.0, 1.4).set_trans(Tween.TRANS_SINE)
	tw.tween_callback(_cover.queue_free)


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
				for x in [-2.0, 0.5, 3.0]:
					draw_line(c + Vector2(x, 0), c + Vector2(x - 2.5, -5.5), col, 1.1, true)
					draw_line(c + Vector2(x, 0), c + Vector2(x - 2.5, 5.5), col, 1.1, true)
				draw_set_transform(c, 0.0, Vector2(1.0, 0.75))
				draw_circle(Vector2(-4.5, 0), 3.4, col)
				draw_circle(Vector2(0.5, 0), 2.2, col)
				draw_circle(Vector2(5.0, 0), 2.4, col)
				draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
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
