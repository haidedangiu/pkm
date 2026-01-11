import { NextRequest, NextResponse } from 'next/server';

// Roast templates - {idea} wird ersetzt
const roastTemplates = [
  "'{idea}'? Das klingt wie etwas, das ein BWL-Student nach dem dritten Bier auf nem Serviette skizziert hat.",
  "Ah ja, '{idea}'. Die Investoren werden sich drum prügeln. Und zwar darum, wer als erster ablehnen darf.",
  "'{idea}' - Endlich löst jemand ein Problem, das niemand hat. Danke dafür.",
  "Lass mich raten: '{idea}' kam dir unter der Dusche? Hättest du mal lieber länger geduscht.",
  "'{idea}'? Digga, selbst deine Mutter würde da nicht investieren. Und die kauft noch Tupperware.",
  "Das Schöne an '{idea}' ist: Wenn es scheitert, wird niemand überrascht sein.",
  "'{idea}' klingt wie etwas, das ChatGPT generiert wenn man es fragt 'Gib mir die dümmste Startup-Idee'.",
  "Ich hab '{idea}' meiner Katze erklärt. Sie hat mich angeschaut und ist gegangen. Selbst sie hat Standards.",
  "'{idea}'? In welchem Paralleluniversum funktioniert das? Und wie komm ich dahin um es zu verhindern?",
  "Cool, '{idea}'. Hast du auch schon die Domain gesichert? wir-sind-pleite.de wäre passend.",
  "'{idea}' - Das ist nicht disruptiv, das ist destruktiv. Für dein Bankkonto.",
  "Wenn '{idea}' eine Person wäre, würde sie alleine am Buffet stehen und so tun als würde sie telefonieren.",
  "'{idea}'? Ich hab schlechte Ideen gesehen, aber du setzt neue Maßstäbe. Respekt.",
  "Das Gute an '{idea}': Du sparst Geld für den Therapeuten, weil das Scheitern offensichtlich ist.",
  "'{idea}' ist wie ein Fallschirm aus Blei. Technisch gesehen ein Fallschirm. Praktisch gesehen ein Problem.",
];

// Buzzword-spezifische Roasts
const buzzwordRoasts: Record<string, string[]> = {
  'blockchain': [
    "Blockchain? Wirklich? Es ist 2024, nicht 2017. Selbst Krypto-Bros haben aufgegeben.",
    "Ah, Blockchain. Die Antwort auf eine Frage, die niemand gestellt hat.",
  ],
  'ai': [
    "AI? Wow, so innovativ. Hast du auch daran gedacht, Machine Learning und Synergien reinzupacken?",
    "AI ist nur ein fancy Wort für 'Ich hab keine echte Technologie'.",
  ],
  'uber': [
    "Uber für irgendwas? Der Venture Capital Friedhof ist voll mit 'Uber für X' Startups.",
    "'Uber für...' - Das Startup-Äquivalent von 'Ich hab keine eigenen Ideen'.",
  ],
  'tinder': [
    "Tinder für was? Menschen swipen schon genug. Lass sie in Ruhe.",
    "Noch ne Dating-App-Variante? Die Einsamkeit der User ist nicht dein Business Model.",
  ],
  'app': [
    "Eine App? Revolutionär. Hat vorher noch niemand dran gedacht.",
    "Die Welt braucht keine weitere App. Die Welt braucht Therapie.",
  ],
  'plattform': [
    "Eine Plattform! Natürlich. Weil das Internet nicht genug Plattformen hat.",
    "Plattform ist Startup-Sprech für 'Ich hab kein echtes Produkt'.",
  ],
  'platform': [
    "Eine Platform! Natürlich. Weil das Internet nicht genug Platforms hat.",
    "Platform ist Startup-Sprech für 'Ich hab kein echtes Produkt'.",
  ],
  'social': [
    "Social Media? Ja klar, Facebook, Instagram, TikTok, Twitter warten nur darauf dass du kommst.",
    "Noch ein Social Network? Die Menschheit ist schon genug vernetzt. Zu viel sogar.",
  ],
};

function generateRoast(idea: string): string {
  const ideaLower = idea.toLowerCase();
  
  // Check for buzzwords first
  for (const [buzzword, roasts] of Object.entries(buzzwordRoasts)) {
    if (ideaLower.includes(buzzword)) {
      // 50% chance für buzzword-spezifischen Roast
      if (Math.random() > 0.5) {
        return roasts[Math.floor(Math.random() * roasts.length)];
      }
    }
  }
  
  // Fallback zu generischen Templates
  const template = roastTemplates[Math.floor(Math.random() * roastTemplates.length)];
  
  // Kürze die Idee wenn zu lang
  const shortIdea = idea.length > 50 ? idea.substring(0, 50) + '...' : idea;
  
  return template.replace('{idea}', shortIdea);
}

export async function POST(request: NextRequest) {
  try {
    const { idea } = await request.json();
    
    if (!idea || typeof idea !== 'string') {
      return NextResponse.json(
        { error: 'Keine Idee? Das ist schon der erste Fehler.' },
        { status: 400 }
      );
    }
    
    const roast = generateRoast(idea.trim());
    
    return NextResponse.json({ roast });
  } catch (error) {
    return NextResponse.json(
      { roast: 'Der Server hat sich geweigert, diese Idee zu verarbeiten. Selbst Maschinen haben Grenzen.' },
      { status: 500 }
    );
  }
}
