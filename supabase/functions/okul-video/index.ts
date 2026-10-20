// Borsa Okulu videolari: video studyosu (GitHub Actions) icin imzali yukleme adresi verir ve dersin video alanlarini baglar.
// Kimlik okul-ingest gibi GitHub OIDC (audience "okul-video"); paylasilan sir yok. Dosyalar herkese acik "okul-video" kovasinda.
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ISS = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL(ISS + "/.well-known/jwks"));
const REPOS = (Deno.env.get("OKUL_VIDEO_REPOS") || "maj834/ai-video-studio").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const BUCKET = "okul-video";
const SLUG = /^[a-z0-9-]{3,120}$/;
const EXT: Record<string, string> = { mp4: "video/mp4", srt: "application/x-subrip", jpg: "image/jpeg", png: "image/png" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "yalniz POST" }, 405);
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return json({ ok: false, error: "kimlik yok" }, 401);
  try {
    const { payload } = await jwtVerify(tok, JWKS, { issuer: ISS, audience: "okul-video" });
    if (!REPOS.includes(String(payload.repository || "").toLowerCase()) || payload.ref !== "refs/heads/main") return json({ ok: false, error: "izinsiz depo/dal" }, 403);
  } catch (_e) {
    return json({ ok: false, error: "gecersiz kimlik" }, 401);
  }
  let b: any;
  try { b = await req.json(); } catch (_e) { return json({ ok: false, error: "gecersiz JSON" }, 400); }
  const slug = typeof b?.slug === "string" ? b.slug : "";
  if (!SLUG.test(slug)) return json({ ok: false, error: "gecersiz slug" }, 400);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: row, error: e0 } = await sb.from("okul_icerik").select("slug").eq("slug", slug).maybeSingle();
  if (e0) return json({ ok: false, error: "veritabani: " + e0.message }, 500);
  if (!row) return json({ ok: false, error: "icerik bulunamadi: " + slug }, 404);

  if (b.op === "upload-url") {
    // Her yukleme yeni bir surum klasorune gider (eski baglanti bozulmaz; onbellek sorunu olmaz)
    const ext = String(b.ext || "");
    if (!EXT[ext]) return json({ ok: false, error: "gecersiz uzanti" }, 400);
    const ver = typeof b.surum === "string" && /^[a-z0-9-]{1,40}$/.test(b.surum) ? b.surum : String(Date.now());
    const path = `${slug}/${ver}/${ext === "mp4" ? "video" : ext === "srt" ? "altyazi" : "kapak"}.${ext}`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return json({ ok: false, error: "depolama: " + error.message }, 500);
    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return json({ ok: true, path, signedUrl: data.signedUrl, token: data.token, contentType: EXT[ext], publicUrl });
  }
  if (b.op === "link") {
    const base = Deno.env.get("SUPABASE_URL") + "/storage/v1/object/public/" + BUCKET + "/";
    const ok = (u: unknown) => typeof u === "string" && u.startsWith(base) && u.length < 600;
    if (!ok(b.video_url)) return json({ ok: false, error: "video_url bu kovaya ait olmali" }, 400);
    const m = b.video_meta && typeof b.video_meta === "object" ? b.video_meta : {};
    const meta: Record<string, unknown> = {
      sure_sn: Number.isFinite(m.sure_sn) ? Math.round(m.sure_sn) : null,
      altyazi_url: ok(m.altyazi_url) ? m.altyazi_url : null,
      kapak_url: ok(m.kapak_url) ? m.kapak_url : null,
      ses: typeof m.ses === "string" ? m.ses.slice(0, 60) : null,
      cozunurluk: typeof m.cozunurluk === "string" ? m.cozunurluk.slice(0, 20) : null,
      kaynak: "ai-video-studio",
      tarih: new Date().toISOString(),
    };
    const { error } = await sb.from("okul_icerik").update({ video_url: b.video_url, video_meta: meta }).eq("slug", slug);
    if (error) return json({ ok: false, error: "veritabani: " + error.message }, 500);
    return json({ ok: true, slug, video_url: b.video_url });
  }
  return json({ ok: false, error: "gecersiz islem" }, 400);
});
