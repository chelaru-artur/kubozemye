import { Game } from './game.js';
import './style.css';

const canvas = document.getElementById('game');
try {
  window.game = new Game(canvas);
} catch (error) {
  console.error(error);
  const fatal = document.getElementById('fatal');
  fatal.hidden = false;
  fatal.textContent = 'Игре нужна 3D-графика (WebGL), а этот браузер её не дал. Включите аппаратное ускорение или откройте игру в Chrome или Safari.';
}
