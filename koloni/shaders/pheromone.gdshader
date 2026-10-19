// Feromon katmani: iki tek kanalli float doku -> renkli, eklemeli parilti + akan isilti.
// Izgara kucuk (hucre 8px) ve shader icinde bilinear yumusatilir; isiklardan etkilenmez (gece parlar).
shader_type canvas_item;
render_mode blend_add, unshaded;

uniform sampler2D home_tex : filter_nearest;
uniform sampler2D food_tex : filter_nearest;
uniform vec3 home_color : source_color = vec3(0.29, 0.64, 1.0);
uniform vec3 food_color : source_color = vec3(1.0, 0.71, 0.23);
uniform float intensity = 0.85;
uniform float night = 0.0;

// Elle bilinear: float dokularda donanim filtrelemesi her GPU'da yok (ozellikle GL).
vec2 bilinear(vec2 uv) {
	vec2 size = vec2(textureSize(home_tex, 0));
	vec2 p = uv * size - 0.5;
	ivec2 i = ivec2(floor(p));
	vec2 f = fract(p);
	ivec2 m = ivec2(size) - 1;
	ivec2 a = clamp(i, ivec2(0), m);
	ivec2 b = clamp(i + ivec2(1, 0), ivec2(0), m);
	ivec2 c = clamp(i + ivec2(0, 1), ivec2(0), m);
	ivec2 d = clamp(i + ivec2(1, 1), ivec2(0), m);
	vec2 s00 = vec2(texelFetch(home_tex, a, 0).r, texelFetch(food_tex, a, 0).r);
	vec2 s10 = vec2(texelFetch(home_tex, b, 0).r, texelFetch(food_tex, b, 0).r);
	vec2 s01 = vec2(texelFetch(home_tex, c, 0).r, texelFetch(food_tex, c, 0).r);
	vec2 s11 = vec2(texelFetch(home_tex, d, 0).r, texelFetch(food_tex, d, 0).r);
	return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

void fragment() {
	vec2 v = bilinear(UV);
	vec2 size = vec2(textureSize(home_tex, 0));
	// Iz boyunca akan ince isilti (ucuz: tek sinus, konuma bagli)
	vec2 wp = UV * size;
	float shimmer = 0.8 + 0.2 * sin(wp.x * 1.7 + wp.y * 1.3 - TIME * 3.0);
	float h = sqrt(v.x) * 0.38;
	float f = sqrt(v.y) * shimmer * 1.25;
	// Yogun izin cekirdegi beyaza kayar (parilti hissi)
	vec3 col = home_color * h + food_color * f + vec3(1.0, 0.9, 0.7) * pow(v.y, 3.0) * 0.6;
	COLOR = vec4(col * intensity * (1.0 + night * 0.5), 1.0);
}
