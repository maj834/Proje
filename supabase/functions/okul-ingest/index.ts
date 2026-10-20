// Borsa Okulu icerik yukleme: yalniz izinli GitHub deposunun Actions isinden (OIDC JWT, audience "okul-ingest").
// Paylasilan sir yok: imza GitHub JWKS ile dogrulanir. Yazma service role ile (ortam degiskeni, Supabase saglar).
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ISS = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL(ISS + "/.well-known/jwks"));
const REPOS = (Deno.env.get("OKUL_REPOS") || "maj834/Hisse").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const TUR = new Set(["analiz", "ders", "soru", "sozluk", "video"]);
const SEVIYE = new Set(["baslangic", "orta", "ileri"]);
const KONU = new Set(["temel-kavramlar", "teknik", "temel", "risk", "psikoloji", "makro", "bist-kurallari", "strateji", "vergi-maliyet", "genel"]);
const SLUG = /^[a-z0-9-]{3,120}$/;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => x.trim().slice(0, 40)) : []);
const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]{3,500}$/.test(v) ? v : null);

function clean(x: Record<string, unknown>) {
  const slug = typeof x.slug === "string" ? x.slug : "";
  if (!SLUG.test(slug)) throw new Error("gecersiz slug");
  if (!TUR.has(String(x.tur))) throw new Error(slug + ": gecersiz tur");
  const baslik = str(x.baslik, 200);
  if (!baslik) throw new Error(slug + ": baslik yok");
  const govde = x.govde && typeof x.govde === "object" && !Array.isArray(x.govde) ? x.govde : {};
  if (JSON.stringify(govde).length > 200000) throw new Error(slug + ": govde cok buyuk");
  const tarih = typeof x.tarih === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.tarih) ? x.tarih : undefined;
  const kaynaklar = Array.isArray(x.kaynaklar)
    ? x.kaynaklar.slice(0, 20).map((k: any) => ({ ad: str(k?.ad, 120), url: https(k?.url) })).filter((k) => k.url)
    : [];
  const row: Record<string, unknown> = {
    slug, tur: x.tur, baslik, ozet: str(x.ozet, 1000), govde,
    seviye: SEVIYE.has(String(x.seviye)) ? x.seviye : null, konu: KONU.has(String(x.konu)) ? x.konu : null,
    etiketler: arr(x.etiketler, 20), semboller: arr(x.semboller, 30).map((s) => s.toUpperCase()),
    sira: Number.isInteger(x.sira) ? x.sira : null, kaynaklar, model: str(x.model, 120),
    kalite: x.kalite && typeof x.kalite === "object" ? x.kalite : null,
    yayinda: x.yayinda !== false,
  };
  if (tarih) row.tarih = tarih;
  // Video alanlari yalniz gonderildiyse yazilir (baska proje sonradan baglar; icerik guncellemesi silmesin)
  if ("video_url" in x) row.video_url = https(x.video_url);
  if ("video_meta" in x) row.video_meta = x.video_meta && typeof x.video_meta === "object" ? x.video_meta : null;
  return row;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "yalniz POST" }, 405);
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return json({ ok: false, error: "kimlik yok" }, 401);
  try {
    const { payload } = await jwtVerify(tok, JWKS, { issuer: ISS, audience: "okul-ingest" });
    const repo = String(payload.repository || "").toLowerCase();
    if (!REPOS.includes(repo) || payload.ref !== "refs/heads/main") return json({ ok: false, error: "izinsiz depo/dal" }, 403);
  } catch (_e) {
    return json({ ok: false, error: "gecersiz kimlik" }, 401);
  }
  let body: any;
  try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "gecersiz JSON" }, 400); }
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length || items.length > 50) return json({ ok: false, error: "1-50 icerik gonderilmeli" }, 400);
  let rows;
  try { rows = items.map(clean); } catch (e) { return json({ ok: false, error: String((e as Error).message) }, 400); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Satir satir: gonderilmeyen sutunlar (tarih, video_url...) guncellemede korunur, toplu upsert'teki null doldurma olmaz
  const slugs: string[] = [], errors: string[] = [];
  for (const row of rows) {
    const { error } = await sb.from("okul_icerik").upsert(row, { onConflict: "slug", defaultToNull: false });
    if (error) errors.push(row.slug + ": " + error.message); else slugs.push(String(row.slug));
  }
  return json({ ok: errors.length === 0, upserted: slugs.length, slugs, errors }, errors.length && !slugs.length ? 500 : 200);
});
