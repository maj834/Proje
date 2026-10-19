// Karinca: 3'lu tripod yurume animasyonu GPU'da.
// UV.y grubu: 0 govde, 0.25 yuk (yalnizca tasiyan karincada), 0.5 tripod A, 1.0 tripod B.
// UV.x: bacak kokunden (0) ucuna (1) agirlik. INSTANCE_CUSTOM: x faz, y hiz, z yuk tasiyor mu.
shader_type canvas_item;

uniform float stride_speed = 22.0;
uniform float swing = 1.4;

void vertex() {
	float group = UV.y;
	float phase = INSTANCE_CUSTOM.x * 6.2831 + TIME * stride_speed * INSTANCE_CUSTOM.y;
	if (group > 0.4) {
		float dir = group > 0.75 ? 1.0 : -1.0;
		VERTEX.x += sin(phase) * dir * swing * UV.x;
		VERTEX.y *= 1.0 + 0.08 * cos(phase) * dir * UV.x;
	} else if (group > 0.1) {
		// Yuk: tasimiyorsa tek noktaya cokert (gorunmez).
		VERTEX *= step(0.5, INSTANCE_CUSTOM.z);
	} else if (VERTEX.x < -1.0) {
		// Karin hafif yalpalar.
		VERTEX.y += sin(phase * 0.5) * 0.25;
	}
}
