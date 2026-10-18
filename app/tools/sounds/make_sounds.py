"""Housefi's interface sounds, synthesised from scratch (no samples, no third-party audio).

One family of soft, glassy tones in E major, the same "voice" for every moment, mixed quiet enough to sit under
speech and music:
  success  three rising notes (E5, B5, E6)          booking confirmed, payment done, job completed
  notify   two gentle notes (A5, E6)                a quote is ready, the technician is on the way
  offer    a bright marimba ring, about 2 seconds   a new job offer for the technician
  cash     two coin-like taps with a shimmer        cash received
  error    two rounded notes falling (E5, C5)       something did not work; never harsh
  send     a short airy rise                        something was sent
  pop      a small bubble                           something started or was picked

Usage: python3 tools/sounds/make_sounds.py   (needs numpy; writes assets/sounds/*.wav, 44.1 kHz 16-bit mono)
"""
import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sounds')
rng = np.random.default_rng(9)  # fixed seed: the same files on every run


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def envelope(n, attack, decay):
    """Linear attack, then exponential decay with time constant `decay` seconds."""
    t = np.arange(n) / SR
    env = np.exp(-np.maximum(0, t - attack) / decay)
    a = int(SR * attack)
    if a > 0:
        env[:a] *= np.linspace(0, 1, a)
    return env


def tone(f, dur, partials, attack=0.004, decay=0.25):
    """A note from (ratio, level, decay factor) partials: glassy or marimba-like depending on the ratios."""
    t = t_axis(dur)
    out = np.zeros_like(t)
    for ratio, level, dk in partials:
        out += level * np.sin(2 * np.pi * f * ratio * t) * envelope(len(t), attack, decay * dk)
    return out


GLASS = [(1, 1.0, 1.0), (2.0, 0.22, 0.55), (2.76, 0.10, 0.3), (5.4, 0.03, 0.15)]
MARIMBA = [(1, 1.0, 1.0), (3.93, 0.32, 0.25), (9.2, 0.06, 0.1)]
COIN = [(1, 1.0, 1.0), (2.52, 0.5, 0.6), (4.1, 0.3, 0.4), (6.7, 0.14, 0.25)]
SOFT = [(1, 1.0, 1.0), (2.0, 0.12, 0.6), (3.0, 0.08, 0.5)]


def place(total, parts):
    """Mixes (start seconds, signal) into one buffer `total` seconds long."""
    out = np.zeros(int(SR * total))
    for start, sig in parts:
        i = int(SR * start)
        n = min(len(sig), len(out) - i)
        out[i:i + n] += sig[:n]
    return out


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def room(x, mix=0.14):
    """A small, soft room (Schroeder: four combs into two all-passes) so the tones don't sound dry or synthetic."""
    wet = np.zeros(len(x) + int(SR * 0.4))
    src = np.concatenate([x, np.zeros(len(wet) - len(x))])
    for delay_ms, g in [(29.7, 0.72), (37.1, 0.7), (41.1, 0.68), (43.7, 0.66)]:
        d = int(SR * delay_ms / 1000)
        buf = src.copy()
        for i in range(d, len(buf)):
            buf[i] += g * buf[i - d]
        wet += buf
    wet /= 4
    for delay_ms, g in [(5.0, 0.7), (1.7, 0.7)]:
        d = int(SR * delay_ms / 1000)
        y = np.zeros_like(wet)
        for i in range(len(wet)):
            xd = wet[i - d] if i >= d else 0.0
            yd = y[i - d] if i >= d else 0.0
            y[i] = -g * wet[i] + xd + g * yd
        wet = y
    wet = lowpass(wet, 5000)
    return src * (1 - mix) + wet * mix


def finish(x, peak_db=-3.0, tail=0.02):
    """Trims the silent end, fades out, and levels to `peak_db`."""
    level = np.abs(x)
    last = np.nonzero(level > 2e-3 * level.max())[0][-1]
    x = x[:last + 1]
    fade = int(SR * tail)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x / np.abs(x).max() * 10 ** (peak_db / 20)


def sweep_noise(dur, f0, f1, q=6.0):
    """Noise through a band-pass whose centre glides from f0 to f1 (state-variable filter)."""
    n = int(SR * dur)
    noise = rng.standard_normal(n)
    low = band = 0.0
    out = np.empty(n)
    for i in range(n):
        fc = f0 * (f1 / f0) ** (i / n)
        f = 2 * np.sin(np.pi * fc / SR)
        high = noise[i] - low - band / q
        band += f * high
        low += f * band
        out[i] = band
    return out


C5, E5, GS5, A5, B5, E6, GS6, G6 = 523.25, 659.25, 830.61, 880.0, 987.77, 1318.51, 1661.22, 1567.98


def success():
    notes = [(0.0, E5, 0.8), (0.085, B5, 0.8), (0.17, E6, 1.0)]
    x = place(1.4, [(s, lv * tone(f, 1.2, GLASS, decay=0.32 if f == E6 else 0.2)) for s, f, lv in notes])
    return finish(room(lowpass(x, 9000), 0.16), -3.5)


def notify():
    x = place(1.0, [(0.0, 0.85 * tone(A5, 0.9, GLASS, decay=0.18)), (0.11, tone(E6, 0.9, GLASS, decay=0.26))])
    return finish(room(lowpass(x, 8000), 0.14), -4.5)


def offer():
    pattern = [E6, B5, GS5, B5, E6, GS6]
    parts = []
    for rep in range(2):
        for k, f in enumerate(pattern):
            start = rep * 0.95 + k * 0.11
            parts.append((start, tone(f, 0.6, MARIMBA, attack=0.002, decay=0.12) + 0.35 * tone(f / 2, 0.6, MARIMBA, attack=0.002, decay=0.12)))
    x = place(2.2, parts)
    return finish(room(lowpass(x, 10000), 0.12), -1.5)


def cash():
    click = sweep_noise(0.03, 5000, 7000, q=2.0) * envelope(int(SR * 0.03), 0.001, 0.008)
    hit1 = tone(1760.0, 0.6, COIN, attack=0.001, decay=0.12)
    hit2 = tone(2349.3, 0.8, COIN, attack=0.001, decay=0.22)
    shimmer = sweep_noise(0.5, 5000, 7000, q=10.0) * envelope(int(SR * 0.5), 0.05, 0.1) * 0.06
    x = place(1.0, [(0.0, 0.25 * click), (0.004, 0.7 * hit1), (0.09, 0.15 * click), (0.094, hit2), (0.1, shimmer)])
    return finish(room(lowpass(x, 7500), 0.12), -4.0)


def error():
    # Low enough to sound like 'no', high enough for a phone speaker (which drops most sound under ~400 Hz).
    x = place(0.6, [(0.0, tone(E5, 0.3, SOFT, attack=0.006, decay=0.09)), (0.13, tone(C5, 0.4, SOFT, attack=0.006, decay=0.12))])
    return finish(room(lowpass(x, 3000), 0.1), -5.0)


def send():
    air = sweep_noise(0.2, 700, 2600, q=3.0) * np.sin(np.linspace(0, np.pi, int(SR * 0.2))) ** 2
    blip = tone(G6, 0.25, GLASS, attack=0.003, decay=0.05)
    x = place(0.5, [(0.0, 0.5 * air), (0.15, 0.35 * blip)])
    return finish(room(lowpass(x, 7000), 0.1), -7.0)


def pop():
    t = t_axis(0.09)
    f = 600 + 800 * (1 - np.exp(-t / 0.018))  # quick upward glide, like a bubble
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) * envelope(len(t), 0.002, 0.03)
    return finish(room(lowpass(x, 6000), 0.06), -7.0)


def write(name, x):
    data = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    with wave.open(os.path.join(OUT, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)
    print(f'{name}.wav  {len(x) / SR:.2f} s')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for fn in (success, notify, offer, cash, error, send, pop):
        write(fn.__name__, fn())
