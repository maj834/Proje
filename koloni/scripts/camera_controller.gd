## Kamera: hedefe kare hizindan bagimsiz yumusak yaklasir. WASD/oklar, tekerlek (imlece dogru
## yakinlastirma), sag tik surukleme, MacBook trackpad kaydirma/sikistirma; acilista yaklasir.
extends Camera2D

@export var pan_speed := 650.0
@export var min_zoom := 0.7
@export var max_zoom := 4.0
@export var start_zoom := 1.6
@export var world_size := Vector2(1920, 1080)
@export var smoothing := 9.0

var target_pos := Vector2.ZERO
var target_zoom := 1.0

var _dragging := false
var _kick := 0.0


func _ready() -> void:
	position = world_size * 0.5
	target_pos = position
	# Gorus alani dunya disina tasmasin (dahili sinirlar son goruntuyu kirpar).
	limit_left = 0
	limit_top = 0
	limit_right = int(world_size.x)
	limit_bottom = int(world_size.y)
	zoom = Vector2.ONE * 0.9
	target_zoom = start_zoom


func _process(delta: float) -> void:
	var dir := Input.get_vector("pan_left", "pan_right", "pan_up", "pan_down")
	target_pos += dir * pan_speed * delta / target_zoom
	target_pos = target_pos.clamp(Vector2.ZERO, world_size)
	var k := 1.0 - exp(-smoothing * delta)
	position = position.lerp(target_pos, k)
	var z := lerpf(zoom.x, target_zoom, 1.0 - exp(-smoothing * 0.6 * delta))
	_kick = lerpf(_kick, 0.0, 1.0 - exp(-8.0 * delta))
	zoom = Vector2.ONE * z * (1.0 + _kick)


## Onemli anlarda kisa yakinlasma nabzi.
func kick(amount := 0.03) -> void:
	_kick = amount


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		match event.button_index:
			MOUSE_BUTTON_WHEEL_UP:
				if event.pressed:
					_zoom_at(1.12, get_global_mouse_position())
			MOUSE_BUTTON_WHEEL_DOWN:
				if event.pressed:
					_zoom_at(1.0 / 1.12, get_global_mouse_position())
			MOUSE_BUTTON_RIGHT:
				_dragging = event.pressed
	elif event is InputEventMouseMotion and _dragging:
		target_pos -= event.relative / zoom.x
		position -= event.relative / zoom.x
	elif event is InputEventMagnifyGesture:
		_zoom_at(event.factor, get_global_mouse_position())
	elif event is InputEventPanGesture:
		target_pos += event.delta * 10.0 / zoom.x


func _zoom_at(f: float, anchor: Vector2) -> void:
	var new_zoom := clampf(target_zoom * f, min_zoom, max_zoom)
	# Imlecin altindaki nokta yerinde kalsin.
	target_pos = anchor + (target_pos - anchor) * (target_zoom / new_zoom)
	target_pos = target_pos.clamp(Vector2.ZERO, world_size)
	target_zoom = new_zoom
