// Yuva: kazilmis toprak tepesi (taneli), kenar isigi, derinlesen giris, dogumda nabiz.
shader_type canvas_item;

uniform vec3 mound_light : source_color = vec3(0.56, 0.41, 0.26);
uniform vec3 mound_dark : source_color = vec3(0.27, 0.18, 0.11);
uniform vec3 hole : source_color = vec3(0.02, 0.012, 0.008);
uniform float pulse = 0.0;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p);
	vec2 n = p / max(d, 0.001);
	// Tepe profili: 0.3'te zirve, kenara dogru alcalir
	float h = smoothstep(1.0, 0.45, d) * smoothstep(0.18, 0.42, d);
	float lit = 0.55 + 0.75 * h * dot(-n, vec2(-0.6, -0.8));
	float grain = hash(floor(UV * 90.0)) * 0.25 + 0.85;
	vec3 col = mix(mound_dark, mound_light, clamp(lit, 0.0, 1.2)) * grain;
	// Giris: icine dogru koyulasan kuyu
	float r_hole = 0.3 + pulse * 0.04;
	float pit = smoothstep(r_hole + 0.06, r_hole - 0.12, d);
	col = mix(col, hole, pit);
	col += vec3(1.0, 0.7, 0.35) * pulse * 0.35 * smoothstep(0.6, 0.3, d);
	float alpha = smoothstep(1.0, 0.8, d);
	COLOR = vec4(col, alpha);
}
