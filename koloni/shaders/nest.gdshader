// Yuva agzi: koyu cukur + toprak tepesi halkasi + hafif nabiz.
shader_type canvas_item;

uniform vec3 mound : source_color = vec3(0.42, 0.3, 0.18);
uniform vec3 hole : source_color = vec3(0.03, 0.02, 0.01);

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p);
	float ring = smoothstep(1.0, 0.55, d);
	float pit = smoothstep(0.42, 0.28 + 0.02 * sin(TIME * 2.0), d);
	float lit = 0.8 + 0.3 * dot(normalize(p + 0.0001), vec2(-0.6, -0.8)) * smoothstep(0.3, 0.9, d);
	vec3 col = mix(mound * lit, hole, pit);
	COLOR = vec4(col, ring);
}
