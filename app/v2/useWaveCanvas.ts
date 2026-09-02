import { useEffect, useRef } from "react";

export function useWaveCanvas(playing: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ playing: false, animationId: 0, time: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = 280, height = 60, barCount = 46, gap = 2;
    const barWidth = (width - (barCount - 1) * gap) / barCount;
    const baseAmplitude = Array.from({ length: barCount }, (_, index) => {
      const x = index / (barCount - 1);
      return (Math.sin(x * Math.PI) * 0.75 + 0.25) * (0.55 + Math.random() * 0.45);
    });
    const currentAmplitude = new Array(barCount).fill(0);
    const targetAmplitude = new Array(barCount).fill(0);
    const state = stateRef.current;
    canvas.width = width;
    canvas.height = height;

    const animate = () => {
      state.time += 0.04;
      context.clearRect(0, 0, width, height);
      for (let index = 0; index < barCount; index += 1) {
        if (!state.playing) targetAmplitude[index] = 0;
        else {
          const wave = Math.sin(state.time * 1.3 + index * 0.38) * 0.35 + Math.sin(state.time * 2.1 + index * 0.22) * 0.25 + Math.sin(state.time * 0.7 + index * 0.55) * 0.2 + Math.sin(state.time * 3.5 + index * 0.15) * 0.1 + Math.sin(state.time * 0.45 + index * 0.7) * 0.1;
          targetAmplitude[index] = baseAmplitude[index] * (0.3 + ((wave + 1) / 2) * 0.7);
        }
        currentAmplitude[index] += (targetAmplitude[index] - currentAmplitude[index]) * 0.12;
        const halfHeight = currentAmplitude[index] * (height * 0.44);
        const x = index * (barWidth + gap), y = height / 2 - halfHeight, barHeight = halfHeight * 2;
        if (barHeight < 0.5) continue;
        const gradient = context.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, "rgba(100,190,255,0.05)"); gradient.addColorStop(0.3, "rgba(100,190,255,0.7)"); gradient.addColorStop(0.5, "rgba(100,190,255,1)"); gradient.addColorStop(0.7, "rgba(100,190,255,0.7)"); gradient.addColorStop(1, "rgba(100,190,255,0.05)");
        context.fillStyle = gradient;
        context.shadowColor = "rgba(100,190,255,0.35)";
        context.shadowBlur = 6;
        context.beginPath(); context.roundRect(x, y, barWidth, barHeight, barWidth / 2); context.fill(); context.shadowBlur = 0;
      }
      state.animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(state.animationId);
  }, []);

  useEffect(() => { stateRef.current.playing = playing; }, [playing]);
  return canvasRef;
}
