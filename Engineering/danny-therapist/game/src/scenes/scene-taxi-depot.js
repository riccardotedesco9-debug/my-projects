'use strict';

// Scene 3 — Sunshine Cab Company (Taxi TV show, 1978-1983)
// 0=floor 1=wall 10=taxi 8=counter 17=wood 11=dark 6=door 9=table 15=chair
const SCENE_TAXI = {
  id: 'taxi',
  title: "Sunshine Cab Company — 1978",
  subtitle: "Danny DeVito stars as Louie De Palma in TAXI...",
  music: 'taxi',
  playerStart: { tx: 10, ty: 7 },
  playerVariant: 'default',

  map: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,1],
    [1,11,10,11,10,11,10,11,11,11,11,11,11,11,11,11,11,11,11,1],
    [1,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,11,1],
    [1,11,10,11,10,11,10,11,11,8,8,8,8,8,8,8,8,11,11,1],
    [1,11,11,11,11,11,11,11,11,8,0,0,0,0,0,0,8,11,11,1],
    [1,11,11,11,11,11,11,11,11,8,0,9,9,0,0,0,8,11,11,1],
    [1,0,0,0,0,0,0,0,0,0,0,9,9,0,15,15,0,0,11,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11,1],
    [1,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,11,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,9,9,0,0,0,9,9,0,0,0,9,9,0,0,0,0,1],
    [1,0,0,15,15,0,0,0,15,15,0,0,0,15,15,0,0,6,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],

  items: [
    { tx: 14, ty: 5, type: 'trophy' },
  ],

  npcs: [
    new NPC({
      tx: 12, ty: 4, type: 'louie', speaker: 'Louie De Palma (Danny)',
      dialog: [
        "REIGER! I got an itch and I need you to handle it! Not — not literally. It's a BUSINESS itch.",
        "...Actually it might also be literally. Don't worry about it.",
        "Point is: this is MY cage, MY depot, MY kingdom, and you are two minutes late.",
        "I'm dockin' you. I'm dockin' everyone. I'm docking MYSELF just to feel something.",
        { s: 'danny', t: "Five years I played that man. FIVE YEARS. And I loved every horrible second of it. Louie De Palma is a monster and he is my masterpiece. God help me, he is my masterpiece.", a: 'danny-taxi-0' },
      ],
    }),
    new NPC({
      tx: 4, ty: 8, type: 'actor', speaker: 'Alex Reiger',
      dialog: [
        "Louie, I've been driving cabs for eight years.",
        "And in eight years, every single day, you have found a brand new way to make everything worse.",
        "New ways. Creative ways. Ways I didn't think were possible.",
        "I'm almost impressed. I'm disgusted, but I'm almost impressed.",
        { s: 'danny', t: "Alex, Louie is the most honest character I ever played. He wants what he wants and he doesn't pretend otherwise. Most people lie about who they are. Not Louie. Also the pretzels in that cage were incredible. Real perk of the job.", a: 'danny-taxi-1' },
      ],
    }),
    new NPC({
      tx: 8, ty: 12, type: 'actor', speaker: 'Jim Ignatowski',
      dialog: [
        "Hey... hey Louie. Quick question.",
        "If a man spends his whole life being deeply, completely confused... does that make him wise?",
        "Because I've been thinking about it and... I think it does.",
        "...What were we talking about? I want a sandwich. Do you want a sandwich?",
        { s: 'danny', t: "Jim, that might be the most profound thing anyone has ever said to me. Also yes. Get the sandwich. The sandwich is always the answer. Don't let anyone tell you otherwise. Life is short. Eat the sandwich.", a: 'danny-taxi-2' },
      ],
    }),
    new NPC({
      tx: 17, ty: 13, type: 'guide', speaker: 'The Road Ahead',
      isExit: true,
      dialog: [
        "→ Gotham City, 1992",
        "Tim Burton is making Batman Returns.",
        "He wants Danny DeVito to play The Penguin.",
        "Are you ready to get WEIRD? (Press SPACE)",
      ],
    }),
  ],
};
