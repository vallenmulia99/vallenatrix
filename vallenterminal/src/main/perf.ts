import { setTimeout as delay } from 'node:timers/promises';

export interface PerfSample {
  cpuPercent: number;
  rssBytes: number;
}

export function formatPerf(sample: PerfSample): string {
  return `App process only — CPU: ${sample.cpuPercent.toFixed(1)}%; RSS: ${(sample.rssBytes / 1024 / 1024).toFixed(1)} MiB (GPU/compositor excluded)`;
}

export async function measurePerf(durationMs = 1000): Promise<PerfSample> {
  const duration = Math.max(1, Math.min(5000, Math.floor(durationMs)));
  const cpuStart = process.cpuUsage();
  const wallStart = process.hrtime.bigint();
  await delay(duration);
  const cpu = process.cpuUsage(cpuStart);
  const elapsedUs = Number(process.hrtime.bigint() - wallStart) / 1000;
  const cpuPercent = ((cpu.user + cpu.system) / elapsedUs) * 100;
  return { cpuPercent, rssBytes: process.memoryUsage().rss };
}
