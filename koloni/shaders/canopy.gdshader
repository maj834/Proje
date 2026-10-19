// Kanopi golgesi: yukaridaki yapraklardan suzulen yumusak golge lekeleri, ruzgarla kayar.
// blend_mul tek gecis; gece etkisi azalir (night uniform).
shader_type canvas_item;
render_mode blend_mul, unshaded;

uniform vec2 world_size = vec2(1920.0, 1080.0);
uniform float strength = 0.45;
uniform float night = 0.0;

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

void fragment() {
	vec2 wp = UV * world_size * 0.006;
	vec2 wind = vec2(TIME * 0.05, TIME * 0.02);
	float n = noise(wp + wind) * 0.55 + noise(wp * 2.1 - wind * 1.7) * 0.3
			+ noise(wp * 4.3 + wind * 2.3) * 0.15;
	float shade = smoothstep(0.42, 0.62, n);
	float s = shade * strength * (1.0 - night * 0.8);
	// Golge hafif soguk tonda; isik lekeleri dokunulmaz
	COLOR = vec4(mix(vec3(1.0), vec3(0.55, 0.6, 0.74), s), 1.0);
}
