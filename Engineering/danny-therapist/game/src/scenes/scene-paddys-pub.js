'use strict';

// Scene 5 — Paddy's Pub, Philadelphia (It's Always Sunny in Philadelphia)
// 13=pub floor, 16=bar, 9=table, 15=chair, 14=carpet, 17=wood, 18=stage
const SCENE_PADDYS = {
  id: 'paddys',
  title: "Paddy's Pub — Philadelphia, Present Day",
  subtitle: "Frank Reynolds. It's Always Sunny in Philadelphia.",
  music: 'pub',
  playerStart: { tx: 10, ty: 10 },
  playerVariant: 'frank',

  map: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,17,1],
    [1,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,16,1],
    [1,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,1],
    [1,13,9,9,13,13,9,9,13,13,14,14,14,14,13,9,9,13,13,1],
    [1,13,15,15,13,13,15,15,13,13,14,18,18,14,13,15,15,13,13,1],
    [1,13,13,13,13,13,13,13,13,13,14,18,18,14,13,13,13,13,13,1],
    [1,13,13,13,13,13,13,13,13,13,14,14,14,14,13,13,13,13,13,1],
    [1,13,9,9,13,13,9,9,13,13,13,13,13,13,13,9,9,13,13,1],
    [1,13,15,15,13,13,15,15,13,13,13,13,13,13,13,15,15,13,13,1],
    [1,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,1],
    [1,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,1],
    [1,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,1],
    [1,13,13,6,13,13,13,13,13,13,13,13,13,13,13,13,13,6,13,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],

  items: [
    { tx: 5, ty: 11, type: 'mug' },
  ],

  npcs: [
    new NPC({
      tx: 4, ty: 10, type: 'charlie', speaker: 'Charlie Kelly',
      dialog: [
        "FRANK! Something happened and it's bad and I need you to not freak out!",
        "I was doing Charlie work and I may have made the rat situation significantly worse.",
        "But here's the thing, Frank — and I need you to really hear this —",
        "The rats seem ORGANIZED. Like, they have a LEADER, Frank. One big rat. In charge.",
        { s: 'danny', t: "Charlie, I love ya buddy but you are a walking disaster and I say that as a man who once negotiated with actual sewer rats. Now listen up: I got a plan. It's probably illegal in four states. Let's go.", a: 'danny-paddys-0' },
      ],
    }),
    new NPC({
      tx: 16, ty: 4, type: 'mac', speaker: 'Mac McDonald',
      dialog: [
        "Frank, I've been hitting the weight room and thinking a lot about my faith.",
        "Like, do you think God specifically rewards people who are jacked AND faithful?",
        "Because I've been working on my karate AND my prayer routine simultaneously.",
        "Frank. Frank, what are you eating right now. That is not food. Frank.",
        { s: 'danny', t: "MAC. God sees everything. He sees your karate. He is not impressed. I say that with love. Now get out of my way, I got a scheme and you're either in or you're out, and trust me you want to be IN.", a: 'danny-paddys-1' },
      ],
    }),
    new NPC({
      tx: 9, ty: 3, type: 'louie', speaker: 'Dennis Reynolds',
      dialog: [
        "Frank, can I be real with you for one second?",
        "My plan is objectively, scientifically better than your plan. I have the looks, the brains, the RANGE.",
        "I am a golden god, Frank. A GOLDEN GOD.",
        "Your plan involves the sewer again, doesn't it. I can see it in your eyes. I can always tell.",
        { s: 'danny', t: "Dennis. My boy. My possibly-son. You are a golden god, I know that. But even golden gods need a wild card. And I AM the wild card. WILDCARD, Dennis. Now sit down and listen to your father. Or whoever I am to you. It's still not totally clear.", a: 'danny-paddys-2' },
      ],
    }),
    new NPC({
      tx: 16, ty: 10, type: 'rhea', speaker: 'Dee Reynolds',
      dialog: [
        "Frank, I got a callback. A real one. For an actual acting role.",
        "I know you don't think I have what it takes to make it as an actress—",
        "Actually, don't answer that. Your face is already answering it.",
        "...Is it a bird food commercial. Frank, just tell me if it's a bird food commercial.",
        { s: 'danny', t: "Dee. Bird. Sweetheart. I believe in you, I always have. That's not the issue. The issue is it IS a bird food commercial and I need you to know that before you get too excited. You'd be great in it. Very natural.", a: 'danny-paddys-3' },
      ],
    }),
    new NPC({
      tx: 10, ty: 5, type: 'guide', speaker: 'The Gang',
      isExit: true,
      dialog: [
        "Frank: \"Lemme tell ya somethin' about my life.\"",
        "\"I grew up in Jersey. I cut hair. I drove cabs. I was a penguin.\"",
        "\"I run a bar. I live how I want. I am the American Dream.\"",
        "\"And I'm not done yet. Not by a LONG shot. WILDCARD.\"",
        "★ THE END ★  (Press SPACE for credits)",
      ],
    }),
  ],
};
