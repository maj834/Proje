// Prosedurel toprak: fbm gurultu + cakil + nem lekeleri. Doku yok, tek ColorRect.
// Tek gecis, dongu sayisi sabit (4 oktav): entegre GPU'da ihmal edilebilir maliyet.
shader_type canvas_item;

uniform vec2 world_size = vec2(1920.0, 1080.0);
uniform vec3 soil_dark : source_color = vec3(0.16, 0.11, 0.07);
uniform vec3 soil_light : source_color = vec3(0.36, 0.26, 0.16);
uniform vec3 moss : source_color = vec3(0.22, 0.27, 0.12);
uniform float pebble_density = 0.035;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
			mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return v;
}

void fragment() {
	vec2 wp = UV * world_size;
	float base = fbm(wp * 0.012);
	float grain = noise(wp * 0.45);
	vec3 col = mix(soil_dark, soil_light, smoothstep(0.25, 0.8, base));
	col *= 0.88 + grain * 0.18;
	// Yosun lekeleri
	float m = smoothstep(0.58, 0.72, fbm(wp * 0.004 + 17.0));
	col = mix(col, moss, m * 0.55);
	// Cakillar: hucre basina bir aday tas
	vec2 cell = floor(wp / 14.0);
	float h = hash(cell);
	if (h < pebble_density) {
		vec2 c = (cell + 0.25 + 0.5 * vec2(hash(cell + 3.1), hash(cell + 7.7))) * 14.0;
		float r = 2.0 + 3.0 * hash(cell + 1.3);
		float d = length(wp - c) / r;
		float shade = 0.75 + 0.35 * dot(normalize(wp - c + 0.001), vec2(-0.6, -0.8)) * d;
		col = mix(col, vec3(0.45, 0.42, 0.38) * shade, smoothstep(1.0, 0.8, d));
	}
	COLOR = vec4(col, 1.0);
}
