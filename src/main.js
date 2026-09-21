const FOV = Math.PI / 3;
const HALF_FOV = FOV / 2;
const MAX_VIEW_DISTANCE = 20;
const PLAYER_RADIUS = 0.22;
const TURN_SPEED = 2.8;
const MOUSE_SENSITIVITY = 0.0021;
const ENEMY_RADIUS = 0.24;
const PICKUP_RADIUS = 0.28;
const PROJECTILE_RADIUS = 0.08;
const STATS_KEY = "iron-depths-stats-v1";
const CUSTOM_LEVEL_KEY = "iron-depths-custom-level-v1";

// These source sheets are supplied alongside the prototype.  The crops below are
// deliberately small, usable pieces of each sheet rather than a hidden remake of DOOM.
const doomArt = {
  ready: false,
  enemy: null,
  projectile: null,
  pickup: null,
  face: null,
  weapons: [],
  sky: null
};

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function spriteCrop(source, x, y, width, height, chromaKey = true) {
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const surfaceCtx = surface.getContext("2d", { willReadFrequently: chromaKey });
  surfaceCtx.drawImage(source, x, y, width, height, 0, 0, width, height);
  if (chromaKey) {
    const pixels = surfaceCtx.getImageData(0, 0, width, height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      // Sprite sheets use bright cyan or blue as their backing color.
      if ((green > 150 && blue > 150 && red < 80) || (blue > 190 && red < 90 && green < 130)) {
        pixels.data[index + 3] = 0;
      }
    }
    surfaceCtx.putImageData(pixels, 0, 0);
  }
  return surface;
}

async function loadDoomArt() {
  try {
    const [weapons, lostSoul, face, effects, skies] = await Promise.all([
      loadImage("./assets/doom/weapons.png"),
      loadImage("./assets/doom/lost-soul.png"),
      loadImage("./assets/doom/marine-face.png"),
      loadImage("./assets/doom/effects.png"),
      loadImage("./assets/doom/skies.png")
    ]);
    doomArt.enemy = spriteCrop(lostSoul, 42, 31, 56, 83);
    doomArt.projectile = spriteCrop(effects, 0, 16, 45, 40);
    doomArt.pickup = spriteCrop(pickups, 2, 39, 112, 27);
    doomArt.face = spriteCrop(face, 8, 13, 142, 352, false);
    doomArt.weapons = [
      spriteCrop(weapons, 1090, 40, 145, 105),
      spriteCrop(weapons, 210, 154, 300, 162),
      spriteCrop(weapons, 944, 350, 230, 126)
    ];
    doomArt.sky = spriteCrop(skies, 259, 0, 258, 130, false);
    doomArt.ready = true;
  } catch (error) {
    console.warn("Doom art could not be loaded; using the fallback renderer.", error);
  }
}

const defaultLevel = {
  name: "Facility Run",
  map: [
    "################",
    "#S.M..L....A.H.#",
    "#.###.###.###..#",
    "#...#.....#....#",
    "#.K.#.###.#.##.#",
    "#...#...#.#.R..#",
    "###.###.#.####.#",
    "#..M..#.#....#.#",
    "#.###.#.####.#.#",
    "#.#...#....#.#.#",
    "#.#.######.#.#.#",
    "#.#......#.#...#",
    "#.######.#.###.#",
    "#......M...D.ME#",
    "################"
  ]
};

const tilePalette = [
  { char: "#", label: "Wall", hint: "Solid block" },
  { char: ".", label: "Floor", hint: "Walkable tile" },
  { char: "S", label: "Spawn", hint: "Player start" },
  { char: "E", label: "Exit", hint: "Mission finish" },
  { char: "D", label: "Door", hint: "Usable door" },
  { char: "L", label: "Locked", hint: "Needs keycard" },
  { char: "M", label: "Enemy", hint: "Lost Soul" },
  { char: "A", label: "Ammo", hint: "Ammo cache" },
  { char: "H", label: "Med", hint: "Health pickup" },
  { char: "R", label: "Armor", hint: "Armor pickup" },
  { char: "K", label: "Key", hint: "Amber keycard" }
];

const colors = {
  wall: { "#": "#60708a", D: "#7d6a58", L: "#dfb24b" },
  ceiling: "#0a111b",
  enemyHit: "#fff3b0",
  pickup: {
    ammo: "#84d976",
    med: "#72d0ff",
    key: "#ffd056",
    armor: "#a691ff",
    exit: "#8ee29c"
  },
  projectile: "#ffd3a6",
  doorLocked: "#e5b449",
  doorOpen: "#44515f",
  doorClosed: "#7d6a58",
  damage: "#ff5d5d"
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const refs = {
  uiLayer: document.getElementById("uiLayer"),
  pauseHint: document.getElementById("pauseHint"),
  screens: {
    home: document.getElementById("screen-home"),
    stats: document.getElementById("screen-stats"),
    credits: document.getElementById("screen-credits"),
    editor: document.getElementById("screen-editor"),
    pause: document.getElementById("screen-pause"),
    result: document.getElementById("screen-result")
  },
  statsGrid: document.getElementById("statsGrid"),
  resultEyebrow: document.getElementById("resultEyebrow"),
  resultTitle: document.getElementById("resultTitle"),
  resultDescription: document.getElementById("resultDescription"),
  toolPalette: document.getElementById("toolPalette"),
  editorGrid: document.getElementById("editorGrid"),
  mapExport: document.getElementById("mapExport"),
  mapNameInput: document.getElementById("mapNameInput"),
  editorMessage: document.getElementById("editorMessage")
};

function createRunStats() {
  return {
    shotsFired: 0,
    enemiesDefeated: 0,
    pickupsCollected: 0,
    customLevel: false
  };
}

function loadStats() {
  const fallback = {
    runsStarted: 0,
    runsWon: 0,
    runsLost: 0,
    enemiesDefeated: 0,
    shotsFired: 0,
    pickupsCollected: 0,
    lastResult: "No missions yet"
  };

  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function cloneLevel(levelData) {
  return {
    name: levelData.name,
    map: [...levelData.map]
  };
}

function validateLevelDefinition(levelData) {
  if (!levelData || !Array.isArray(levelData.map) || levelData.map.length < 5) {
    return { ok: false, message: "Map needs at least 5 rows." };
  }

  const width = levelData.map[0].length;
  const allowed = new Set(["#", ".", "S", "E", "D", "L", "M", "A", "H", "R", "K"]);
  let spawnCount = 0;
  let exitCount = 0;

  for (let y = 0; y < levelData.map.length; y += 1) {
    const row = levelData.map[y];
    if (row.length !== width) {
      return { ok: false, message: "All rows must be the same length." };
    }

    for (let x = 0; x < row.length; x += 1) {
      const cell = row[x];
      if (!allowed.has(cell)) {
        return { ok: false, message: `Unsupported tile "${cell}".` };
      }
      if ((y === 0 || x === 0 || y === levelData.map.length - 1 || x === row.length - 1) && cell !== "#") {
        return { ok: false, message: "Outer border must be sealed with walls." };
      }
      if (cell === "S") {
        spawnCount += 1;
      }
      if (cell === "E") {
        exitCount += 1;
      }
    }
  }

  if (spawnCount !== 1) {
    return { ok: false, message: "Map needs exactly one player spawn." };
  }
  if (exitCount < 1) {
    return { ok: false, message: "Map needs at least one exit." };
  }

  return { ok: true };
}

function loadCustomLevel() {
  try {
    const raw = localStorage.getItem(CUSTOM_LEVEL_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return validateLevelDefinition(parsed).ok ? parsed : null;
  } catch {
    return null;
  }
}

function saveCustomLevel(levelData) {
  localStorage.setItem(CUSTOM_LEVEL_KEY, JSON.stringify(levelData));
}

function levelToGrid(levelData) {
  return levelData.map.map((row) => row.split(""));
}

const stats = loadStats();

const state = {
  mode: "menu",
  activeScreen: "home",
  running: false,
  pointerLocked: false,
  lastTime: 0,
  keys: new Set(),
  message: "Reach the exit lift.",
  win: false,
  currentLevel: cloneLevel(defaultLevel),
  lastPlayedLevel: cloneLevel(defaultLevel),
  player: null,
  doors: [],
  enemies: [],
  pickups: [],
  projectiles: [],
  decals: [],
  weaponIndex: 0,
  runStats: createRunStats(),
  editor: {
    selectedTile: "#",
    grid: levelToGrid(loadCustomLevel() || defaultLevel)
  }
};

const weapons = [
  { name: "Pistol", damage: [12, 18], ammoType: "clips", cooldown: 0.26, pellets: 1, spread: 0.02, range: 10 },
  { name: "Combat Shotgun", damage: [5, 9], ammoType: "shells", cooldown: 0.65, pellets: 7, spread: 0.13, range: 7.2 },
  { name: "Plasma Rifle", damage: [17, 24], ammoType: "cells", cooldown: 0.16, pellets: 1, spread: 0.035, range: 11 }
];

function gridToLevel() {
  return {
    name: refs.mapNameInput.value.trim() || "Custom Facility",
    map: state.editor.grid.map((row) => row.join(""))
  };
}

function createGameState(levelData) {
  const player = {
    x: 1.5,
    y: 1.5,
    angle: 0,
    health: 100,
    armor: 0,
    ammo: { clips: 80, shells: 18, cells: 40 },
    keys: new Set(),
    weaponCooldown: 0,
    hurtTimer: 0
  };

  const doors = [];
  const enemies = [];
  const pickups = [];

  levelData.map.forEach((row, y) => {
    row.split("").forEach((cell, x) => {
      if (cell === "S") {
        player.x = x + 0.5;
        player.y = y + 0.5;
      }
      if (cell === "D" || cell === "L") {
        doors.push({ x, y, open: 0, locked: cell === "L", opening: false });
      }
      if (cell === "A") {
        pickups.push({ x: x + 0.5, y: y + 0.5, type: "ammo" });
      }
      if (cell === "H") {
        pickups.push({ x: x + 0.5, y: y + 0.5, type: "med" });
      }
      if (cell === "K") {
        pickups.push({ x: x + 0.5, y: y + 0.5, type: "key" });
      }
      if (cell === "R") {
        pickups.push({ x: x + 0.5, y: y + 0.5, type: "armor" });
      }
      if (cell === "M") {
        enemies.push({ x: x + 0.5, y: y + 0.5, health: 60, cooldown: 1.2, hitTimer: 0, state: "idle" });
      }
      if (cell === "E") {
        pickups.push({ x: x + 0.5, y: y + 0.5, type: "exit" });
      }
    });
  });

  state.player = player;
  state.doors = doors;
  state.enemies = enemies;
  state.pickups = pickups;
  state.projectiles = [];
  state.decals = [];
  state.weaponIndex = 0;
  state.win = false;
  state.message = "Reach the exit lift.";
  state.runStats = createRunStats();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randRange([min, max]) {
  return min + Math.random() * (max - min);
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  return (angle % tau + tau) % tau;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function mapCell(x, y) {
  const map = state.currentLevel.map;
  if (x < 0 || y < 0 || y >= map.length || x >= map[0].length) {
    return "#";
  }
  return map[y][x];
}

function getDoorAt(x, y) {
  return state.doors.find((door) => door.x === x && door.y === y);
}

function isBlocked(x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cell = mapCell(cellX, cellY);
  if (cell === "#") {
    return true;
  }
  if (cell === "D" || cell === "L") {
    const door = getDoorAt(cellX, cellY);
    return !door || door.open < 0.72;
  }
  return false;
}

function canMoveTo(x, y, radius) {
  const offsets = [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]];
  return offsets.every(([ox, oy]) => !isBlocked(x + ox, y + oy));
}

function tryMove(entity, nextX, nextY, radius) {
  if (canMoveTo(nextX, entity.y, radius)) {
    entity.x = nextX;
  }
  if (canMoveTo(entity.x, nextY, radius)) {
    entity.y = nextY;
  }
}

function castRay(originX, originY, angle, maxDistance = MAX_VIEW_DISTANCE) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  for (let depth = 0; depth < maxDistance; depth += 0.01) {
    const x = originX + cos * depth;
    const y = originY + sin * depth;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const cell = mapCell(cellX, cellY);

    if (cell === "#" || cell === "D" || cell === "L") {
      if (cell === "D" || cell === "L") {
        const door = getDoorAt(cellX, cellY);
        if (door && door.open >= 0.72) {
          continue;
        }
      }
      return { distance: depth, x, y, cell, cellX, cellY };
    }
  }

  return {
    distance: maxDistance,
    x: originX + cos * maxDistance,
    y: originY + sin * maxDistance,
    cell: null,
    cellX: -1,
    cellY: -1
  };
}

function lineOfSight(ax, ay, bx, by) {
  const angle = Math.atan2(by - ay, bx - ax);
  const dist = distance(ax, ay, bx, by);
  const hit = castRay(ax, ay, angle, dist);
  return hit.distance >= dist - 0.05;
}

function openNearbyDoor() {
  const targetX = state.player.x + Math.cos(state.player.angle) * 1.1;
  const targetY = state.player.y + Math.sin(state.player.angle) * 1.1;
  const door = getDoorAt(Math.floor(targetX), Math.floor(targetY));
  if (!door) {
    state.message = "Nothing to use.";
    return;
  }
  if (door.locked && !state.player.keys.has("amber")) {
    state.message = "Amber keycard required.";
    return;
  }
  door.opening = true;
  state.message = door.locked ? "Security door unlocked." : "Door cycling open.";
}

function fireWeapon() {
  const player = state.player;
  const weapon = weapons[state.weaponIndex];
  if (!player || player.weaponCooldown > 0 || state.win) {
    return;
  }
  if (player.ammo[weapon.ammoType] <= 0) {
    state.message = "Click. Out of ammo.";
    return;
  }

  player.ammo[weapon.ammoType] -= 1;
  player.weaponCooldown = weapon.cooldown;
  state.runStats.shotsFired += 1;
  stats.shotsFired += 1;

  let hitSomething = false;
  for (let i = 0; i < weapon.pellets; i += 1) {
    const spread = (Math.random() - 0.5) * weapon.spread;
    const angle = player.angle + spread;
    const wallHit = castRay(player.x, player.y, angle, weapon.range);
    let closestEnemy = null;
    let closestDistance = wallHit.distance;

    for (const enemy of state.enemies) {
      if (enemy.health <= 0) {
        continue;
      }
      const enemyAngle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
      const angleDelta = Math.atan2(Math.sin(enemyAngle - angle), Math.cos(enemyAngle - angle));
      const dist = distance(player.x, player.y, enemy.x, enemy.y);
      const angularRadius = Math.atan2(ENEMY_RADIUS, Math.max(0.001, dist));
      if (Math.abs(angleDelta) <= angularRadius && dist < closestDistance && lineOfSight(player.x, player.y, enemy.x, enemy.y)) {
        closestEnemy = enemy;
        closestDistance = dist;
      }
    }

    if (closestEnemy) {
      closestEnemy.health -= randRange(weapon.damage);
      closestEnemy.hitTimer = 0.18;
      closestEnemy.state = "alert";
      hitSomething = true;
    } else {
      state.decals.push({ x: wallHit.x, y: wallHit.y, ttl: 4 });
    }
  }

  const survivors = [];
  for (const enemy of state.enemies) {
    if (enemy.health > 0) {
      survivors.push(enemy);
      continue;
    }
    state.runStats.enemiesDefeated += 1;
    stats.enemiesDefeated += 1;
    state.message = "Threat neutralized.";
  }
  state.enemies = survivors;
  saveStats();

  if (!hitSomething) {
    state.message = `${weapon.name} fired.`;
  }
}

function updatePlayer(dt) {
  const player = state.player;
  player.weaponCooldown = Math.max(0, player.weaponCooldown - dt);
  player.hurtTimer = Math.max(0, player.hurtTimer - dt);

  let moveX = 0;
  let moveY = 0;
  const walkSpeed = state.keys.has("ShiftLeft") ? 1.9 : 3.1;

  if (state.keys.has("KeyW")) {
    moveX += Math.cos(player.angle) * walkSpeed * dt;
    moveY += Math.sin(player.angle) * walkSpeed * dt;
  }
  if (state.keys.has("KeyS")) {
    moveX -= Math.cos(player.angle) * walkSpeed * dt;
    moveY -= Math.sin(player.angle) * walkSpeed * dt;
  }
  if (state.keys.has("KeyA")) {
    moveX += Math.cos(player.angle - Math.PI / 2) * walkSpeed * dt;
    moveY += Math.sin(player.angle - Math.PI / 2) * walkSpeed * dt;
  }
  if (state.keys.has("KeyD")) {
    moveX += Math.cos(player.angle + Math.PI / 2) * walkSpeed * dt;
    moveY += Math.sin(player.angle + Math.PI / 2) * walkSpeed * dt;
  }
  if (state.keys.has("ArrowLeft")) {
    player.angle -= TURN_SPEED * dt;
  }
  if (state.keys.has("ArrowRight")) {
    player.angle += TURN_SPEED * dt;
  }

  tryMove(player, player.x + moveX, player.y + moveY, PLAYER_RADIUS);
  player.angle = normalizeAngle(player.angle);
}

function endRun(won) {
  state.running = false;
  state.keys.clear();
  document.exitPointerLock?.();
  stats.lastResult = won ? "Extraction complete" : "Run failed";
  if (won) {
    stats.runsWon += 1;
  } else {
    stats.runsLost += 1;
  }
  saveStats();
  renderStats();
  refs.resultEyebrow.textContent = won ? "Mission Success" : "Mission Failed";
  refs.resultTitle.textContent = won ? "Extraction Complete" : "System Failure";
  refs.resultDescription.textContent = won
    ? `Cleared ${state.runStats.enemiesDefeated} hostiles and secured the exit.`
    : "The facility overwhelmed the run. Reset, regroup, and push back in.";
  showScreen("result");
}

function damagePlayer(amount) {
  const player = state.player;
  const armorBlock = Math.min(player.armor, amount * 0.55);
  player.armor -= armorBlock;
  player.health -= amount - armorBlock;
  player.hurtTimer = 0.2;
  state.message = "Incoming fire.";
  if (player.health <= 0) {
    player.health = 0;
    endRun(false);
  }
}

function updateDoors(dt) {
  for (const door of state.doors) {
    if (door.opening) {
      door.open = clamp(door.open + dt * 0.9, 0, 1);
      if (door.open >= 1) {
        door.opening = false;
      }
      continue;
    }
    const playerDist = distance(state.player.x, state.player.y, door.x + 0.5, door.y + 0.5);
    const enemyNearby = state.enemies.some((enemy) => distance(enemy.x, enemy.y, door.x + 0.5, door.y + 0.5) < 1);
    if (door.open > 0 && playerDist > 1.5 && !enemyNearby) {
      door.open = clamp(door.open - dt * 0.4, 0, 1);
    }
  }
}

function updateEnemies(dt) {
  const player = state.player;

  for (const enemy of state.enemies) {
    enemy.cooldown -= dt;
    enemy.hitTimer = Math.max(0, enemy.hitTimer - dt);

    const dist = distance(enemy.x, enemy.y, player.x, player.y);
    const seesPlayer = dist < 10 && lineOfSight(enemy.x, enemy.y, player.x, player.y);
    if (seesPlayer) {
      enemy.state = "alert";
    }

    if (enemy.state === "alert" && dist > 1.65) {
      const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      tryMove(enemy, enemy.x + Math.cos(angle) * 1.3 * dt, enemy.y + Math.sin(angle) * 1.3 * dt, ENEMY_RADIUS);
    }

    if (seesPlayer && enemy.cooldown <= 0 && dist < 8) {
      enemy.cooldown = 1.1 + Math.random() * 0.7;
      const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      state.projectiles.push({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(angle) * 4.8,
        vy: Math.sin(angle) * 4.8,
        owner: "enemy",
        ttl: 2
      });
    }
  }
}

function updateProjectiles(dt) {
  const remaining = [];
  for (const projectile of state.projectiles) {
    projectile.ttl -= dt;
    if (projectile.ttl <= 0) {
      continue;
    }
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    if (isBlocked(projectile.x, projectile.y)) {
      continue;
    }
    if (projectile.owner === "enemy" && distance(projectile.x, projectile.y, state.player.x, state.player.y) < PLAYER_RADIUS + PROJECTILE_RADIUS) {
      damagePlayer(10 + Math.random() * 6);
      continue;
    }
    remaining.push(projectile);
  }
  state.projectiles = remaining;
}

function updatePickups() {
  const remaining = [];
  for (const pickup of state.pickups) {
    if (distance(pickup.x, pickup.y, state.player.x, state.player.y) > PLAYER_RADIUS + PICKUP_RADIUS) {
      remaining.push(pickup);
      continue;
    }

    state.runStats.pickupsCollected += 1;
    stats.pickupsCollected += 1;

    if (pickup.type === "ammo") {
      state.player.ammo.clips += 24;
      state.player.ammo.shells += 8;
      state.player.ammo.cells += 18;
      state.message = "Ammo cache collected.";
    }
    if (pickup.type === "key") {
      state.player.keys.add("amber");
      state.message = "Amber keycard acquired.";
    }
    if (pickup.type === "med") {
      state.player.health = Math.min(100, state.player.health + 30);
      state.message = "Med gel applied.";
    }
    if (pickup.type === "armor") {
      state.player.armor = Math.min(100, state.player.armor + 35);
      state.message = "Armor plating restored.";
    }
    if (pickup.type === "exit") {
      if (state.enemies.length > 0) {
        state.message = "Facility still hot. Clear remaining hostiles.";
        remaining.push(pickup);
        continue;
      }
      state.win = true;
      saveStats();
      endRun(true);
      continue;
    }
  }
  state.pickups = remaining;
  saveStats();
}

function updateDecals(dt) {
  state.decals = state.decals.filter((decal) => {
    decal.ttl -= dt;
    return decal.ttl > 0;
  });
}

function update(dt) {
  if (!state.running || !state.player) {
    return;
  }
  updatePlayer(dt);
  updateDoors(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updatePickups();
  updateDecals(dt);
}

function drawBackground() {
  const horizon = canvas.height * 0.5;
  if (doomArt.ready && doomArt.sky) {
    ctx.drawImage(doomArt.sky, 0, 0, doomArt.sky.width, doomArt.sky.height, 0, 0, canvas.width, horizon);
    const floorGradient = ctx.createLinearGradient(0, horizon, 0, canvas.height);
    floorGradient.addColorStop(0, "#3b1718");
    floorGradient.addColorStop(1, "#090308");
    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);
    return;
  }
  const ceilingGradient = ctx.createLinearGradient(0, 0, 0, horizon);
  ceilingGradient.addColorStop(0, "#101b2a");
  ceilingGradient.addColorStop(1, colors.ceiling);
  ctx.fillStyle = ceilingGradient;
  ctx.fillRect(0, 0, canvas.width, horizon);

  const floorGradient = ctx.createLinearGradient(0, horizon, 0, canvas.height);
  floorGradient.addColorStop(0, "#1b2738");
  floorGradient.addColorStop(1, "#090d14");
  ctx.fillStyle = floorGradient;
  ctx.fillRect(0, horizon, canvas.width, canvas.height - horizon);
}

function shadeColor(hex, intensity) {
  const value = hex.replace("#", "");
  const size = value.length === 3 ? 1 : 2;
  const parse = (index) => {
    const slice = value.slice(index * size, index * size + size);
    const expanded = size === 1 ? slice + slice : slice;
    return parseInt(expanded, 16);
  };
  return `rgb(${Math.floor(parse(0) * intensity)}, ${Math.floor(parse(1) * intensity)}, ${Math.floor(parse(2) * intensity)})`;
}

function hexToRgb(hex) {
  const parsed = hex.replace("#", "");
  const size = parsed.length === 3 ? 1 : 2;
  const read = (index) => {
    const piece = parsed.slice(index * size, index * size + size);
    const expanded = size === 1 ? piece + piece : piece;
    return parseInt(expanded, 16);
  };
  return `${read(0)}, ${read(1)}, ${read(2)}`;
}

function spriteProjection(entityX, entityY) {
  const dx = entityX - state.player.x;
  const dy = entityY - state.player.y;
  const distanceToEntity = Math.hypot(dx, dy);
  const angleToEntity = Math.atan2(dy, dx) - state.player.angle;
  const screenAngle = Math.atan2(Math.sin(angleToEntity), Math.cos(angleToEntity));
  if (Math.abs(screenAngle) > HALF_FOV + 0.2) {
    return null;
  }
  return {
    distanceToEntity,
    screenX: (0.5 + screenAngle / FOV) * canvas.width,
    screenY: canvas.height / 2,
    size: (canvas.height / Math.max(0.001, distanceToEntity)) * 0.7
  };
}

function drawSpriteColumn(sprite, column, stripePosition, height) {
  const top = sprite.screenY - height / 2;
  const alpha = clamp(1 - sprite.distanceToEntity / MAX_VIEW_DISTANCE, 0.25, 1);
  const art = sprite.type === "enemy"
    ? doomArt.enemy
    : sprite.type === "projectile"
      ? doomArt.projectile
      : sprite.type === "pickup"
        ? doomArt.pickup
        : null;
  if (art) {
    const sourceX = Math.floor(stripePosition * art.width);
    ctx.globalAlpha = sprite.entity.hitTimer > 0 ? 0.72 : alpha;
    ctx.drawImage(art, sourceX, 0, 1, art.height, column, top, 1, height);
    ctx.globalAlpha = 1;
    return;
  }
  if (sprite.type === "enemy") {
    ctx.fillStyle = sprite.entity.hitTimer > 0 ? colors.enemyHit : `rgba(216, 78, 78, ${alpha})`;
    ctx.fillRect(column, top, 1, height);
    ctx.fillStyle = `rgba(35, 7, 7, ${alpha})`;
    ctx.fillRect(column, top + height * 0.15, 1, height * 0.12);
    if (stripePosition > 0.38 && stripePosition < 0.62) {
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillRect(column, top + height * 0.28, 1, height * 0.05);
    }
    return;
  }
  if (sprite.type === "pickup") {
    const pickupColor = colors.pickup[sprite.entity.type] || "#ffffff";
    ctx.fillStyle = `rgba(${hexToRgb(pickupColor)}, ${alpha})`;
    ctx.fillRect(column, top, 1, height * 0.85);
    return;
  }
  if (sprite.type === "projectile") {
    ctx.fillStyle = `rgba(${hexToRgb(colors.projectile)}, ${alpha})`;
    ctx.fillRect(column, top + height * 0.25, 1, height * 0.5);
    return;
  }
  ctx.fillStyle = `rgba(255, 208, 126, ${alpha * 0.5})`;
  ctx.fillRect(column, top + height * 0.6, 1, height * 0.25);
}

function renderSprites(depthBuffer) {
  const sprites = [];
  for (const enemy of state.enemies) {
    const projection = spriteProjection(enemy.x, enemy.y);
    if (projection) {
      sprites.push({ ...projection, type: "enemy", entity: enemy });
    }
  }
  for (const pickup of state.pickups) {
    const projection = spriteProjection(pickup.x, pickup.y);
    if (projection) {
      sprites.push({ ...projection, type: "pickup", entity: pickup });
    }
  }
  for (const projectile of state.projectiles) {
    const projection = spriteProjection(projectile.x, projectile.y);
    if (projection) {
      sprites.push({ ...projection, type: "projectile", entity: projectile });
    }
  }
  for (const decal of state.decals) {
    const projection = spriteProjection(decal.x, decal.y);
    if (projection) {
      sprites.push({ ...projection, type: "decal", entity: decal });
    }
  }

  sprites.sort((a, b) => b.distanceToEntity - a.distanceToEntity);
  for (const sprite of sprites) {
    const width = sprite.size;
    const height = sprite.type === "projectile" ? sprite.size * 0.5 : sprite.size;
    const left = Math.floor(sprite.screenX - width / 2);
    const right = Math.floor(sprite.screenX + width / 2);
    for (let column = left; column < right; column += 1) {
      if (column < 0 || column >= canvas.width || depthBuffer[column] < sprite.distanceToEntity) {
        continue;
      }
      const stripePosition = (column - left) / Math.max(1, right - left);
      drawSpriteColumn(sprite, column, stripePosition, height);
    }
  }
}

function renderHud() {
  const player = state.player;
  if (!player || state.mode !== "playing") {
    return;
  }
  const weapon = weapons[state.weaponIndex];

  ctx.save();
  ctx.fillStyle = "rgba(8, 12, 18, 0.84)";
  ctx.fillRect(18, canvas.height - 122, 348, 98);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.strokeRect(18, canvas.height - 122, 348, 98);
  ctx.fillStyle = "#f4f8ff";
  ctx.font = "700 20px Segoe UI";
  ctx.fillText(weapon.name, 36, canvas.height - 86);
  ctx.font = "600 14px Segoe UI";
  ctx.fillStyle = "#9db3d8";
  ctx.fillText(`HP ${Math.ceil(player.health)}`, 36, canvas.height - 54);
  ctx.fillText(`ARM ${Math.ceil(player.armor)}`, 108, canvas.height - 54);
  ctx.fillText(`CLIPS ${player.ammo.clips}`, 182, canvas.height - 54);
  ctx.fillText(`SHELLS ${player.ammo.shells}`, 36, canvas.height - 30);
  ctx.fillText(`CELLS ${player.ammo.cells}`, 142, canvas.height - 30);
  ctx.fillText(`KEY ${player.keys.has("amber") ? "AMBER" : "NONE"}`, 238, canvas.height - 30);

  if (doomArt.ready && doomArt.face) {
    const faceFrame = player.health > 65 ? 0 : player.health > 30 ? 1 : 2;
    const sourceY = faceFrame * 62;
    ctx.drawImage(doomArt.face, 0, sourceY, doomArt.face.width, 58, 312, canvas.height - 114, 42, 58);
  }

  ctx.fillStyle = "rgba(8, 12, 18, 0.65)";
  ctx.fillRect(canvas.width - 350, 24, 326, 48);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.strokeRect(canvas.width - 350, 24, 326, 48);
  ctx.fillStyle = "#dce7f8";
  ctx.fillText(state.message, canvas.width - 332, 54);

  const bob = Math.sin(performance.now() * 0.01) * 4;
  const weaponWidth = canvas.width * 0.24;
  const weaponHeight = canvas.height * 0.24;
  const weaponX = canvas.width / 2 - weaponWidth / 2;
  const weaponY = canvas.height - weaponHeight + bob;
  const weaponArt = doomArt.weapons[state.weaponIndex];
  if (doomArt.ready && weaponArt) {
    ctx.drawImage(weaponArt, weaponX, weaponY, weaponWidth, weaponHeight);
  } else {
    ctx.fillStyle = "rgba(24, 28, 39, 0.88)";
    ctx.beginPath();
    ctx.roundRect(weaponX, weaponY, weaponWidth, weaponHeight, 18);
    ctx.fill();
    ctx.fillStyle = state.weaponIndex === 0 ? "#ff9a4d" : "#9cc2ff";
    ctx.fillRect(weaponX + weaponWidth * 0.1, weaponY + weaponHeight * 0.24, weaponWidth * 0.8, weaponHeight * 0.22);
    ctx.fillRect(weaponX + weaponWidth * 0.42, weaponY + weaponHeight * 0.08, weaponWidth * 0.16, weaponHeight * 0.7);
  }

  const crosshairX = canvas.width / 2;
  const crosshairY = canvas.height / 2;
  ctx.strokeStyle = player.hurtTimer > 0 ? colors.damage : "rgba(255,255,255,0.92)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(crosshairX - 10, crosshairY);
  ctx.lineTo(crosshairX + 10, crosshairY);
  ctx.moveTo(crosshairX, crosshairY - 10);
  ctx.lineTo(crosshairX, crosshairY + 10);
  ctx.stroke();
  if (player.hurtTimer > 0) {
    ctx.fillStyle = `rgba(255, 58, 58, ${player.hurtTimer * 0.35})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

function renderWorld() {
  drawBackground();
  if (!state.player) {
    return;
  }

  const depthBuffer = new Float32Array(canvas.width);
  for (let column = 0; column < canvas.width; column += 1) {
    const rayAngle = state.player.angle - HALF_FOV + (column / canvas.width) * FOV;
    const ray = castRay(state.player.x, state.player.y, rayAngle);
    const correctedDistance = ray.distance * Math.cos(rayAngle - state.player.angle);
    depthBuffer[column] = correctedDistance;
    const wallHeight = Math.min(canvas.height, (canvas.height / Math.max(0.0001, correctedDistance)) * 0.8);
    const wallTop = (canvas.height - wallHeight) / 2;
    const shade = clamp(1 - correctedDistance / MAX_VIEW_DISTANCE, 0.12, 1);
    let baseColor = colors.wall[ray.cell] || "#8da1bd";
    if (ray.cell === "D" || ray.cell === "L") {
      const door = getDoorAt(ray.cellX, ray.cellY);
      baseColor = door?.locked ? colors.doorLocked : colors.doorClosed;
      if (door?.open > 0.72) {
        baseColor = colors.doorOpen;
      }
    }
    ctx.fillStyle = shadeColor(baseColor, shade);
    ctx.fillRect(column, wallTop, 1, wallHeight);
  }

  renderSprites(depthBuffer);
  renderHud();
}

function frame(time) {
  const delta = Math.min(0.033, (time - state.lastTime) / 1000 || 0);
  state.lastTime = time;
  update(delta);
  renderWorld();
  requestAnimationFrame(frame);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width);
  canvas.height = Math.floor(rect.height);
}

function setWeapon(index) {
  if (index >= 0 && index < weapons.length) {
    state.weaponIndex = index;
    state.message = `${weapons[index].name} ready.`;
  }
}

function showScreen(name) {
  Object.entries(refs.screens).forEach(([key, element]) => {
    element.classList.toggle("active", key === name);
  });
  refs.uiLayer.classList.toggle("hidden", name === "none");
  refs.pauseHint.classList.toggle("hidden", name !== "none");
  state.activeScreen = name;
  if (name !== "none") {
    state.mode = "menu";
  }
}

function startLevel(levelData, { custom = false } = {}) {
  const validation = validateLevelDefinition(levelData);
  if (!validation.ok) {
    setEditorMessage(validation.message);
    showScreen("editor");
    return;
  }
  state.currentLevel = cloneLevel(levelData);
  state.lastPlayedLevel = cloneLevel(levelData);
  createGameState(levelData);
  state.keys.clear();
  state.runStats.customLevel = custom;
  stats.runsStarted += 1;
  saveStats();
  renderStats();
  state.mode = "playing";
  state.running = true;
  showScreen("none");
  resizeCanvas();
  canvas.requestPointerLock?.();
}

function pauseGame() {
  if (state.mode !== "playing") {
    return;
  }
  state.running = false;
  state.keys.clear();
  document.exitPointerLock?.();
  showScreen("pause");
}

function resumeGame() {
  if (!state.player || state.player.health <= 0 || state.win) {
    return;
  }
  state.mode = "playing";
  state.running = true;
  showScreen("none");
  canvas.requestPointerLock?.();
}

function renderStats() {
  const items = [
    ["Runs Started", stats.runsStarted],
    ["Runs Won", stats.runsWon],
    ["Runs Lost", stats.runsLost],
    ["Enemies Defeated", stats.enemiesDefeated],
    ["Shots Fired", stats.shotsFired],
    ["Pickups Collected", stats.pickupsCollected],
    ["Last Result", stats.lastResult]
  ];
  refs.statsGrid.innerHTML = items
    .map(([label, value]) => `<article class="stats-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function setEditorMessage(message, good = false) {
  refs.editorMessage.textContent = message;
  refs.editorMessage.style.color = good ? "var(--success)" : "var(--muted)";
}

function syncEditorExport() {
  const levelData = gridToLevel();
  refs.mapExport.value = levelData.map.join("\n");
  saveCustomLevel(levelData);
}

function getCellClass(cell) {
  if (cell === "#") return "wall";
  if (cell === ".") return "floor";
  if (cell === "S") return "spawn";
  if (cell === "E") return "exit";
  if (cell === "D") return "door";
  if (cell === "L") return "locked";
  if (cell === "M") return "enemy";
  return "pickup";
}

function renderEditorPalette() {
  refs.toolPalette.innerHTML = "";
  for (const tile of tilePalette) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tool-tile ${state.editor.selectedTile === tile.char ? "active" : ""}`;
    button.innerHTML = `<strong>${tile.char} ${tile.label}</strong><span>${tile.hint}</span>`;
    button.addEventListener("click", () => {
      state.editor.selectedTile = tile.char;
      renderEditorPalette();
      setEditorMessage(`Painting ${tile.label} tiles.`);
    });
    refs.toolPalette.appendChild(button);
  }
}

function renderEditorGrid() {
  const rows = state.editor.grid;
  refs.editorGrid.style.gridTemplateColumns = `repeat(${rows[0].length}, var(--tile-size))`;
  refs.editorGrid.innerHTML = "";

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      const cell = rows[y][x];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `editor-cell ${getCellClass(cell)}`;
      button.textContent = cell;
      button.addEventListener("click", () => paintEditorCell(x, y));
      refs.editorGrid.appendChild(button);
    }
  }
}

function paintEditorCell(x, y) {
  const rows = state.editor.grid;
  const selected = state.editor.selectedTile;
  if ((y === 0 || y === rows.length - 1 || x === 0 || x === rows[0].length - 1) && selected !== "#") {
    setEditorMessage("Border tiles must stay walls.");
    return;
  }
  if (selected === "S") {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      for (let colIndex = 0; colIndex < rows[rowIndex].length; colIndex += 1) {
        if (rows[rowIndex][colIndex] === "S") {
          rows[rowIndex][colIndex] = ".";
        }
      }
    }
  }
  rows[y][x] = selected;
  renderEditorGrid();
  syncEditorExport();
}

function resetEditorToLevel(levelData) {
  state.editor.grid = levelToGrid(levelData);
  refs.mapNameInput.value = levelData.name;
  renderEditorPalette();
  renderEditorGrid();
  syncEditorExport();
  setEditorMessage("Editor loaded.");
}

function importMapFromText() {
  const rows = refs.mapExport.value.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const levelData = { name: refs.mapNameInput.value.trim() || "Custom Facility", map: rows };
  const validation = validateLevelDefinition(levelData);
  if (!validation.ok) {
    setEditorMessage(validation.message);
    return;
  }
  state.editor.grid = levelToGrid(levelData);
  renderEditorGrid();
  syncEditorExport();
  setEditorMessage("Map text imported successfully.", true);
}

function bindUi() {
  document.getElementById("startCampaignButton").addEventListener("click", () => startLevel(defaultLevel));
  document.getElementById("openEditorButton").addEventListener("click", () => {
    resetEditorToLevel(loadCustomLevel() || defaultLevel);
    showScreen("editor");
  });
  document.getElementById("openStatsButton").addEventListener("click", () => {
    renderStats();
    showScreen("stats");
  });
  document.getElementById("openCreditsButton").addEventListener("click", () => showScreen("credits"));
  document.getElementById("backFromStatsButton").addEventListener("click", () => showScreen("home"));
  document.getElementById("backFromCreditsButton").addEventListener("click", () => showScreen("home"));
  document.getElementById("resumeButton").addEventListener("click", resumeGame);
  document.getElementById("pauseToHomeButton").addEventListener("click", () => showScreen("home"));
  document.getElementById("pauseToEditorButton").addEventListener("click", () => {
    resetEditorToLevel(loadCustomLevel() || defaultLevel);
    showScreen("editor");
  });
  document.getElementById("resultReplayButton").addEventListener("click", () => {
    startLevel(state.lastPlayedLevel, { custom: state.runStats.customLevel });
  });
  document.getElementById("resultHomeButton").addEventListener("click", () => showScreen("home"));
  document.getElementById("editorBackButton").addEventListener("click", () => showScreen("home"));
  document.getElementById("playCustomButton").addEventListener("click", () => {
    const levelData = gridToLevel();
    const validation = validateLevelDefinition(levelData);
    if (!validation.ok) {
      setEditorMessage(validation.message);
      return;
    }
    saveCustomLevel(levelData);
    startLevel(levelData, { custom: true });
  });
  document.getElementById("fillWallsButton").addEventListener("click", () => {
    const rows = state.editor.grid;
    for (let y = 0; y < rows.length; y += 1) {
      for (let x = 0; x < rows[y].length; x += 1) {
        if (y === 0 || x === 0 || y === rows.length - 1 || x === rows[y].length - 1) {
          rows[y][x] = "#";
        }
      }
    }
    renderEditorGrid();
    syncEditorExport();
    setEditorMessage("Border walls restored.", true);
  });
  document.getElementById("clearInteriorButton").addEventListener("click", () => {
    const rows = state.editor.grid;
    for (let y = 1; y < rows.length - 1; y += 1) {
      for (let x = 1; x < rows[y].length - 1; x += 1) {
        rows[y][x] = ".";
      }
    }
    rows[1][1] = "S";
    rows[rows.length - 2][rows[0].length - 2] = "E";
    renderEditorGrid();
    syncEditorExport();
    setEditorMessage("Interior cleared and essentials restored.", true);
  });
  document.getElementById("loadDefaultButton").addEventListener("click", () => resetEditorToLevel(defaultLevel));
  document.getElementById("importMapButton").addEventListener("click", importMapFromText);
  document.getElementById("exportMapButton").addEventListener("click", () => {
    syncEditorExport();
    setEditorMessage("Map text refreshed.", true);
  });
  document.getElementById("resetStatsButton").addEventListener("click", () => {
    stats.runsStarted = 0;
    stats.runsWon = 0;
    stats.runsLost = 0;
    stats.enemiesDefeated = 0;
    stats.shotsFired = 0;
    stats.pickupsCollected = 0;
    stats.lastResult = "No missions yet";
    saveStats();
    renderStats();
  });
  refs.mapNameInput.addEventListener("input", syncEditorExport);
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => {
  state.keys.add(event.code);
  if (event.code === "Escape") {
    if (state.mode === "playing") {
      pauseGame();
    } else if (state.activeScreen === "pause") {
      resumeGame();
    }
  }
  if (state.mode !== "playing") {
    return;
  }
  if (event.code === "Digit1") setWeapon(0);
  if (event.code === "Digit2") setWeapon(1);
  if (event.code === "Digit3") setWeapon(2);
  if (event.code === "KeyE") openNearbyDoor();
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.code);
});

window.addEventListener("mousemove", (event) => {
  if (!state.pointerLocked || !state.player || state.mode !== "playing") {
    return;
  }
  state.player.angle = normalizeAngle(state.player.angle + event.movementX * MOUSE_SENSITIVITY);
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || state.mode !== "playing") {
    return;
  }
  if (!state.pointerLocked) {
    canvas.requestPointerLock?.();
    return;
  }
  fireWeapon();
});

document.addEventListener("pointerlockchange", () => {
  state.pointerLocked = document.pointerLockElement === canvas;
  if (!state.pointerLocked && state.mode === "playing" && state.running) {
    pauseGame();
  }
});

bindUi();
loadDoomArt();
renderStats();
resetEditorToLevel(loadCustomLevel() || defaultLevel);
resizeCanvas();
createGameState(defaultLevel);
showScreen("home");
requestAnimationFrame(frame);
