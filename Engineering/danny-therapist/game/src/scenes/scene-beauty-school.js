'use strict';

// Scene 2 — Wilkes-Barre Beauty School
const SCENE_BEAUTY = {
  id: 'beauty',
  title: "Wilkes-Barre Beauty School — 1966",
  subtitle: "Danny cuts hair to pay for acting school. Nobody expected any of this.",
  music: 'beauty',
  playerStart: { tx: 10, ty: 12 },
  playerVariant: 'apron',

  map: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,19,19,1,19,19,19,1,19,19,19,19,1,19,19,19,1,19,19,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,8,8,0,8,8,8,0,8,8,8,0,8,8,8,0,8,8,8,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,15,0,0,15,0,0,15,0,0,15,0,0,15,0,0,15,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,8,8,0,8,8,8,0,8,8,8,0,8,8,8,0,8,8,8,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,15,0,0,15,0,0,15,0,0,15,0,0,15,0,0,15,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,6,0,0,0,6,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],

  items: [
    { tx: 5, ty: 7, type: 'scissors' },
  ],

  npcs: [
    new NPC({
      tx: 10, ty: 3, type: 'teacher', speaker: 'Professor Martucci',
      dialog: [
        { s: 'npc', t: "Mr. DeVito, your technique is what I would describe as aggressively wrong yet somehow producing transcendent results. I've never been more confused in my professional life.", a: 'npc-beauty-prof-0' },
        { s: 'npc', t: "You just gave a man a haircut while arguing with the mirror. The client is crying. He says it's beautiful. I don't understand anything anymore.", a: 'npc-beauty-prof-1' },
        { s: 'danny', t: "Professor, I'll tell you how. I just pretend every head of hair is a character and I'm telling their story. Also I've been upcharging for the back of the head and pocketing the difference. You didn't hear that.", a: 'danny-beauty-0' },
      ],
    }),
    new NPC({
      tx: 2, ty: 5, type: 'actor', speaker: 'Customer Gloria',
      dialog: [
        { s: 'npc', t: "DANNY. What did you do to my hair? It's INCREDIBLE. I feel like a dangerous woman. A woman who makes reckless financial decisions.", a: 'npc-beauty-gloria-0' },
        { s: 'npc', t: "I'm naming something after you. A child, a pet, a boat, something. I don't know what yet but it's happening.", a: 'npc-beauty-gloria-1' },
        { s: 'danny', t: "Gloria, baby, I gave you beautiful hair and I am PROUD of that. But I gotta go. I got a calling. I'm gonna be in movies, or TV, or SOMETHING. I can feel it in my whole body. Also I need forty bucks for acting school.", a: 'danny-beauty-1' },
      ],
    }),
    new NPC({
      tx: 16, ty: 11, type: 'actor', speaker: 'Customer Pete',
      dialog: [
        { s: 'npc', t: "Kid, I had a dream once. I was gonna be an international jazz dancer. Never happened. Don't be like me. Be less like me every single day.", a: 'npc-beauty-pete-0' },
        { s: 'npc', t: "Get out of here. Go do whatever insane thing you're gonna do. I'll finish the haircut myself. I've seen enough to know the back.", a: 'npc-beauty-pete-1' },
        { s: 'danny', t: "Pete, you son of a bitch. I'm in. I'm going to acting school. Well, Monday — they're closed today. But MONDAY I walk in there and I take what's mine. Also I'm finishing your hair. I'm a professional.", a: 'danny-beauty-2' },
      ],
    }),
    new NPC({
      tx: 9, ty: 13, type: 'guide', speaker: 'The Road Ahead',
      isExit: true,
      dialog: [
        "→ New York City, 1966",
        "Danny wins a scholarship to the American Academy of Dramatic Arts.",
        "He'll meet the love of his life there. Also he'll start a 60-year career of being completely unhinged.",
        "Press SPACE to continue.",
      ],
    }),
  ],
};
