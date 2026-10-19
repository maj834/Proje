## Kamera: WASD/oklar ile kaydirma, tekerlek/trackpad ile yakinlastirma, sag tus ile surukleme.
extends Camera2D

@export var pan_speed := 700.0
@export var min_zoom := 0.6
@export var max_zoom := 4.0
@export var world_size := Vector2(1920, 1080)

var _dragging := false


func _ready() -> void:
	position = world_size * 0.5
	limit_left = 0
	limit_top = 0
	limit_right = int(world_size.x)
	limit_bottom = int(world_size.y)


func _process(delta: float) -> void:
	var dir := Input.get_vector("pan_left", "pan_right", "pan_up", "pan_down")
	position += dir * pan_speed * delta / zoom.x
	position = position.clamp(Vector2.ZERO, world_size)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		match event.button_index:
			MOUSE_BUTTON_WHEEL_UP:
				_zoom_by(1.1)
			MOUSE_BUTTON_WHEEL_DOWN:
				_zoom_by(1.0 / 1.1)
			MOUSE_BUTTON_RIGHT:
				_dragging = event.pressed
	elif event is InputEventMouseMotion and _dragging:
		position -= event.relative / zoom.x
	elif event is InputEventMagnifyGesture:  # MacBook trackpad sikistirma
		_zoom_by(event.factor)
	elif event is InputEventPanGesture:  # Iki parmak kaydirma
		position += event.delta * 8.0 / zoom.x


func _zoom_by(f: float) -> void:
	zoom = Vector2.ONE * clampf(zoom.x * f, min_zoom, max_zoom)
