// Prosedurel orman zemini: fbm toprak + kurumus catlaklar (voronoi) + nem lekeleri
// + ince tane + yuva cevresinde ortam kapatma. Tek gecis, sabit dongu sayisi.
shader_type canvas_item;

uniform vec2 world_size = vec2(1920.0, 1080.0);
uniform vec2 nest_pos = vec2(960.0, 540.0);
uniform vec3 soil_shadow : source_color = vec3(0.165, 0.11, 0.07);
uniform vec3 soil_mid : source_color = vec3(0.29, 0.2, 0.133);
uniform vec3 soil_light : source_color = vec3(0.43, 0.314, 0.204);
uniform vec3 moss_dark : source_color = vec3(0.24, 0.29, 0.12);
uniform vec3 moss_light : source_color = vec3(0.37, 0.48, 0.16);

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
	return vec2(hash(p), hash(p + 17.17));
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
		p = p * 2.03 + 3.1;
		a *= 0.5;
	}
	return v;
}

// Voronoi kenar mesafesi (catlaklar icin), 3x3 komsuluk.
float cracks(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float d1 = 8.0;
	float d2 = 8.0;
	for (int y = -1; y <= 1; y++) {
		for (int x = -1; x <= 1; x++) {
			vec2 g = vec2(float(x), float(y));
			vec2 o = hash2(i + g);
			float d = length(g + o - f);
			if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
		}
	}
	return d2 - d1;
}

void fragment() {
	vec2 wp = UV * world_size;
	float big = fbm(wp * 0.0035);
	float mid = fbm(wp * 0.014 + 7.0);
	float grain = noise(wp * 0.55) * 0.6 + noise(wp * 1.3) * 0.4;

	vec3 col = mix(soil_shadow, soil_mid, smoothstep(0.2, 0.6, mid));
	col = mix(col, soil_light, smoothstep(0.55, 0.85, mid * 0.6 + big * 0.5));

	// Kuru bolgelerde catlaklar
	float dry = smoothstep(0.45, 0.65, big);
	float c = cracks(wp * 0.03 + fbm(wp * 0.02) * 1.5);
	col *= 1.0 - dry * 0.45 * (1.0 - smoothstep(0.02, 0.09, c));

	// Nem/yosun lekeleri
	float m = smoothstep(0.52, 0.7, fbm(wp * 0.0045 + 31.0));
	vec3 moss = mix(moss_dark, moss_light, noise(wp * 0.2) * grain);
	col = mix(col, moss, m * 0.7);
	col *= mix(1.0, 0.82, smoothstep(0.35, 0.2, big)); // islak koyu bolgeler

	// Ince tane ve kucuk parlak kum
	col *= 0.86 + grain * 0.24;
	col += step(0.985, hash(floor(wp * 0.7))) * 0.08;

	// Yuva cevresi: kazilmis toprak halkasi + AO
	float dn = length(wp - nest_pos);
	col = mix(col, soil_light * 0.95, smoothstep(110.0, 50.0, dn) * 0.45);
	col *= 1.0 - smoothstep(60.0, 28.0, dn) * 0.35;

	// Isik yonu (sol ust) boyunca genis tonlama
	col *= 1.0 + 0.14 * (1.0 - UV.x * 0.5 - UV.y * 0.5);
	COLOR = vec4(col, 1.0);
}
