'use client';

import { useState } from 'react';
import { soundEngine } from '@/app/lib/soundEngine';

const MAIN_URL = process.env.NEXT_PUBLIC_SOUNDSPA_DEBUG_MAIN_STREAM_URL;
const NOISE_URL = process.env.NEXT_PUBLIC_SOUNDSPA_DEBUG_NOISE_STREAM_URL;

export default function NoiseDebugPage() {
  const [noisePercent, setNoisePercent] = useState(50);

  const handlePlayMain = () => {
    if (!MAIN_URL) return;
    soundEngine.playChannel('debug-main', MAIN_URL);
  };

  const handleStopMain = () => {
    soundEngine.stopChannel();
  };

  const handlePlayNoise = () => {
    if (!NOISE_URL) return;
    soundEngine.setNoise('forest', NOISE_URL);
  };

  const handleStopNoise = () => {
    soundEngine.stopNoise();
  };

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setNoisePercent(next);
    soundEngine.setNoiseVolume(next / 100);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-widest text-slate-500">
            Sound Spa / Debug
          </p>
          <h1 className="text-2xl font-semibold">
            Noise engine test
          </h1>
          <p className="text-sm text-slate-400">
            Кнопки ниже напрямую вызывают soundEngine (Howler).
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Main stream</h2>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
              Howler html5
            </span>
          </div>
          <p className="text-xs text-slate-500 break-all">
            URL: {MAIN_URL ?? 'env not set'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handlePlayMain}
              className="rounded-xl bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400"
            >
              ▶ Play main
            </button>
            <button
              type="button"
              onClick={handleStopMain}
              className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              ■ Stop main
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Noise channel</h2>
            <span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs text-sky-300">
              Loop + volume
            </span>
          </div>
          <p className="text-xs text-slate-500 break-all">
            URL: {NOISE_URL ?? 'env not set'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handlePlayNoise}
              className="rounded-xl bg-sky-500/90 px-4 py-3 text-sm font-semibold text-sky-950 shadow-lg shadow-sky-500/30 transition hover:bg-sky-400"
            >
              🌲 Forest noise
            </button>
            <button
              type="button"
              onClick={handleStopNoise}
              className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              ■ Stop noise
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Noise volume</span>
              <span className="font-mono text-slate-300">{noisePercent}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={noisePercent}
              onChange={handleVolumeChange}
              className="w-full accent-sky-400"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
