#!/usr/bin/env python3
"""Koloni ses efektlerini prosedurel uretir (yalnizca standart kutuphane).

Calistirma: python3 tools/gen_audio.py  ->  audio/*.wav (22.05 kHz, mono, 16 bit)
Sesleri degistirmek icin bu betigi duzenleyip yeniden calistirin.
"""
import math
import os
import random
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "audio")


def write(name, samples, peak=0.9):
    m = max(1e-9, max(abs(s) for s in samples))
    data = b"".join(struct.pack("<h", int(s / m * peak * 32767)) for s in samples)
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)


def env(t, attack, decay):
    return min(1.0, t / attack) * math.exp(-t / decay) if attack > 0 else math.exp(-t / decay)


def pickup():
    # Kisa, kuru "tik": yuksek frekansli tik + minik rezonans
    n = int(RATE * 0.09)
    out = []
    for i in range(n):
        t = i / RATE
        s = math.sin(2 * math.pi * 2400 * t) * env(t, 0.001, 0.012)
        s += 0.5 * math.sin(2 * math.pi * 1300 * t) * env(t, 0.001, 0.03)
        out.append(s)
    write("pickup.wav", out, 0.6)


def drop():
    # Yumusak toprak "tup": dusen perde + filtreli gurultu
    rnd = random.Random(2)
    n = int(RATE * 0.35)
    out, lp = [], 0.0
    for i in range(n):
        t = i / RATE
        f = 180 * math.exp(-t * 9) + 60
        s = math.sin(2 * math.pi * f * t) * env(t, 0.003, 0.09)
        lp += (rnd.uniform(-1, 1) - lp) * 0.08
        s += lp * 2.0 * env(t, 0.002, 0.05)
        out.append(s)
    write("drop.wav", out, 0.8)


def bite():
    # Orumcek isirigi: kisa, kuru citirti (dusuk gecisli gurultu patlamalari)
    rnd = random.Random(5)
    n = int(RATE * 0.22)
    out, lp = [], 0.0
    for i in range(n):
        t = i / RATE
        lp += (rnd.uniform(-1, 1) - lp) * 0.35
        crack = 1.0 if (int(t * 60) % 3 == 0) else 0.4
        out.append(lp * crack * env(t, 0.001, 0.06) + 0.4 * math.sin(2 * math.pi * 95 * t) * env(t, 0.002, 0.05))
    write("bite.wav", out, 0.8)


def warn():
    # Tehlike: alcak, yavas yukselen iki notali boru
    n = int(RATE * 1.6)
    out = []
    for i in range(n):
        t = i / RATE
        f = 110 if t < 0.7 else 103.8
        e = min(1.0, t / 0.25) * math.exp(-max(0.0, t - 0.7) / 0.4)
        s = math.sin(2 * math.pi * f * t) + 0.45 * math.sin(2 * math.pi * f * 2 * t) + 0.2 * math.sin(2 * math.pi * f * 3 * t)
        out.append(s * e)
    write("warn.wav", out, 0.7)


def buy():
    # Tahta tik + kisa yukselen ton
    n = int(RATE * 0.25)
    out = []
    for i in range(n):
        t = i / RATE
        s = math.sin(2 * math.pi * 520 * t) * env(t, 0.001, 0.02)
        s += 0.6 * math.sin(2 * math.pi * (660 + 800 * t) * t) * env(t, 0.01, 0.08)
        out.append(s)
    write("buy.wav", out, 0.7)


def chime(name, freqs, length, gap):
    n = int(RATE * length)
    out = [0.0] * n
    for k, f in enumerate(freqs):
        start = int(k * gap * RATE)
        for i in range(start, n):
            t = (i - start) / RATE
            e = env(t, 0.004, 0.35)
            out[i] += e * (math.sin(2 * math.pi * f * t) + 0.3 * math.sin(2 * math.pi * f * 2.01 * t))
    write(name, out, 0.7)


def ambient_day():
    # Ruzgar/yaprak hisirtisi: iki kademeli suzulmus gurultu, yavas genlik dalgasi. Dongusel.
    rnd = random.Random(7)
    n = int(RATE * 6.0)
    out, a, b = [], 0.0, 0.0
    for i in range(n):
        t = i / RATE
        w = rnd.uniform(-1, 1)
        a += (w - a) * 0.04
        b += (a - b) * 0.3
        gust = 0.6 + 0.4 * math.sin(2 * math.pi * t / 6.0) ** 2
        rustle = (w - a) * 0.15 * max(0.0, math.sin(2 * math.pi * t / 3.0 + 1.0)) ** 4
        out.append(b * 3.0 * gust + rustle)
    _crossfade_loop(out)
    write("ambient_day.wav", out, 0.5)


def ambient_night():
    # Cirdir bocekleri: 4.6 kHz civilti darbeleri, rastgele ritim + hafif ruzgar. Dongusel.
    rnd = random.Random(11)
    n = int(RATE * 6.0)
    out = [0.0] * n
    for voice in range(3):
        f = 4300 + voice * 260
        t0 = rnd.uniform(0, 0.4)
        while t0 < 5.6:
            for pulse in range(3):
                ps = t0 + pulse * 0.045
                for i in range(int(ps * RATE), min(n, int((ps + 0.03) * RATE))):
                    t = i / RATE - ps
                    out[i] += 0.35 * math.sin(2 * math.pi * f * t) * math.sin(math.pi * t / 0.03)
            t0 += rnd.uniform(0.45, 0.9)
    a = 0.0
    for i in range(n):
        a += (rnd.uniform(-1, 1) - a) * 0.02
        out[i] += a * 1.2
    _crossfade_loop(out)
    write("ambient_night.wav", out, 0.45)


def _crossfade_loop(out, seconds=0.5):
    k = int(RATE * seconds)
    for i in range(k):
        w = i / k
        out[i] = out[i] * w + out[len(out) - k + i] * (1 - w)
    del out[len(out) - k :]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    pickup()
    drop()
    bite()
    warn()
    buy()
    chime("birth.wav", [880, 1318.5], 0.7, 0.07)
    chime("discover.wav", [659.3, 880, 1108.7], 1.0, 0.09)
    chime("milestone.wav", [523.3, 659.3, 784, 1046.5], 1.6, 0.12)
    ambient_day()
    ambient_night()
    print("Sesler uretildi:", sorted(os.listdir(OUT)))
