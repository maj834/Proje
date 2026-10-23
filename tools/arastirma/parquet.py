"""CSV parcalarini (veri-seti.js ciktilari) tek parquet dosyasina birlestir. Kullanim: python3 parquet.py cikti.parquet parca1.csv parca2.csv ..."""
import sys, pandas as pd
out, parts = sys.argv[1], sys.argv[2:]
df = pd.concat([pd.read_csv(p, low_memory=False) for p in parts], ignore_index=True)
for c in df.columns:
    if c not in ('s', 'tarih', 'etiket'):
        df[c] = pd.to_numeric(df[c], errors='coerce').astype('float32' if c not in ('gun',) else 'int32')
df = df.sort_values(['tarih', 's']).reset_index(drop=True)
df.to_parquet(out, index=False)
print(out, df.shape, df['tarih'].min(), df['tarih'].max(), df['s'].nunique())
