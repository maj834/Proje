// Ekran vinyeti: kenarlari yumusakca koyulastirir, odagi merkeze toplar. Ekran okumasi yok.
shader_type canvas_item;
render_mode blend_mul, unshaded;

uniform float amount = 0.3;
uniform vec3 edge_tint : source_color = vec3(0.55, 0.5, 0.62);

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	p.x *= 1.15;
	float v = smoothstep(0.55, 1.45, length(p));
	COLOR = vec4(mix(vec3(1.0), edge_tint * (1.0 - amount), v), 1.0);
}
