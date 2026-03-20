'use strict';

// Scene 1 — Asbury Park, NJ
// NPC lines use {s:'npc', t, a} for voiced lines, strings for narration
const SCENE_ASBURY = {
  id: 'asbury',
  title: "Asbury Park, NJ — 1955",
  subtitle: "A kid who was definitely going places. Or jail. Hard to say which.",
  music: 'asbury',
  playerStart: { tx: 9, ty: 7 },
  playerVariant: 'default',

  map: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,2,2,7,2,2,2,2,2,2,2,2,2,7,2,7,2,2,2,1],
    [1,2,2,1,1,1,2,2,1,1,1,1,2,2,1,1,1,2,2,1],
    [1,2,2,1,0,1,2,2,1,0,0,1,2,2,1,0,1,2,2,1],
    [1,2,2,1,6,1,2,2,1,0,6,1,2,2,1,6,1,2,2,1],
    [1,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,1],
    [1,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,1],
    [1,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,1],
    [1,2,2,1,1,1,2,2,1,1,1,1,2,2,1,1,1,2,2,1],
    [1,2,2,1,0,1,2,2,1,0,0,1,2,2,1,0,1,2,2,1],
    [1,2,2,1,6,1,2,2,1,0,6,1,2,2,1,6,1,2,2,1],
    [1,2,2,7,2,2,2,2,2,2,2,2,2,2,7,2,2,2,2,1],
    [1,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],

  items: [
    { tx: 9, ty: 13, type: 'star' },
  ],

  npcs: [
    new NPC({
      tx: 15, ty: 11, type: 'mom', speaker: 'Mama DeVito',
      dialog: [
        { s: 'npc', t: "DANNY! Get your ass inside! The meatballs are getting cold and I did not cook for three hours so you could stare at the MOON!", a: 'npc-asbury-mom-0' },
        { s: 'npc', t: "You got a fire in you, piccolo. A beautiful, terrifying fire. God help the world when it finds out.", a: 'npc-asbury-mom-1' },
        { s: 'danny', t: "Ma, I'm gonna be famous. Bigger than this whole street. And when I am, I'm comin' back here and buyin' the whole block. Every house. Every tree. Bulldozed. Out of love.", a: 'danny-asbury-0' },
      ],
    }),
    new NPC({
      tx: 13, ty: 8, type: 'kid', speaker: 'Neighborhood Kid',
      dialog: [
        { s: 'npc', t: "Hey DeVito! I heard you talking to a pigeon again! I heard the whole conversation! You were LOSING!", a: 'npc-asbury-kid-0' },
        { s: 'npc', t: "My dad says you're gonna end up in a ditch! He also lives in a ditch, so maybe take that with a grain of salt!", a: 'npc-asbury-kid-1' },
        { s: 'danny', t: "You know what, I wrote that down. I got a little book. And one day I'm gonna be on every TV in America, and you're gonna be nobody. That's not a threat. That's just what's gonna happen.", a: 'danny-asbury-1' },
      ],
    }),
    new NPC({
      tx: 3, ty: 7, type: 'salesman', speaker: 'Old Sal',
      dialog: [
        { s: 'npc', t: "Thirty-two years on this corner. Know what I've learned? Nothing. Absolutely nothing. But that kid is different.", a: 'npc-asbury-sal-0' },
        { s: 'npc', t: "Whatever he's got in him, it's either gonna make him very famous or get him arrested. Maybe both. Probably both.", a: 'npc-asbury-sal-1' },
        { s: 'danny', t: "Sal, I got plans that would make your head spin. SCHEMES, Sal. Big ones. Probably illegal. But definitely profitable. You wanna be part of something? Because I'm about to do something great.", a: 'danny-asbury-2' },
      ],
    }),
    new NPC({
      tx: 10, ty: 13, type: 'guide', speaker: 'The Road Ahead',
      isExit: true,
      dialog: [
        "→ Wilkes-Barre, Pennsylvania, 1966",
        "Danny enrolls in beauty school to fund his acting dreams.",
        "He discovers he's surprisingly good with scissors. Nobody saw that coming.",
        "Press SPACE to continue the journey.",
      ],
    }),
  ],
};
