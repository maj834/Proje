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
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Haber botu (maj834/haber): botun puanladığı hisse/petrol haberleri ve uygulamada bakılan hisseler.
-- Bot aynı hesapla giriş yapar (GitHub Secrets: SUPABASE_EMAIL / SUPABASE_PASSWORD), yalnızca kendi satırlarını görür.
create table if not exists public.news (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  uid text not null,                                     -- haber kimliği (tekrar yazılmaz)
  ts timestamptz not null default now(),                 -- yayın zamanı
  created_at timestamptz not null default now(),
  kind text not null default 'hisse',                    -- hisse | petrol
  symbols text[] not null default '{}',                  -- ilgili BIST kodları
  title text not null,
  summary text, reason text, effect text, topic text, source text, url text,
  score smallint,                                        -- -5..+5 (hisse için yön; petrol haberinde petrol yönü)
  importance smallint,                                   -- 1..5
  unique (user_id, uid)
);
create index if not exists news_symbols_gin on public.news using gin (symbols);
create index if not exists news_user_ts on public.news (user_id, ts desc);

create table if not exists public.watchlist (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9]{2,8}$'),
  name text,
  last_seen timestamptz not null default now(),
  primary key (user_id, symbol)
);

alter table public.news enable row level security;
alter table public.watchlist enable row level security;
drop policy if exists "own rows" on public.news;
drop policy if exists "own rows" on public.watchlist;
create policy "own rows" on public.news for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.watchlist for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.news, public.watchlist from anon;
grant select, insert, delete on public.news to authenticated;
grant select, insert, update, delete on public.watchlist to authenticated;

-- Sonuç ölçümü (haber botu doldurur): sinyalin ve haberin sonrasında fiyat ne yaptı
alter table public.signals add column if not exists ret_1h real, add column if not exists ret_1d real,
  add column if not exists ret_5d real, add column if not exists evaluated_at timestamptz;
alter table public.news add column if not exists react_1h real, add column if not exists react_1d real,
  add column if not exists evaluated_at timestamptz;
grant update on public.signals to authenticated;
grant update on public.news to authenticated;
create index if not exists signals_pending on public.signals (user_id, ts) where evaluated_at is null;
create index if not exists news_pending on public.news (user_id, ts) where evaluated_at is null;

-- Günlük AKD arşivi (uygulama yazar): hisse + gün + taraf + kurum başına günün son durumu
create table if not exists public.akd_daily (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null, symbol text not null, side text not null check (side in ('buy','sell')), broker text not null,
  net bigint, cost real, pct real, updated_at timestamptz not null default now(),
  primary key (user_id, day, symbol, side, broker)
);
create index if not exists akd_daily_sym on public.akd_daily (user_id, symbol, day desc);

-- Şirket takvimi (haber botu yazar): temettü, bedelsiz/bedelli, genel kurul, bilanço, halka arz
create table if not exists public.calendar_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  uid text not null, day date not null, symbol text, kind text not null, title text not null, url text,
  created_at timestamptz not null default now(), unique (user_id, uid)
);
create index if not exists calendar_sym_day on public.calendar_events (user_id, symbol, day);

alter table public.akd_daily enable row level security;
alter table public.calendar_events enable row level security;
drop policy if exists "own rows" on public.akd_daily;
drop policy if exists "own rows" on public.calendar_events;
create policy "own rows" on public.akd_daily for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.calendar_events for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.akd_daily, public.calendar_events from anon;
grant select, insert, update, delete on public.akd_daily to authenticated;
grant select, insert, delete on public.calendar_events to authenticated;

-- Örnek sorgular
-- Hisse başına son 20 sinyal:
--   select ts, symbol, case dir when 1 then 'AL' else 'SAT' end as yon, strength, why from signals order by ts desc limit 20;
-- Bir kurumun son 5 gündeki net akışı:
--   select symbol, sum(net) from flow_log where ts > now() - interval '5 days' group by symbol order by 2 desc;
-- Baskı ortalaması (hisse, gün):
--   select symbol, date_trunc('day', ts) d, round(avg(score)) from pressure_log group by 1, 2 order by 2 desc;
