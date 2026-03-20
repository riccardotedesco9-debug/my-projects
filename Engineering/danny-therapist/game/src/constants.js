'use strict';

// ── Display ───────────────────────────────────────────────────────────────────
const TILE  = 32;    // pixels per tile
const CW    = 640;   // canvas width
const CH    = 480;   // canvas height
const SPD   = 2.5;   // player speed px/frame
const IDIST = 56;    // max interact distance (px)

// ── Game state enum ───────────────────────────────────────────────────────────
const STATE = Object.freeze({
  TITLE:'title', PLAYING:'playing', DIALOG:'dialog',
  FADEOUT:'fadeout', FADEIN:'fadein', CREDITS:'credits',
});

// ── Direction enum ────────────────────────────────────────────────────────────
const DIR = Object.freeze({ UP:0, DOWN:1, LEFT:2, RIGHT:3 });

// ── Tile type IDs (use these numbers in map arrays) ───────────────────────────
const T = Object.freeze({
  FLOOR:0, WALL:1, GRASS:2, WATER:3, SIDEWALK:4, ROAD:5,
  DOOR:6, TREE:7, COUNTER:8, TABLE:9, TAXI:10, DARK:11,
  GOTHAM:12, PUB:13, CARPET:14, CHAIR:15, BAR:16, WOOD:17,
  STAGE:18, WINDOW:19, BRICK:20,
});

// ── Tile colors [primary, secondary (checkerboard accent)] ────────────────────
const TCOL = {
  0:['#D2B48C','#C09A6B'],  // FLOOR
  1:['#4A3728','#3D2E20'],  // WALL
  2:['#4CAF50','#388E3C'],  // GRASS
  3:['#1565C0','#0D47A1'],  // WATER
  4:['#9E9E9E','#757575'],  // SIDEWALK
  5:['#455A64','#37474F'],  // ROAD
  6:['#FF8F00','#E65100'],  // DOOR
  7:['#2E7D32','#1B5E20'],  // TREE
  8:['#8D6E63','#6D4C41'],  // COUNTER
  9:['#795548','#5D4037'],  // TABLE
 10:['#FDD835','#F9A825'],  // TAXI
 11:['#2C2C2C','#1A1A1A'],  // DARK
 12:['#263238','#1C262B'],  // GOTHAM
 13:['#5D4037','#4E342E'],  // PUB
 14:['#7B1FA2','#6A1B9A'],  // CARPET
 15:['#A1887F','#8D6E63'],  // CHAIR
 16:['#4E342E','#3E2723'],  // BAR
 17:['#A0522D','#8B4513'],  // WOOD
 18:['#E6AC00','#CC9900'],  // STAGE
 19:['#B3E5FC','#81D4FA'],  // WINDOW
 20:['#8D3A2A','#7A2E20'],  // BRICK
};

// ── Tiles the player cannot walk through ─────────────────────────────────────
const BLOCK = new Set([1,3,7,8,9,10,16,19,20]);
// WALL, WATER, TREE, COUNTER, TABLE, TAXI, BAR, WINDOW, BRICK
