// ─────────────────────────────────────────────
// useWaveCanvas — анимация столбиков на canvas
// Точная копия логики из sound_spa_player.html
// ─────────────────────────────────────────────
import { useEffect, useRef } from 'react';

export function useWaveCanvas(playing: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef({ playing: false, animId: 0, t: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 280, H = 60;
    canvas.width  = W;
    canvas.height = H;

    const BAR_COUNT = 46;
    const GAP       = 2;
    const BAR_W     = (W - (BAR_COUNT - 1) * GAP) / BAR_COUNT;
    const barColor  = { r: 100, g: 190, b: 255 };

    // Случайная огибающая — генерируется один раз
    const baseAmp: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const x   = i / (BAR_COUNT - 1);
      const env = Math.sin(x * Math.PI) * 0.75 + 0.25;
      baseAmp.push(env * (0.55 + Math.random() * 0.45));
    }

    const currentAmp = new Array(BAR_COUNT).fill(0);
    const targetAmp  = new Array(BAR_COUNT).fill(0);
    const s = stateRef.current;

    function drawFrame() {
      ctx!.clearRect(0, 0, W, H);
      const midY = H / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        currentAmp[i] += (targetAmp[i] - currentAmp[i]) * 0.12;
        const amp    = currentAmp[i];
        const halfH  = amp * (H * 0.44);
        const x      = i * (BAR_W + GAP);
        const y      = midY - halfH;
        const h      = halfH * 2;
        if (h < 0.5) continue;

        const { r, g, b } = barColor;
        const grad = ctx!.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0,   `rgba(${r},${g},${b},0.05)`);
        grad.addColorStop(0.3, `rgba(${r},${g},${b},0.7)`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},1.0)`);
        grad.addColorStop(0.7, `rgba(${r},${g},${b},0.7)`);
        grad.addColorStop(1,   `rgba(${r},${g},${b},0.05)`);

        ctx!.fillStyle = grad;
        ctx!.beginPath();
        (ctx as any).roundRect(x, y, BAR_W, h, BAR_W / 2);
        ctx!.fill();

        ctx!.shadowColor = `rgba(${r},${g},${b},0.35)`;
        ctx!.shadowBlur  = 6;
        ctx!.fillStyle   = grad;
        ctx!.beginPath();
        (ctx as any).roundRect(x, y, BAR_W, h, BAR_W / 2);
        ctx!.fill();
        ctx!.shadowBlur  = 0;
      }
    }

    function updateTargets() {
      s.t += 0.04;
      for (let i = 0; i < BAR_COUNT; i++) {
        if (!s.playing) { targetAmp[i] = 0; continue; }
        const wave =
          Math.sin(s.t * 1.3  + i * 0.38) * 0.35 +
          Math.sin(s.t * 2.1  + i * 0.22) * 0.25 +
          Math.sin(s.t * 0.7  + i * 0.55) * 0.20 +
          Math.sin(s.t * 3.5  + i * 0.15) * 0.10 +
          Math.sin(s.t * 0.45 + i * 0.70) * 0.10;
        const norm = (wave + 1) / 2;
        targetAmp[i] = baseAmp[i] * (0.3 + norm * 0.7);
      }
    }

    function loop() {
      updateTargets();
      drawFrame();
      s.animId = requestAnimationFrame(loop);
    }

    loop();

    return () => cancelAnimationFrame(s.animId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Обновляем флаг playing без перезапуска loop
  useEffect(() => {
    stateRef.current.playing = playing;
  }, [playing]);

  return canvasRef;
}
