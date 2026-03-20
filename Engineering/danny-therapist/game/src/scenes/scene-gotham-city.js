'use strict';

// Scene 4 — Gotham City, 1992 (Batman Returns — Danny as The Penguin)
// 12=gotham dark floor, 20=brick, 1=wall, 0=floor, 6=door, 9=table
const SCENE_GOTHAM = {
  id: 'gotham',
  title: "Gotham City — 1992",
  subtitle: "Tim Burton's Batman Returns. Danny IS The Penguin.",
  music: 'gotham',
  playerStart: { tx: 10, ty: 7 },
  playerVariant: 'penguin',

  map: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,1],
    [1,20,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,20,1],
    [1,20,12,9,12,12,12,12,12,12,12,12,12,12,12,9,12,12,20,1],
    [1,20,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,20,1],
    [1,20,12,12,20,20,20,12,12,12,12,20,20,20,12,12,12,12,20,1],
    [1,12,12,12,20,0,20,12,12,12,12,20,0,20,12,12,12,12,12,1],
    [1,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,1],
    [1,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,1],
    [1,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,1],
    [1,20,20,12,12,12,12,12,12,12,12,12,12,12,12,12,20,20,20,1],
    [1,0,0,0,0,0,0,12,12,12,12,12,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,12,12,12,12,12,0,0,0,0,0,0,0,1],
    [1,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],

  items: [
    { tx: 10, ty: 3, type: 'tophat' },
  ],

  npcs: [
    new NPC({
      tx: 9, ty: 2, type: 'tim', speaker: 'Tim Burton',
      dialog: [
        "Danny... when I wrote The Penguin I didn't really... think about it too hard.",
        "And then you showed up to the audition and I thought: oh. OH. This man IS this character.",
        "The waddling — did I write that? The fish biting? I don't think I wrote the fish biting.",
        "I don't even know what's scripted anymore and I directed this movie.",
        { s: 'danny', t: "Tim, I AM the Penguin. Not in a performance sense. In a SPIRITUAL sense. That character lives inside me. He's been in there my whole life. The fish was my idea. The biting was my idea. You're welcome, cinema.", a: 'danny-gotham-0' },
      ],
    }),
    new NPC({
      tx: 4, ty: 8, type: 'goon', speaker: 'Gotham Citizen',
      dialog: [
        "IS THAT THE PENGUIN?! EVERYONE RUN!",
        "...wait, is he actually... is he eating a fish right now? A raw fish?",
        "He is. He's fully eating a raw fish on the streets of Gotham City.",
        "That man is either a genius or deeply unwell. Possibly both. Definitely both.",
        { s: 'danny', t: "Three hours of makeup EVERY MORNING. Every. Single. Morning. Four AM. In a chair. Being transformed into a monster. And I LOVED it. The fish were real. All the fish. Method doesn't even begin to cover it.", a: 'danny-gotham-1' },
      ],
    }),
    new NPC({
      tx: 16, ty: 8, type: 'rhea', speaker: 'Rhea Perlman',
      dialog: [
        "Danny, honey... our youngest won't come near the TV when your movie is on.",
        "They think The Penguin is a real person who lives somewhere in the house.",
        "I keep telling them it's just daddy. They don't believe me.",
        "I'm not entirely sure they're wrong.",
        { s: 'danny', t: "Baby, I love you. You are the only human being who truly understands what I'm doing. The kids will get it when they're older. Or they won't. Either way I am PROUD of that movie and I would do it again tomorrow.", a: 'danny-gotham-2' },
      ],
    }),
    new NPC({
      tx: 17, ty: 13, type: 'guide', speaker: 'The Road Ahead',
      isExit: true,
      dialog: [
        "→ Philadelphia, Present Day",
        "It's Always Sunny in Philadelphia. Paddy's Pub.",
        "Frank Reynolds. The most unhinged character on television.",
        "One last stop on the journey. (Press SPACE)",
      ],
    }),
  ],
};
