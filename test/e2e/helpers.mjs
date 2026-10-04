import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PY = path.join(ROOT, '.venv/bin/python');

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const liveProcs = new Set();
process.on('exit', () => { for (const p of liveProcs) p.kill(); });

export async function startBridge(port, { listener = false } = {}) {
  const args = ['-m', 'bridge.bridge', '--port', String(port)];
  if (!listener) args.push('--no-listener');
  const proc = spawn(PY, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  liveProcs.add(proc);
  proc.once('exit', () => liveProcs.delete(proc));
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    try { const r = await fetch(`${base}/status`); if (r.ok) break; } catch { /* belum siap */ }
    if (Date.now() > deadline) { proc.kill(); throw new Error('bridge tidak siap:\n' + out); }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    proc, port, base,
    logs: () => out,
    stop: () => new Promise((resolve) => { if (proc.exitCode !== null) return resolve(); proc.once('exit', resolve); proc.kill(); }),
  };
}

// Sumber EEG mandiri dengan streamer Muse palsu (python -m eeg --fake). State (pidfile, cache alamat) di folder sementara.
export async function startEeg(bridgePort, { profile = 'mixed', warmup = 1, extra = [] } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typewave-eeg-'));
  const args = ['-m', 'eeg', '--fake', profile, '--warmup', String(warmup), '--bridge', `ws://127.0.0.1:${bridgePort}/ws`, '--state-dir', stateDir, ...extra];
  const proc = spawn(PY, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  liveProcs.add(proc);
  proc.once('exit', () => liveProcs.delete(proc));
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const streamerPid = () => {
    try { return Number(fs.readFileSync(path.join(stateDir, '.streamer.pid'), 'utf8').trim()) || null; } catch { return null; }
  };
  return {
    proc, stateDir, streamerPid, logs: () => out,
    stop: async () => {
      if (proc.exitCode === null) {
        await new Promise((resolve) => {
          const t = setTimeout(() => proc.kill('SIGKILL'), 15000);
          proc.once('exit', () => { clearTimeout(t); resolve(); });
          proc.kill('SIGINT');  // berhenti bersih: streamer ikut dimatikan
        });
      }
      const orphan = streamerPid();  // pidfile hanya tersisa bila berhenti tidak bersih
      if (orphan) { try { process.kill(orphan, 'SIGKILL'); } catch { /* sudah mati */ } }
      fs.rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

export const launch = (opts = {}) => chromium.launch({ headless: true, ...opts });

export function runInject(port, extra = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(PY, ['tools/inject.py', '--url', `ws://127.0.0.1:${port}/ws`, ...extra], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error('inject gagal:\n' + out))));
  });
}

// Membuka halaman, mengumpulkan error konsol, dan menunggu API debug siap.
export async function openPage(browser, url, { viewport = { width: 1280, height: 720 }, waitHello = true } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__typewave);
  if (waitHello) await page.waitForFunction(() => window.__typewave.stats.helloCount > 0);
  return { page, errors };
}
