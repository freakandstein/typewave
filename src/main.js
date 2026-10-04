import { start } from './app.js';

start({
  canvas: document.getElementById('scene'),
  hudRoot: document.getElementById('hud'),
  reportCanvas: document.getElementById('report'),
  panel: document.getElementById('panel'),
  win: window,
});
