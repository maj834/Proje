-- Grafik Okuyucu: Supabase şeması
-- Supabase panelinde SQL Editor'e yapıştırıp bir kez çalıştır.
-- Her satır giriş yapan kullanıcıya aittir (user_id = auth.uid()); anon anahtarla giriş yapmadan okunamaz/yazılamaz.

create table if not exists public.signals (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ts         timestamptz not null default now(),
  symbol     text not null,
  timeframe  text,
  dir        smallint not null check (dir in (-1, 1)),   -- 1 = AL, -1 = SAT
  strength   real,
  source     text,                                       -- yerel | claude
  why        text[],
  score      integer,                                    -- teknik görünüm skoru
  pressure   integer,                                    -- al/sat baskısı
  rr         real,                                       -- risk/ödül
  price      real
);

create table if not exists public.pressure_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ts         timestamptz not null default now(),
  symbol     text not null,
  score      integer not null,
  parts      jsonb,
  trend_dir  smallint
);

create table if not exists public.flow_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ts         timestamptz not null default now(),
  symbol     text not null,
  net        bigint,                                     -- alıcılar - satıcılar (lot)
  top_name   text,
  top_net    bigint,
  top_cost   real
);

create table if not exists public.alarms (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ts         timestamptz not null default now(),
  symbol     text,
  price      real,
  direction  text
);

create index if not exists signals_user_sym_ts      on public.signals      (user_id, symbol, ts desc);
create index if not exists pressure_user_sym_ts     on public.pressure_log (user_id, symbol, ts desc);
create index if not exists flow_user_sym_ts         on public.flow_log     (user_id, symbol, ts desc);
create index if not exists alarms_user_ts           on public.alarms       (user_id, ts desc);

-- Row Level Security: yalnızca kendi satırların.
do $$
declare t text;
begin
  foreach t in array array['signals','pressure_log','flow_log','alarms'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Örnek sorgular
-- Hisse başına son 20 sinyal:
--   select ts, symbol, case dir when 1 then 'AL' else 'SAT' end as yon, strength, why from signals order by ts desc limit 20;
-- Bir kurumun son 5 gündeki net akışı:
--   select symbol, sum(net) from flow_log where ts > now() - interval '5 days' group by symbol order by 2 desc;
-- Baskı ortalaması (hisse, gün):
--   select symbol, date_trunc('day', ts) d, round(avg(score)) from pressure_log group by 1, 2 order by 2 desc;
