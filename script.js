/* ============================================================
   DOM REFERENCES
   ============================================================ */
const body = document.body;
const mainContainerEl = document.getElementById('main-container');
const mainHeader = document.getElementById('main-header');
const headerBrand = document.getElementById('header-brand');
const searchBtn = document.getElementById('search-btn');
const profileBtn = document.getElementById('profile-btn');
const timeDisplay = document.getElementById('time-display');
const contentContainer = document.getElementById('content-container');
const profileContainer = document.getElementById('profile-container');
const pageBackground = document.getElementById('page-background');
const pageScrollbar = document.getElementById('page-scrollbar');
const pageScrollbarThumb = document.getElementById('page-scrollbar-thumb');

const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('search-input');
const searchCloseBtn = document.getElementById('search-close-btn');
const searchDefault = document.getElementById('search-default');
const searchDynamic = document.getElementById('search-dynamic');
const searchEmpty = document.getElementById('search-empty');

/* ============================================================
   STATE
   ============================================================ */
let resizeTimeout;
let currentSection = null;
let loadingCompleted = false;
let searchResults = [];
let musicEnabled = true;
let userInteracted = false;
let welcomeAudio = null;
let fadeInInterval = null;
let audioStarted = false;
let currentVideo = null;
let musicFadeOutInterval = null;
let projectTransitionLock = false;
let backgroundSwapTimeout = null;
let currentOpenProjectTitle = null;

/* ============================================================
   CONFIGURATION
   ============================================================ */
function getConfig() {
  return {
    clockUpdateInterval: 30000,
    beatInterval: 2000,
    waveDelay: 500,
    loadingScreenDuration: 1200,
    loadingFadeOut: 500,
    loadingMaxWait: 8000,
  };
}

let CONFIG = getConfig();

/* ============================================================
   ACCESSIBILITY HELPERS
   ============================================================ */
// Several interactive elements across the site (project cards, search
// result rows) are plain <div>s with role="button" + tabindex="0" rather
// than real <button>s (they needed custom layout/nesting a <button> can't
// do cleanly). Unlike a real <button>, a div's role doesn't get Enter/Space
// activation for free — this wires it up so keyboard users can activate
// them the same way a mouse click does.
function makeKeyboardClickable(el) {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      el.click();
    }
  });
}

// Centralized <img> error fallback — replaces the inline onerror="..."
// attributes that used to be scattered across every <img> tag. Image load
// errors don't bubble, so this listens on the capturing phase instead of
// delegating the normal way; that's what lets one listener cover every
// image on the page, present and future, without wiring each one by hand.
// CSS classes pick the behavior per-image (logo vs. project art):
//   .img-hide-on-error        → just hide it (the logo/avatar images)
//   .img-fallback-coming-soon → swap to the coming-soon placeholder
document.addEventListener('error', e => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement)) return;
  if (el.classList.contains('img-hide-on-error')) {
    el.style.visibility = 'hidden';
  } else if (el.classList.contains('img-fallback-coming-soon') && !el.dataset.fallbackApplied) {
    el.dataset.fallbackApplied = 'true';
    el.src = 'assets/shared/coming-soon.webp';
  }
}, true);

// Keeps Tab/Shift+Tab cycling within an open dialog (lightbox, search
// overlay) instead of leaking focus into the page behind it.
function trapTabKey(e, container) {
  if (e.key !== 'Tab') return;
  const focusable = [...container.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null && !el.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ============================================================
   CLOCK
   ============================================================ */
function updateClock() {
  if (!timeDisplay) return;
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  timeDisplay.textContent = `${displayHours}:${displayMinutes} ${ampm}`;
}

updateClock();
setInterval(updateClock, CONFIG.clockUpdateInterval);

/* ============================================================
   LOADING SCREEN
   ============================================================ */
const loadingScreen = document.getElementById('loading-screen');
const pulseRings = document.querySelectorAll('.pulse-ring');
const startPrompt = document.getElementById('start-prompt');
const loadingLogo = document.getElementById('loading-logo');
let beatCount = 0;
let heartbeatInterval = null;

function triggerWave() {
  beatCount++;
  const waveIndex = (beatCount - 1) % 3;
  const ring = pulseRings[waveIndex];
  if (!ring) return;

  ring.style.animation = 'none';
  ring.offsetWidth;
  setTimeout(() => {
    ring.style.animation = 'pulse-wave 2s cubic-bezier(0.215, 0.61, 0.355, 1)';
  }, CONFIG.waveDelay);
}

function startHeartbeat() {
  pulseRings.forEach(ring => ring.classList.add('active'));
  
  setTimeout(triggerWave, CONFIG.waveDelay);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(triggerWave, CONFIG.beatInterval);
}

function activateBeatAnimation() {
  loadingLogo.classList.add('beating');
}

function proceedToHomeView() {
  if (loadingCompleted) return;
  loadingCompleted = true;

  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      mainContainerEl.style.display = 'flex';
      currentSection = 'home';
      headerBrand?.classList.add('active');
      renderHomeView();
    }, CONFIG.loadingFadeOut);
  }, CONFIG.loadingScreenDuration);
}

function preloadImages(sources, onComplete) {
  let loaded = 0;
  sources.forEach(src => {
    const img = new Image();
    img.src = src;
    img.onload = img.onerror = () => {
      loaded++;
      if (loaded === sources.length) onComplete();
    };
  });
}

function handleUserInteraction() {
  if (userInteracted) return;
  userInteracted = true;

  const promptText = document.getElementById('start-prompt-text');
  if (promptText) {
    promptText.textContent = 'Loading... please wait';
    promptText.classList.add('loading');
  }

  initAudio();
  
  document.removeEventListener('click', handleUserInteraction);
  document.removeEventListener('touchstart', handleUserInteraction);
  document.removeEventListener('keydown', handleUserInteraction);

  startWelcomeMusicWithFadeIn();
  activateBeatAnimation();
  startHeartbeat();
  proceedToHomeView();
}

function checkIfLoaded() {
  // Only the loading screen's own logo gates entry into the site — none of
  // the 18 projects' cover/gallery images. On a bad connection, waiting on
  // dozens of project images before the user can even press "start" made
  // the whole site feel stuck; those now load progressively (lazily, as
  // each card actually scrolls into view) once the user is already in.
  const criticalImages = ['assets/shared/logo.jpg'];

  preloadImages(criticalImages, () => {
    startPrompt.style.display = 'flex';
  });

  setTimeout(() => {
    if (!userInteracted) {
      startPrompt.style.display = 'flex';
    }
  }, CONFIG.loadingMaxWait);
}

/* ============================================================
   AUDIO MANAGEMENT
   ============================================================ */
function initAudio() {
  welcomeAudio = document.getElementById('welcome-audio');

  if (welcomeAudio) {
    welcomeAudio.volume = 0;
    welcomeAudio.loop = true;
    welcomeAudio.muted = false;
  }
  
}

function startWelcomeMusicWithFadeIn() {
  if (!welcomeAudio || !musicEnabled || audioStarted) return;
  audioStarted = true;
  
  welcomeAudio.currentTime = 0;
  welcomeAudio.volume = 0;
  
  const playPromise = welcomeAudio.play();
  
  if (playPromise !== undefined) {
    playPromise.then(() => {
      let volume = 0;
      const targetVolume = 0.5;
      const step = 0.05;
      const intervalTime = 50;
      
      if (fadeInInterval) clearInterval(fadeInInterval);
      
      fadeInInterval = setInterval(() => {
        volume = Math.min(targetVolume, volume + step);
        if (welcomeAudio) welcomeAudio.volume = volume;
        
        if (volume >= targetVolume) {
          clearInterval(fadeInInterval);
          fadeInInterval = null;
        }
      }, intervalTime);
    }).catch(error => {
      console.log("Error al iniciar música de bienvenida:", error);
      setTimeout(() => {
        if (welcomeAudio && !welcomeAudio.paused) return;
        welcomeAudio.play().catch(e => console.log("Segundo intento fallido:", e));
      }, 500);
    });
  }
}

/* ============================================================
   VIDEO MUSIC CONTROL - DUCKS THE AMBIENT TRACK WHILE A PROJECT
   VIDEO PLAYS, RESTORES IT ON PAUSE/END
   ============================================================ */
function handleVideoPlayback(videoElement) {
  if (!videoElement) return;

  videoElement.removeEventListener('play', onVideoPlay);
  videoElement.removeEventListener('pause', onVideoPause);
  videoElement.removeEventListener('ended', onVideoEnded);

  videoElement.addEventListener('play', onVideoPlay);
  videoElement.addEventListener('pause', onVideoPause);
  videoElement.addEventListener('ended', onVideoEnded);

  if (!videoElement.paused && !videoElement.ended) {
    onVideoPlay();
  }
}

function onVideoPlay() {
  if (welcomeAudio && welcomeAudio.volume > 0.01) {
    duckAmbientMusic();
  }
}

function onVideoPause() {
  restoreAmbientMusic();
}

function onVideoEnded() {
  restoreAmbientMusic();
}

function duckAmbientMusic() {
  if (!welcomeAudio || musicFadeOutInterval) return;

  const startVolume = welcomeAudio.volume;
  if (startVolume <= 0.01) return;

  const step = 0.05;
  const intervalTime = 50;
  let currentVolume = startVolume;

  musicFadeOutInterval = setInterval(() => {
    currentVolume = Math.max(0, currentVolume - step);
    if (welcomeAudio) welcomeAudio.volume = currentVolume;

    if (currentVolume <= 0) {
      clearInterval(musicFadeOutInterval);
      musicFadeOutInterval = null;
    }
  }, intervalTime);
}

function restoreAmbientMusic() {
  if (musicFadeOutInterval) {
    clearInterval(musicFadeOutInterval);
    musicFadeOutInterval = null;
  }

  if (!welcomeAudio || !musicEnabled) return;

  let volume = welcomeAudio.volume;
  const targetVolume = 0.5;
  const step = 0.05;
  const intervalTime = 50;

  if (fadeInInterval) clearInterval(fadeInInterval);

  fadeInInterval = setInterval(() => {
    volume = Math.min(targetVolume, volume + step);
    if (welcomeAudio) welcomeAudio.volume = volume;

    if (volume >= targetVolume) {
      clearInterval(fadeInInterval);
      fadeInInterval = null;
    }
  }, intervalTime);
}

/* ============================================================
   DATA - AQUÍ PONEN SUS PROPIAS IMÁGENES DE GALERÍA
   ============================================================ */
const sectionsContent = {
  'game-development': {
    title: 'Unreal Engine Projects',
    background: 'background-game',
    engine: 'Unreal Engine',
    projects: [
      {
        id: 'last-path',
        image: 'assets/projects/last-path/hero.webp',
        video: 'assets/projects/last-path/teaser.mp4',
        title: 'LAST PATH',
        description: 'Last Path is a third-person survival horror game developed in Unreal Engine 5. Players assume the role of a journalist investigating a mysterious story that leads her into an abandoned network of underground catacombs.\n\nThroughout the adventure, players must explore dark environments, avoid creatures that hunt from the shadows, collect scattered notes to uncover the events that took place, find the key to escape, and survive the dangers hidden beneath the surface.',
        gallery: [
          'assets/projects/last-path/gallery/main-menu.webp',
          'assets/projects/last-path/gallery/main-level.webp',
          'assets/projects/last-path/gallery/intro-level.webp',
          'assets/projects/last-path/gallery/player.webp'
        ],
        comingSoon: false,
        techTags: ['Unreal Engine 5', 'Blueprints', 'Lumen', 'Sequencer', 'UMG'],
        role: 'Gameplay & UI Programmer',
        teamSize: '3 Students',
        timeFrame: '2 Weeks',
        engine: 'Unreal Engine 5',
        contributions: [
          'My primary responsibility was implementing several gameplay and presentation systems within the project. I developed the user interface, including the Main Menu, Pause Menu, Death Screen, and Victory Screen, ensuring a consistent player experience throughout the game.',
          'I also created the opening cinematic using Sequencer, designed the initial playable area, and handled the lighting and post-processing to establish the visual atmosphere of the environment.',
          'On the gameplay side, I implemented the player\'s health and damage systems, as well as the behavior of the Desgarrador enemy encountered within the catacombs.',
          'Additionally, I integrated environmental audio and background music using third-party resources to enhance the overall atmosphere of the experience.'
        ]
      },
      {
        id: 'racing-circuit',
        image: 'assets/projects/racing-circuit/hero.webp',
        video: 'assets/projects/racing-circuit/teaser.mp4',
        title: 'RACING CIRCUIT',
        description: 'Racing Circuit is a racing game developed in Unreal Engine 5 for the Unreal Championships Game Jam. Players compete against AI-controlled opponents on a circuit inspired by traditional Chinese architecture and landscapes, aiming to complete the race and cross the finish line in first place.\n\nThe project focused on building a complete racing experience, including AI opponents, user interface, level design, and gameplay systems within the limited development time of a game jam.',
        gallery: [
          'assets/projects/racing-circuit/gallery/checkpoint.webp',
          'assets/projects/racing-circuit/gallery/ai-cars.webp',
          'assets/projects/racing-circuit/gallery/level.webp',
          'assets/projects/racing-circuit/gallery/path-cars.webp'
        ],
        comingSoon: false,
        techTags: ['Unreal Engine 5', 'Blueprints', 'AI', 'Spline System', 'UMG'],
        role: 'Level Designer, Gameplay and AI Programmer',
        teamSize: '2 Members',
        timeFrame: '1 Week',
        engine: 'Unreal Engine 5',
        contributions: [
          'During the development of Racing Circuit, I was responsible for multiple gameplay and technical systems that supported the overall racing experience.',
          'I designed and assembled the race track environment, created several custom shaders used throughout the level, and implemented the game\'s user interface using Unreal Motion Graphics (UMG).',
          'I also developed the AI driving system by creating the path-following behavior that allows opponent vehicles to navigate the circuit and complete laps autonomously.',
          'Throughout the project, I collaborated with the team to integrate these systems into a functional prototype developed during the Unreal Championships Game Jam.',
          'Additionally, I integrated environmental audio and background music using third-party resources to enhance the overall atmosphere of the experience.'
        ]
      },
      { 
        id: 'ue5-vfx', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'VFX SHOWCASE', 
        description: 'Niagara particle effects and environmental VFX. Realistic fire, smoke, and destruction simulations.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
    ],
  },
  'ux-ui': {
    title: 'Unity Projects',
    background: 'background-ux',
    engine: 'Unity',
    projects: [
      { 
        id: 'vr-experience', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'VR EXPERIENCE', 
        description: 'Immersive VR experience built with Unity XR. Optimized for Oculus Quest and HTC Vive.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      { 
        id: 'mobile-game', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'MOBILE PUZZLE GAME', 
        description: 'Cross-platform mobile puzzle game with in-app purchases and cloud save functionality.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      { 
        id: 'ar-app', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'AR MEASUREMENT APP', 
        description: 'Augmented reality application for real-world measurements using ARCore and ARKit.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
    ],
  },
  'web-projects': {
    title: 'Web Games',
    background: 'background-web',
    engine: 'Web Games',
    projects: [
      { 
        id: 'multiplayer-fps', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'LOCK ON (AIM TRAINER)',
        description: 'A browser-based aim trainer — target tracking and flick-shot drills to practice mouse accuracy and reaction time.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      {
        id: 'lexico',
        image: 'assets/projects/lexico/hero.webp',
        video: 'assets/projects/lexico/teaser.mp4',
        title: 'LEXICO (WORDLE-INSPIRED)',
        description: 'Lexico is a word-guessing game focused on deduction and language. Players must uncover a hidden word through a limited number of attempts, using the clues provided by each guess to narrow down the possible answer.\n\nThe game features a Daily Challenge, where players face the same word each day, as well as a Practice mode for unlimited games. Optional hints offer additional ways to approach each puzzle while keeping the core gameplay centered around deduction and word discovery.',
        gallery: [
          'assets/projects/lexico/gallery/menu.webp',
          'assets/projects/lexico/gallery/settings.webp',
          'assets/projects/lexico/gallery/progress.webp',
          'assets/projects/lexico/gallery/mode.webp',
        ],
        comingSoon: false,
        techTags: ['HTML5', 'JavaScript', 'CSS'],
        role: 'Solo Developer (Game Design, Programming, UI/UX)',
        teamSize: '1 (Personal Project)',
        timeFrame: '1 Days',
        engine: 'HTML5, JavaScript, CSS',
        contributions: [
          'I was responsible for the entire development of Lexico, from concept to final polish. This includes game design, programming, UI/UX design, and visual asset creation.',
          'I implemented the core gameplay loop, including the two-pass letter evaluation algorithm (correct/present/absent) that correctly handles repeated letters, animated tile reveals, and full physical and on-screen keyboard support.',
          'I built Practice mode (random word each game) and a Daily Challenge mode that deterministically gives every player the same word once every 24 hours, with no backend required.',
          'I designed and implemented a full internationalization system supporting Spanish and English, including separate hand-curated answer dictionaries (each word tagged with a category and a definition) and a much larger permissive dictionary of valid guesses per language.',
          'I designed three optional hint systems — Reveal Letter, Discard Letters, and Definition — each usable once per game, to make the game more accessible and replayable without changing its core difficulty.',
          'I designed the full "Neon Ink" visual identity: an animated gradient background, an animated logo reveal, light/dark themes, and a colorblind-accessible palette.',
          'I implemented all sound effects procedurally in code with the Web Audio API — no external audio files or licensing involved.',
          'I optimized the game for responsive play across devices, from mobile screens to 4K displays, with full keyboard accessibility and reduced-motion support.',
          'I integrated third-party audio for the teaser video: Song: chill chill by prettyjohn1.',
          'Some parts of the development process were assisted with AI tools.'
        ]
      },

      { 
        id: 'ember-plane',
        image: 'assets/projects/ember-plane/hero.webp',
        video: 'assets/projects/ember-plane/teaser.mp4',
        title: 'EMBER (FLAPPY BIRD-INSPIRED)',
        description: 'Ember is a browser-based arcade game inspired by the classic Flappy Bird formula, featuring a handcrafted origami-inspired visual style. Players control a drifting paper airplane as they navigate an endless journey through procedurally generated obstacles while aiming to achieve the highest possible score.\n\nAs the run progresses, the environment gradually changes between different paper-crafted biomes, creating a more dynamic experience while preserving the game\'s minimalist aesthetic. The project focuses on responsive gameplay, procedural obstacle generation, lightweight visual effects, and polished user interface design, resulting in a complete and optimized web game.',
        gallery: [
          'assets/projects/ember-plane/gallery/menu.webp',
          'assets/projects/ember-plane/gallery/pradera.webp',
          'assets/projects/ember-plane/gallery/noche.webp',
          'assets/projects/ember-plane/gallery/nieve.webp',
        ],
        comingSoon: false,
        techTags: ['HTML5', 'JavaScript', 'CSS'],
        role: 'Solo Developer (Game Design, Programming, UI/UX)',
        teamSize: '1 (Personal Project)',
        timeFrame: '2 Days',
        engine: 'HTML5, JavaScript, CSS',
        contributions: [
          'I was responsible for the entire development of Ember, from concept to final polish. This includes game design, programming, UI/UX design, and visual asset creation.',
          'I implemented the core gameplay mechanics inspired by Flappy Bird, including responsive controls, procedural obstacle generation, and a dynamic scoring system.',
          'I developed the environment transition system that changes biomes (Pradera, Noche, Nieve) based on the player\'s score, creating a more engaging experience.',
          'I implemented two game modes: Arcade and Normal. In Arcade mode, I added special events, power-ups, and debuffs that affect the player depending on the current biome.',
          'I designed and implemented the complete user interface, including menus, score display, and game-over screens.',
          'I optimized the game for web deployment, ensuring responsive design and smooth performance across different devices and screen sizes.',
          'I integrated third-party audio for the teaser video: Song: 8 Bit Crush by HeatleyBros.',
          'Some visual content was created with the assistance of AI tools.'
        ]
      },
    ],
  },
  'godot-projects': {
    title: 'Godot Projects',
    background: 'background-game',
    engine: 'Sandbox',
    projects: [
      {
        id: 'godot-echo',
        image: 'assets/projects/godot-echo/hero.webp',
        title: 'ECHO (GODOT)',
        description: 'ECHO is a modern take on the classic Pong formula, featuring clean minimalist visuals, responsive controls, and two different ways to play. Challenge an AI opponent in a fast-paced one-on-one match or invite a friend for local multiplayer on the same screen.\n\nAs rallies become longer, the ball gradually accelerates, increasing the intensity of every exchange and rewarding quick reactions and precision. Designed as both a fun arcade experience and a technical learning project, ECHO combines polished presentation with accessible gameplay.',
        media: { type: 'video-loop', src: 'assets/projects/godot-echo/turntable.mp4' },
        techTags: [ 'GDScript', 'Game Programming', 'UI Design', 'Game State Management', 'Local Multiplayer', 'AI', 'Audio Management'],
        role: 'Gameplay Programmer & UI Designer',
        timeFrame: '4 Days',
        engine: 'Godot Engine 4.7.1',
        contributions: [
          'ECHO was my first project developed in Godot Engine and was created as a personal challenge to learn the engine while recreating and expanding the classic Pong gameplay.',
          'I designed and programmed the complete gameplay loop, including paddle movement, ball physics, scoring system, match flow, countdown sequence, pause functionality, and game state management.',
          'The project features two game modes: a single-player experience against an AI opponent and a local multiplayer mode that allows a second player to join at any moment from the main menu or directly during an AI match, inspired by the instant "join-in" experience of classic arcade games.',
          'To progressively increase the challenge, the ball gains additional speed after every paddle hit once the match reaches five points, encouraging faster reactions and longer rallies.',
          'I designed a clean, minimalist interface with rounded components inspired by modern Nintendo-style design principles. The project includes a main menu, pause menu, in-game HUD, settings panels with expandable sections, and separate volume controls for music and sound effects.',
          'I also integrated visual effects, sound effects, background music (Made by RetoBGM Chan on Pixabay), and overall polish to create a complete and cohesive arcade experience while becoming familiar with Godots scene system, UI workflow, animation tools, and scripting.'
        ],
        gallery: [
          'assets/projects/godot-echo/gallery/game.webp',
          'assets/projects/godot-echo/gallery/pause.webp',
          'assets/projects/godot-echo/gallery/join.webp',
          'assets/projects/godot-echo/gallery/end.webp'
        ],
        comingSoon: false
      },

      {
        id: 'godot-rpg',
        image: 'assets/shared/coming-soon.webp', 
        title: 'OBBY (ROBLOX STUDIO)',
        description: 'An obstacle-course platformer built in Roblox Studio — timed jumps, checkpoints, and escalating difficulty.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      { 
        id: 'godot-tool', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'BREAKOUT (GODOT)',
        description: 'A classic Breakout-style brick-breaker built in Godot Engine — paddle physics, brick layouts, and power-ups.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
    ],
  },
  'tools-projects': {
    title: 'Tools & Resources',
    background: 'background-others',
    engine: 'Tools',
    projects: [
      { 
        id: 'tool-pipeline', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'GESTURE CONTROL',
        description: 'A hand-gesture recognition tool for controlling an app or game without a mouse or gamepad.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      { 
        id: 'tool-script', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'FACE TRACKING',
        description: 'A real-time facial tracking experiment — mapping expressions and movement to a live avatar or camera feed.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      { 
        id: 'tool-shader', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'BARCODE SCANNER',
        description: 'A barcode/QR scanning utility using the device camera to read and decode codes in real time.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
    ],
  },
  'others-3d': {
    title: '3D Projects',
    background: 'background-others',
    engine: '3D Projects',
    projects: [
      { 
        id: 'blender-scene-1', 
        image: 'assets/shared/coming-soon.webp', 
        title: 'NATURE SCENE', 
        description: 'Photorealistic natural environment created in Blender. Features custom vegetation and atmospheric effects.',
        gallery: [
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp',
          'assets/shared/coming-soon.webp'
        ],
        comingSoon: true
      },
      {
        id: 'guerrero-model',
        image: 'assets/projects/guerrero-model/hero.webp',
        title: 'FANTASY WARRIOR',
        description: 'Fantasy Warrior is a stylized 3D character created entirely in Blender using 2D concept art as visual reference. The project focused on translating an illustrated character into a fully realized three-dimensional model while preserving its proportions, personality, and appealing stylized aesthetic.\n\nThe goal was to practice character modeling, material creation, and presentation techniques commonly used in stylized game art.',
        media: { type: 'video-loop', src: 'assets/projects/guerrero-model/turntable.mp4' },
        techTags: ['Blender', 'Stylized Character Modeling', 'Sculpting', 'UV Mapping', 'PBR Materials', 'Lighting & Rendering'],
        role: 'Character Artist',
        timeFrame: 'Personal Project',
        engine: 'Blender',
        contributions: [
          'For this project, I recreated a stylized fantasy warrior from a 2D reference entirely in Blender.',
          'I modeled every element of the character, including the body, facial features, clothing, armor, accessories, weapon, and hair, while carefully preserving the proportions and visual style of the original concept.',
          'I created the materials, lighting setup, and final rendering to emphasize the character\'s shapes, colors, and stylized appearance. The project also involved refining the overall presentation through composition and cinematic lighting to showcase the model in a clean portfolio-ready render.',
          'Throughout the process, I focused on improving my hard-surface and organic modeling workflow while gaining additional experience with stylized character production.'
        ],
        gallery: [
          'assets/projects/guerrero-model/gallery/blender-viewport.webp',
          'assets/projects/guerrero-model/gallery/concept-reference.webp',
          'assets/projects/guerrero-model/gallery/render-1.webp',
          'assets/projects/guerrero-model/gallery/render-2.webp',
        ],
        comingSoon: false
      },
      {
        id: 'lady-model',
        image:  'assets/projects/lady-model/hero.webp',
        title: 'BENETTON SISTERLAND PERFUME',
        description: 'Benetton Sisterland is a 3D recreation of the original perfume bottle created in Blender using photographic references. The project focused on reproducing the product\'s distinctive stylized design, materials, proportions, and lighting while maintaining a clean presentation suitable for product visualization.\n\nThe objective was to accurately recreate a recognizable commercial product, paying special attention to glass materials, transparency, reflections, label details, and the decorative elements that define the original bottle\'s visual identity.',
        media: { type: 'video-loop', src: 'assets/projects/lady-model/turntable.mp4' },
        techTags: ['Blender', 'Hard Surface Modeling', 'Product Visualization', 'UV Mapping', 'PBR Materials', 'Lighting & Rendering'],
        role: '3D Artist and Product Visualization',
        timeFrame: 'Personal Project',
        engine: 'Blender',
        contributions: [
          'For this project, I recreated the Benetton Sisterland perfume bottle entirely in Blender using photographic references of the original product.',
          'I modeled each component individually, including the bottle, cap, stylized character, decorative clothing elements, labels, and glass container. Special attention was given to maintaining accurate proportions while reproducing the product\'s playful aesthetic.',
          'I also created the materials and shaders used for the glass, metallic liquid, plastic components, and printed textures to achieve a convincing product visualization.',
          'Finally, I developed the studio lighting setup and rendering composition, focusing on reflections, transparency, and presentation quality to simulate the appearance of a professional product advertisement.'
        ],
        gallery: [
          'assets/projects/lady-model/gallery/hero-shot.webp',
          'assets/projects/lady-model/gallery/angle-1.webp',
          'assets/projects/lady-model/gallery/angle-2.webp',
          'assets/projects/lady-model/gallery/detail.webp'
        ],
        comingSoon: false
      },
    ],
  },
};

const SECTION_ORDER = ['game-development', 'ux-ui', 'web-projects', 'godot-projects', 'others-3d', 'tools-projects'];

function buildSearchIndex() {
  const index = [
    { type: 'engine', name: 'Unreal Engine', section: 'game-development', keywords: ['unreal', 'engine', 'ue5', 'ue4'] },
    { type: 'engine', name: 'Unity', section: 'ux-ui', keywords: ['unity', 'c#', 'csharp'] },
    { type: 'engine', name: 'Web Games', section: 'web-projects', keywords: ['web', 'html', 'javascript', 'threejs'] },
    { type: 'engine', name: 'Godot', section: 'godot-projects', keywords: ['godot', 'gdscript'] },
    { type: 'engine', name: '3D Projects', section: 'others-3d', keywords: ['3d', 'blender', 'modeling', 'scan'] },
    { type: 'engine', name: 'Tools', section: 'tools-projects', keywords: ['tools', 'resources', 'utility', 'scripts'] },
  ];

  Object.keys(sectionsContent).forEach(sectionKey => {
    const section = sectionsContent[sectionKey];
    section.projects.forEach(project => {
      const titleWords = project.title.toLowerCase().split(/\s+/);
      index.push({
        type: 'project',
        name: project.title,
        section: sectionKey,
        keywords: [...titleWords],
        comingSoon: project.comingSoon || false,
      });
    });
  });

  return index;
}

const searchIndex = buildSearchIndex();

/* ============================================================
   HELPERS
   ============================================================ */
function hideAllSections() {
  contentContainer.classList.add('hidden');
  contentContainer.removeAttribute('style');
  contentContainer.innerHTML = '';
  profileContainer.classList.add('hidden');
  profileContainer.removeAttribute('style');
  profileContainer.innerHTML = '';
  if (currentSection !== 'profile') {
    profileBtn.classList.remove('profile-active');
  }
}

/* ============================================================
   HOME VIEW - ALL PROJECTS IN ONE FLAT, FILTERABLE GRID
   (no more Games/Others hub -> engine page -> project page chain;
   every real project is one click away, engines are just filters)
   ============================================================ */
let activeFilter = 'all';

function getAllProjectsFlat() {
  const list = [];
  SECTION_ORDER.forEach(sectionKey => {
    const section = sectionsContent[sectionKey];
    if (!section) return;
    section.projects.forEach(project => {
      list.push({ sectionKey, sectionEngine: section.engine, project });
    });
  });
  return list;
}

function projectCardHTML(entry, index) {
  const { sectionKey, sectionEngine, project } = entry;
  const isComingSoon = project.comingSoon || false;
  const comingSoonBadge = isComingSoon ? `<span class="coming-soon-badge">Coming Soon</span>` : '';

  return `
    <div class="project-card ${isComingSoon ? 'coming-soon' : ''}"
         style="animation-delay: ${Math.min(index, 12) * 0.05}s"
         data-section="${sectionKey}"
         data-project-title="${project.title}"
         data-project-image="${project.image}"
         data-project-description="${project.description || ''}"
         data-project-gallery='${JSON.stringify(project.gallery || [])}'
         data-coming-soon="${isComingSoon}"
         role="button" tabindex="0" aria-label="${project.title}${isComingSoon ? ' — coming soon' : ''}">
      <div class="card-image-wrapper">
        <img src="${project.image}" alt="" loading="lazy" class="img-fallback-coming-soon">
        <span class="project-card-engine-tag">${sectionEngine}</span>
        ${comingSoonBadge}
      </div>
      <h3>${project.title}</h3>
    </div>
  `;
}

function renderHomeView() {
  contentContainer.classList.remove('hidden');
  contentContainer.removeAttribute('style');
  contentContainer.style.display = 'flex';

  const chips = [{ key: 'all', label: 'All Projects' }]
    .concat(SECTION_ORDER.map(key => ({ key, label: sectionsContent[key].engine })));

  const chipsHTML = chips
    .map(chip => `<button class="filter-chip ${chip.key === activeFilter ? 'active' : ''}" data-filter="${chip.key}">${chip.label}</button>`)
    .join('');

  const projectsHTML = getAllProjectsFlat().map(projectCardHTML).join('');

  contentContainer.innerHTML = `
    <section class="content-section home-section">
      <p class="home-subtitle">Explore my work — filter by engine, or browse everything</p>
      <div class="filter-chips">${chipsHTML}</div>
      <div class="projects-carousel" id="projects-carousel">${projectsHTML}</div>
      <p class="carousel-hint" id="carousel-hint"><i class="fa-solid fa-arrows-left-right" aria-hidden="true"></i> Scroll, or click and drag, to see more projects</p>
      <div class="project-detail-panel" id="project-detail-panel"></div>
    </section>
  `;

  bindHomeViewEvents();
  applyFilter(activeFilter);
}

// Only fade the edge that actually has more cards hidden past it —
// no fade on the first card when there's nothing to its left, or on
// the last card when there's nothing to its right.
function updateCarouselEdgeFade(carousel) {
  if (!carousel) return;
  const maxScroll = carousel.scrollWidth - carousel.clientWidth;
  carousel.classList.toggle('at-start', carousel.scrollLeft <= 1);
  carousel.classList.toggle('at-end', carousel.scrollLeft >= maxScroll - 1);
}

// Only hints at scrolling/dragging when there's actually more to see (the
// carousel overflows) and only while nothing is selected — once a project
// is open, attention belongs on its content, not on carousel navigation.
function updateCarouselHint() {
  const hint = document.getElementById('carousel-hint');
  const carousel = document.getElementById('projects-carousel');
  if (!hint || !carousel) return;
  const hasOverflow = carousel.scrollWidth > carousel.clientWidth + 1;
  hint.classList.toggle('visible', hasOverflow && !currentOpenProjectTitle);
}

// Smoothly scrolls the carousel so the given card lands in position 1
// (second from the left), not position 0 — position 0 sits right under
// the left edge fade, which would hide a chunk of the card the user just
// picked. Landing it in position 1 leaves the *previous* card under that
// fade instead, which doesn't matter since it isn't the one just selected.
// The one exception: if the card is already the very first one (nothing
// precedes it, e.g. LAST PATH), there's no "previous" card to use as the
// scroll target, so it just stays exactly where it is.
function scrollCarouselToCard(card) {
  const carousel = document.getElementById('projects-carousel');
  if (!carousel || !card) return;

  const visibleCards = [...carousel.querySelectorAll('.project-card:not(.filtered-out)')];
  const index = visibleCards.indexOf(card);
  const targetCard = index > 0 ? visibleCards[index - 1] : card;

  const carouselRect = carousel.getBoundingClientRect();
  const targetRect = targetCard.getBoundingClientRect();
  const targetScrollLeft = carousel.scrollLeft + (targetRect.left - carouselRect.left);
  carousel.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
}

// Wires up wheel-to-horizontal-scroll, edge-fade tracking, and click-and-drag
// (touch-like) scrolling for any horizontally-scrolling row (the project
// carousel, the filter chips row). Returns a `wasDragged()` getter so
// callers can suppress a click that was actually the tail end of a drag.
function initDragToScroll(el) {
  if (!el) return () => false;

  el.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });

  el.addEventListener('scroll', () => updateCarouselEdgeFade(el));
  updateCarouselEdgeFade(el);

  // Pointer capture is only taken once real movement crosses the threshold —
  // capturing unconditionally on every pointerdown makes Chromium retarget
  // the resulting `click` event to the capturing element instead of whatever
  // is underneath, which breaks plain clicks entirely.
  let isDragging = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartScroll = 0;
  let activePointerId = null;

  el.addEventListener('pointerdown', e => {
    // Touch/pen already scroll natively via overflow-x: auto; this custom
    // drag is only meant to give a mouse the same touch-like feel.
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    isDragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartScroll = el.scrollLeft;
    activePointerId = e.pointerId;
  });

  el.addEventListener('pointermove', e => {
    if (!isDragging || e.pointerId !== activePointerId) return;
    const dx = e.clientX - dragStartX;
    if (!dragMoved && Math.abs(dx) > 5) {
      dragMoved = true;
      el.classList.add('dragging');
      el.setPointerCapture(activePointerId);
    }
    if (dragMoved) el.scrollLeft = dragStartScroll - dx;
  });

  const endDrag = () => {
    isDragging = false;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  return () => dragMoved;
}

function bindHomeViewEvents() {
  const filterChipsEl = contentContainer.querySelector('.filter-chips');
  const filterChipsWasDragged = initDragToScroll(filterChipsEl);

  contentContainer.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (filterChipsWasDragged()) return;
      if (chip.dataset.filter === activeFilter) return;
      applyFilter(chip.dataset.filter);
    });
  });

  const carousel = document.getElementById('projects-carousel');
  const carouselDragged = initDragToScroll(carousel);
  updateCarouselHint();

  contentContainer.querySelectorAll('.project-card').forEach(card => {
    makeKeyboardClickable(card);
    card.addEventListener('click', () => {
      if (carouselDragged()) return;

      const isComingSoon = card.dataset.comingSoon === 'true';

      if (isComingSoon) {
        showComingSoonMessage(card.dataset.projectTitle);
        return;
      }

      if (projectTransitionLock) return;

      const title = card.dataset.projectTitle;
      const image = card.dataset.projectImage;
      const description = card.dataset.projectDescription;
      const gallery = JSON.parse(card.dataset.projectGallery || '[]');
      scrollCarouselToCard(card);
      openProjectWindow(title, image, description, gallery);
    });

    // Marks the card clickable/hoverable again (and frees `transform` from
    // the entrance animation's grip) the moment ITS OWN stagger + fade-up
    // finishes, rather than waiting on a single timer sized for the
    // slowest card in the batch.
    card.addEventListener('animationend', e => {
      if (e.animationName === 'cardFadeUp') card.classList.add('entrance-done');
    });
  });
}

function applyFilter(filterKey) {
  activeFilter = filterKey;
  body.className = filterKey === 'all' ? '' : sectionsContent[filterKey].background;

  const openPanel = document.getElementById('project-detail-panel');
  if (openPanel && openPanel.classList.contains('active')) {
    closeProjectWindow();
  }

  contentContainer.querySelectorAll('.filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === filterKey);
  });

  contentContainer.querySelectorAll('.project-card').forEach(card => {
    const matches = filterKey === 'all' || card.dataset.section === filterKey;
    const wasHidden = card.classList.contains('filtered-out');

    // Only cards that are actually about to go from hidden -> visible need
    // their entrance replayed (and re-locked until it finishes). Cards that
    // were already visible and stay visible are untouched, so they don't
    // needlessly re-animate or lose clickability on every filter change.
    if (matches && wasHidden) {
      card.classList.remove('entrance-done');
    }

    card.classList.toggle('filtered-out', !matches);
  });

  const carousel = document.getElementById('projects-carousel');
  if (carousel) {
    carousel.scrollLeft = 0;
    updateCarouselEdgeFade(carousel);
  }
  updateCarouselHint();
}

/* ============================================================
   COMING SOON MESSAGE
   ============================================================ */
function showComingSoonMessage(projectTitle) {
  let messageEl = document.getElementById('coming-soon-message');
  
  if (!messageEl) {
    messageEl = document.createElement('div');
    messageEl.id = 'coming-soon-message';
    messageEl.className = 'coming-soon-message';
    // role="status" + aria-live so a screen reader announces the toast on
    // its own — it self-dismisses in 3s, so moving focus to it (the usual
    // way to announce new content) would be disruptive rather than helpful.
    messageEl.setAttribute('role', 'status');
    messageEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(messageEl);
  }
  
  messageEl.innerHTML = `
    <div class="coming-soon-content">
      <p><strong>${projectTitle}</strong> is coming soon!</p>
      <p>Stay tuned for updates.</p>
      <button class="coming-soon-close">Close</button>
    </div>
  `;
  
  messageEl.classList.add('active');
  
  const closeBtn = messageEl.querySelector('.coming-soon-close');
  closeBtn.addEventListener('click', () => {
    messageEl.classList.remove('active');
  });
  
  messageEl.addEventListener('click', (e) => {
    if (e.target === messageEl) {
      messageEl.classList.remove('active');
    }
  });
  
  setTimeout(() => {
    if (messageEl.classList.contains('active')) {
      messageEl.classList.remove('active');
    }
  }, 3000);
}

function renderProfileContent() {
  contentContainer.classList.add('hidden');
  contentContainer.removeAttribute('style');
  contentContainer.innerHTML = '';

  profileContainer.classList.remove('hidden');
  profileContainer.removeAttribute('style');

  profileContainer.innerHTML = `
    <div class="connect-card">
      <div class="connect-avatar">
        <img src="assets/shared/logo.jpg" alt="Sergio Hernandez" class="img-hide-on-error">
      </div>
      <p class="connect-tagline">Game Dev</p>
      <h1 class="connect-name">Sergio <span>Hernández</span></h1>
      <p class="connect-cta">Connect with me!</p>
      <p class="connect-section-title">Links</p>
      <div class="connect-links">
        <a href="https://www.linkedin.com/in/sergio-hernandez-dev" class="connect-button" target="_blank" rel="noopener">LinkedIn</a>
        <a href="https://github.com/Lemond01" class="connect-button" target="_blank" rel="noopener">GitHub</a>
        <a href="https://www.artstation.com/lemondg" class="connect-button" target="_blank" rel="noopener">ArtStation</a>
      </div>
      <div class="social-icons">
        <a href="https://line.me/ti/p/SsezhwgSOi" target="_blank" rel="noopener" aria-label="Line"><i class="fa-brands fa-line" aria-hidden="true"></i></a>
        <a href="https://discordapp.com/users/500709438806818836" target="_blank" rel="noopener" aria-label="Discord"><i class="fa-brands fa-discord" aria-hidden="true"></i></a>
        <a href="https://www.instagram.com/hdz_sergio2?igsh=MXIwMmVnd2lwZmM1eQ==" target="_blank" rel="noopener" aria-label="Instagram"><i class="fa-brands fa-square-instagram" aria-hidden="true"></i></a>
      </div>
    </div>
  `;
}

/* ============================================================
   PROJECT DETAIL (inline, in the page's own empty space below the
   carousel — not a popup. The page background becomes the
   project's key art while it's open, PS-Store style.)
   ============================================================ */
const DEFAULT_GALLERY_IMAGES = [
  'assets/shared/coming-soon.webp',
  'assets/shared/coming-soon.webp',
  'assets/shared/coming-soon.webp',
  'assets/shared/coming-soon.webp',
];

function setPageBackground(imageUrl) {
  if (!pageBackground) return;

  if (backgroundSwapTimeout) {
    clearTimeout(backgroundSwapTimeout);
    backgroundSwapTimeout = null;
  }

  if (pageBackground.classList.contains('active')) {
    // Already showing a project's art (switching project-to-project):
    // crossfade instead of snapping straight to the new image.
    pageBackground.classList.remove('active');
    backgroundSwapTimeout = setTimeout(() => {
      pageBackground.style.backgroundImage = `url('${imageUrl}')`;
      requestAnimationFrame(() => pageBackground.classList.add('active'));
      backgroundSwapTimeout = null;
    }, 400);
    return;
  }

  pageBackground.style.backgroundImage = `url('${imageUrl}')`;
  requestAnimationFrame(() => pageBackground.classList.add('active'));
}

function clearPageBackground() {
  if (!pageBackground) return;
  pageBackground.classList.remove('active');
}

const PROJECT_TRANSITION_LOCK_MS = 800; // covers the bg crossfade + reveal animation

function openProjectWindow(title, image, description, galleryImages) {
  // Ignore clicks while a project transition (background crossfade + reveal
  // animation + carousel scroll) is already in progress, so rapid clicking
  // between cards can't leave the background/content out of sync.
  if (projectTransitionLock) return;

  // Already viewing this exact project — clicking it again shouldn't
  // reload/re-animate it from scratch.
  if (title === currentOpenProjectTitle) return;

  const panel = document.getElementById('project-detail-panel');
  if (!panel) return;

  projectTransitionLock = true;
  setTimeout(() => { projectTransitionLock = false; }, PROJECT_TRANSITION_LOCK_MS);

  // Switching from an already-open project: stop its video and restore the
  // ambient music cleanly before swapping content (removing the old video
  // via innerHTML never fires a 'pause'/'ended' event, so without this the
  // ducked volume could get stuck low).
  if (currentVideo) {
    currentVideo.pause();
    currentVideo.removeEventListener('play', onVideoPlay);
    currentVideo.removeEventListener('pause', onVideoPause);
    currentVideo.removeEventListener('ended', onVideoEnded);
    currentVideo = null;
    restoreAmbientMusic();
  }

  setPageBackground(image);

  const galleryToUse = galleryImages && galleryImages.length > 0
    ? galleryImages
    : DEFAULT_GALLERY_IMAGES;

  const galleryHTML = galleryToUse
    .map((imgSrc, index) => `<div class="gallery-item" data-index="${index}" role="button" tabindex="0" aria-label="View gallery image ${index + 1} of ${galleryToUse.length}"><img src="${imgSrc}" alt="Gallery ${index + 1} - ${title}" loading="lazy" class="img-fallback-coming-soon"></div>`)
    .join('');

  const formattedDescription = description ? description.replace(/\n/g, '<br>') : '';

  // 🔍 BUSCAR EL PROYECTO EN LOS DATOS PARA OBTENER SUS VALORES ESPECÍFICOS
  let projectData = null;
  
  // Buscar en todas las secciones
  Object.keys(sectionsContent).forEach(sectionKey => {
    const section = sectionsContent[sectionKey];
    if (section && section.projects) {
      const found = section.projects.find(p => p.title === title);
      if (found) {
        projectData = found;
      }
    }
  });

  // Si no se encontró el proyecto, usar valores por defecto
  if (!projectData) {
    projectData = {
      techTags: ['Unreal Engine 5', 'Blueprints', 'C++', 'UMG'],
      role: 'Lead Developer',
      teamSize: '3',
      timeFrame: '12 Weeks',
      engine: 'Custom Engine',
      contributions: [
        'During the development of this project, I focused on creating robust and scalable systems that could adapt to changing design needs while maintaining optimal performance.',
        'I implemented advanced gameplay mechanics and rendering features, ensuring the final product met all technical requirements and exceeded quality expectations.',
        'Collaboration with the design team was essential, participating in regular code reviews, sprint planning sessions, and technical discussions to align the development with the creative vision.'
      ]
    };
  }

  // Crear HTML de tech tags
  const techTagsHTML = projectData.techTags && projectData.techTags.length > 0
    ? projectData.techTags.map(tag => `<span class="tech-tag">${tag}</span>`).join('')
    : '';

  // Crear HTML de contribuciones
  const contributionsHTML = projectData.contributions && projectData.contributions.length > 0
    ? projectData.contributions.map(p => `<p>${p}</p>`).join('')
    : '<p>No contributions data available.</p>';

  currentOpenProjectTitle = title;
  updateCarouselHint();

  // Highlight the matching carousel card as "selected" (slightly bigger,
  // no hover) so it's obvious which project the open panel belongs to.
  contentContainer.querySelectorAll('.project-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.projectTitle === title);
  });

  // Most projects show a click-to-play teaser video, declared explicitly
  // per-project via `projectData.video`. Some (e.g. the Guerrero model)
  // don't have a teaser and use a silent, looping turntable clip instead —
  // declared via `projectData.media`. `video-loop` used to be an animated
  // GIF; it's now an autoplaying muted <video> with the same visual effect
  // at a fraction of the file size (a 45MB GIF becomes a ~2MB video with
  // an identical loop).
  const mediaHTML = projectData.media && projectData.media.type === 'video-loop'
    ? `<video class="project-media-gif" autoplay loop muted playsinline>
         <source src="${projectData.media.src}" type="video/mp4">
       </video>`
    : `<video id="project-video" controls preload="metadata" aria-label="${title} teaser video">
         <source src="${projectData.video || ''}" type="video/mp4">
         <p>Your browser doesn't support HTML5 video.</p>
       </video>`;

  panel.innerHTML = `
    <div class="project-detail">
      <div class="project-detail-image-section">
        <div class="project-video-container" id="project-video-container">
          ${mediaHTML}
        </div>
      </div>
      <div class="project-hero-title"><h1 id="project-detail-heading" tabindex="-1">${title}</h1></div>
      <div class="project-gallery-carousel">
        <div class="gallery-scroll-container">${galleryHTML}</div>
      </div>
      <div class="project-info-section">
        <div class="project-info-grid">
          <div class="info-card">
            <h3>About</h3>
            <p>${formattedDescription}</p>
          </div>
          <div class="info-card">
            <h3>Technical Details</h3>
            <div class="tech-tags">
              ${techTagsHTML}
            </div>
            <ul class="contributions-list">
              <li><strong>Role:</strong> ${projectData.role || 'N/A'}</li>
              <li><strong>Team Size:</strong> ${projectData.teamSize || 'N/A'}</li>
              <li><strong>Time Frame:</strong> ${projectData.timeFrame || 'N/A'}</li>
              <li><strong>Engine:</strong> ${projectData.engine || 'N/A'}</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="project-detail-description">
        <h2>My Contributions</h2>
        <div class="project-long-description">
          ${contributionsHTML}
        </div>
      </div>
    </div>
  `;

  // Force the reveal animation to (re)play even when the panel is already
  // open and we're just swapping to a different project.
  panel.classList.remove('active');
  void panel.offsetWidth;
  panel.classList.add('active');

  const video = document.getElementById('project-video');
  if (video) {
    currentVideo = video;
    handleVideoPlayback(video);
  }

  // Move focus into the newly opened panel instead of leaving it on the
  // card that was just activated. Without this, a keyboard user has to
  // Tab past every remaining carousel card before reaching the video or
  // gallery. The teaser <video> sits before the heading in the DOM (it's
  // the hero element, shown above the title), so focusing the heading
  // first would leave the video permanently "behind" a forward Tab and
  // unreachable — focus the video itself when there is one (so the very
  // next keypress can be Space to play it), and only fall back to the
  // heading (tabindex="-1", not in the normal tab order — focused here
  // purely so this works and so screen readers announce the new project)
  // for video-loop / no-teaser projects.
  if (video) {
    video.focus();
  } else {
    const heading = document.getElementById('project-detail-heading');
    if (heading) heading.focus();
  }

  document.querySelectorAll('.gallery-item').forEach((item, index) => {
    item.style.cursor = 'pointer';
    makeKeyboardClickable(item);
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      const img = item.querySelector('img');
      openLightbox(img.src, galleryToUse, index);
    });
  });
}

function closeProjectWindow() {
  if (currentVideo) {
    currentVideo.pause();
    currentVideo.currentTime = 0;
    currentVideo.removeEventListener('play', onVideoPlay);
    currentVideo.removeEventListener('pause', onVideoPause);
    currentVideo.removeEventListener('ended', onVideoEnded);
    currentVideo = null;
  }

  restoreAmbientMusic();
  clearPageBackground();
  currentOpenProjectTitle = null;
  updateCarouselHint();
  contentContainer.querySelectorAll('.project-card.selected').forEach(c => c.classList.remove('selected'));

  const panel = document.getElementById('project-detail-panel');
  if (panel) {
    panel.classList.remove('active');
    panel.innerHTML = '';
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goHome() {
  // Bail out only if there's truly nothing to reset (already on home with
  // no project open) — a project can be open while currentSection is still
  // 'home', so that alone isn't enough to skip the reset.
  if (currentSection === 'home' && !currentOpenProjectTitle) return;
  currentSection = 'home';

  closeProjectWindow();
  profileBtn.classList.remove('profile-active');
  headerBrand?.classList.add('active');
  hideAllSections();
  renderHomeView();
}

headerBrand?.addEventListener('click', goHome);
if (headerBrand) makeKeyboardClickable(headerBrand);

/* ============================================================
   PROFILE
   ============================================================ */
profileBtn?.addEventListener('click', () => {
  if (currentSection === 'profile') return;
  currentSection = 'profile';

  closeProjectWindow();
  profileBtn.classList.add('profile-active');
  headerBrand?.classList.remove('active');
  body.className = 'background-connect';
  renderProfileContent();
});

/* ============================================================
   SEARCH
   ============================================================ */
let searchTriggerEl = null;

function openSearch() {
  searchTriggerEl = document.activeElement;
  searchOverlay.classList.add('active');
  searchInput.value = '';
  searchInput.focus();
  resetSearchToDefault();
  searchResults = [];
}

function closeSearch() {
  searchOverlay.classList.remove('active');
  searchInput.value = '';
  if (searchTriggerEl) {
    searchTriggerEl.focus();
    searchTriggerEl = null;
  }
}

function resetSearchToDefault() {
  searchDefault.style.display = 'block';
  searchDynamic.style.display = 'none';
  searchEmpty.style.display = 'none';
  searchCloseBtn.classList.remove('visible');
}

function performSearch(query) {
  if (!query.trim()) {
    resetSearchToDefault();
    return;
  }

  searchCloseBtn.classList.add('visible');

  const q = query.toLowerCase().trim();

  if (q === 'all') {
    renderAllResults();
    return;
  }

  searchResults = searchIndex.filter(
    item => item.name.toLowerCase().includes(q) || item.keywords.some(kw => kw.includes(q))
  );

  if (searchResults.length === 0) {
    searchDefault.style.display = 'none';
    searchDynamic.style.display = 'none';
    searchEmpty.style.display = 'block';
    return;
  }

  const matchedEngine = searchResults.find(r => r.type === 'engine');
  if (matchedEngine && searchResults.length === 1) {
    renderEngineWithProjects(matchedEngine);
  } else {
    renderFlatResults(searchResults);
  }
}

function renderAllResults() {
  searchDefault.style.display = 'none';
  searchEmpty.style.display = 'none';
  searchDynamic.style.display = 'block';

  let totalProjects = 0;
  const sections = Object.keys(sectionsContent);
  sections.forEach(key => totalProjects += sectionsContent[key].projects.length);

  let html = `<p class="search-section-label">All Projects (${totalProjects})</p>`;

  sections.forEach(sectionKey => {
    const section = sectionsContent[sectionKey];
    html += `
      <div class="search-engine-header" data-section="${sectionKey}" role="button" tabindex="0" aria-label="Browse ${section.engine}">
        <i class="fa-solid fa-cube" aria-hidden="true"></i>
        <span>${section.engine}</span>
        <span class="search-engine-count">${section.projects.length} projects</span>
      </div>
    `;

    section.projects.forEach(project => {
      const isComingSoon = project.comingSoon || false;
      html += `
        <div class="search-project-item ${isComingSoon ? 'coming-soon' : ''}"
             data-section="${sectionKey}"
             data-project-title="${project.title}"
             data-project-image="${project.image}"
             data-project-description="${project.description || ''}"
             data-coming-soon="${isComingSoon}"
             role="button" tabindex="0" aria-label="${project.title}${isComingSoon ? ' — coming soon' : ''}">
          <i class="fa-solid fa-image" aria-hidden="true"></i>
          <span>${project.title}</span>
          ${isComingSoon ? '<span class="search-item-type coming-soon-tag">Coming Soon</span>' : '<span class="search-item-type">project</span>'}
        </div>
      `;
    });
  });

  searchDynamic.innerHTML = html;
  bindSearchResultClicks();
}

function renderEngineWithProjects(engineItem) {
  searchDefault.style.display = 'none';
  searchEmpty.style.display = 'none';
  searchDynamic.style.display = 'block';

  const section = sectionsContent[engineItem.section];
  const projects = section.projects;

  let html = `
    <p class="search-section-label">Results (${projects.length + 1})</p>
    <div class="search-engine-header" data-section="${engineItem.section}" role="button" tabindex="0" aria-label="Browse ${engineItem.name}">
      <i class="fa-solid fa-cube" aria-hidden="true"></i>
      <span>${engineItem.name}</span>
      <span class="search-item-type">engine</span>
    </div>
  `;

  projects.forEach(project => {
    const isComingSoon = project.comingSoon || false;
    html += `
      <div class="search-project-item ${isComingSoon ? 'coming-soon' : ''}"
           data-section="${engineItem.section}"
           data-project-title="${project.title}"
           data-project-image="${project.image}"
           data-project-description="${project.description || ''}"
           data-coming-soon="${isComingSoon}"
           role="button" tabindex="0" aria-label="${project.title}${isComingSoon ? ' — coming soon' : ''}">
        <i class="fa-solid fa-image" aria-hidden="true"></i>
        <span>${project.title}</span>
        ${isComingSoon ? '<span class="search-item-type coming-soon-tag">Coming Soon</span>' : '<span class="search-item-type">project</span>'}
      </div>
    `;
  });

  searchDynamic.innerHTML = html;
  bindSearchResultClicks();
}

function renderFlatResults(results) {
  searchDefault.style.display = 'none';
  searchEmpty.style.display = 'none';
  searchDynamic.style.display = 'block';

  const itemsHTML = results
    .map(item => {
      let projectData = '';
      let isComingSoon = false;
      if (item.type !== 'engine') {
        const section = sectionsContent[item.section];
        if (section) {
          const project = section.projects.find(p => p.title === item.name);
          if (project) {
            isComingSoon = project.comingSoon || false;
            projectData = `data-project-title="${project.title}" data-project-image="${project.image}" data-project-description="${project.description || ''}" data-project-gallery='${JSON.stringify(project.gallery || [])}' data-coming-soon="${isComingSoon}"`;
          }
        }
      }

      return `
        <div class="search-result-item ${isComingSoon ? 'coming-soon' : ''}"
             data-section="${item.section}"
             data-type="${item.type}"
             ${projectData}
             role="button" tabindex="0" aria-label="${item.name}${isComingSoon ? ' — coming soon' : ''}">
          <i class="fa-solid ${item.type === 'engine' ? 'fa-cube' : 'fa-image'}" aria-hidden="true"></i>
          <span>${item.name}</span>
          ${isComingSoon ? '<span class="search-item-type coming-soon-tag">Coming Soon</span>' : `<span class="search-item-type">${item.type}</span>`}
        </div>
      `;
    }).join('');

  searchDynamic.innerHTML = `
    <p class="search-section-label">Results (${results.length})</p>
    ${itemsHTML}
  `;

  bindSearchResultClicks();
}

function bindSearchResultClicks() {
  searchDynamic.querySelectorAll('.search-engine-header').forEach(el => {
    makeKeyboardClickable(el);
    el.addEventListener('click', () => {
      closeSearch();
      navigateToSection(el.dataset.section);
    });
  });

  searchDynamic.querySelectorAll('.search-project-item').forEach(el => {
    makeKeyboardClickable(el);
    el.addEventListener('click', () => {
      const section = el.dataset.section;
      const title = el.dataset.projectTitle;
      const image = el.dataset.projectImage;
      const description = el.dataset.projectDescription;
      const isComingSoon = el.dataset.comingSoon === 'true';

      closeSearch();

      if (isComingSoon) {
        // Nothing to open yet, but still take them to where it lives.
        navigateToSection(section);
        showComingSoonMessage(title);
        return;
      }

      const sectionData = sectionsContent[section];
      let gallery = [];
      if (sectionData) {
        const project = sectionData.projects.find(p => p.title === title);
        if (project && project.gallery) {
          gallery = project.gallery;
        }
      }

      navigateToSection(section, () => {
        if (title && image) {
          setTimeout(() => {
            openProjectWindow(title, image, description, gallery);
          }, 600);
        }
      });
    });
  });

  searchDynamic.querySelectorAll('.search-result-item').forEach(el => {
    makeKeyboardClickable(el);
    el.addEventListener('click', () => {
      const section = el.dataset.section;
      const type = el.dataset.type;
      const title = el.dataset.projectTitle;
      const image = el.dataset.projectImage;
      const description = el.dataset.projectDescription;
      const isComingSoon = el.dataset.comingSoon === 'true';

      closeSearch();

      if (type === 'engine' || (!title && !image)) {
        navigateToSection(section);
      } else if (isComingSoon) {
        // Nothing to open yet, but still take them to where it lives.
        navigateToSection(section);
        showComingSoonMessage(title);
      } else {
        navigateToSection(section, () => {
          if (title && image) {
            const sectionData = sectionsContent[section];
            let gallery = [];
            if (sectionData) {
              const project = sectionData.projects.find(p => p.title === title);
              if (project && project.gallery) {
                gallery = project.gallery;
              }
            }
            setTimeout(() => {
              openProjectWindow(title, image, description, gallery);
            }, 600);
          }
        });
      }
    });
  });
}

function navigateToSection(section, callback) {
  // Reuses the exact same reset goHome() does (closes any open project,
  // clears profile/header-brand active states, rebuilds the home view) so
  // this can't drift out of sync with what the header-brand button does.
  goHome();
  applyFilter(section);

  if (callback) {
    setTimeout(callback, 300);
  }
}

searchBtn.addEventListener('click', openSearch);

searchCloseBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  resetSearchToDefault();
});

searchOverlay.addEventListener('click', e => {
  if (e.target === searchOverlay || e.target.classList.contains('search-overlay-bg')) {
    closeSearch();
  }
});

searchInput.addEventListener('input', e => performSearch(e.target.value));

document.querySelectorAll('.search-suggestion-item').forEach(item => {
  makeKeyboardClickable(item);
  item.addEventListener('click', () => {
    searchInput.value = item.dataset.search;
    performSearch(item.dataset.search);
  });
});

/* ============================================================
   LIGHTBOX - IMÁGENES DEL CARRUSEL CON NAVEGACIÓN INFINITA
   ============================================================ */
const lightbox = document.getElementById('lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxOverlay = document.querySelector('.lightbox-overlay');
const lightboxPrev = document.getElementById('lightbox-prev');
const lightboxNext = document.getElementById('lightbox-next');

let currentGalleryIndex = 0;
let currentGalleryImages = [];

let lightboxTriggerEl = null;

function openLightbox(imageSrc, galleryImages, index) {
  if (!imageSrc) return;

  currentGalleryImages = galleryImages || [];
  currentGalleryIndex = index || 0;

  lightboxTriggerEl = document.activeElement;
  lightboxImage.src = imageSrc;
  lightboxImage.alt = 'Imagen ampliada';
  lightbox.classList.add('active');
  body.style.overflow = 'hidden';
  lightboxClose.focus();
  
  // Mostrar botones de navegación siempre (carrusel infinito)
  if (currentGalleryImages.length > 1) {
    lightboxPrev.style.display = 'flex';
    lightboxNext.style.display = 'flex';
    lightboxPrev.style.opacity = '1';
    lightboxNext.style.opacity = '1';
    lightboxPrev.style.pointerEvents = 'auto';
    lightboxNext.style.pointerEvents = 'auto';
  } else {
    lightboxPrev.style.display = 'none';
    lightboxNext.style.display = 'none';
  }
}

function navigateLightbox(direction) {
  if (currentGalleryImages.length <= 1) return;
  
  // Calcular nuevo índice con wrap-around (carrusel infinito)
  const totalImages = currentGalleryImages.length;
  let newIndex = currentGalleryIndex + direction;
  
  // Si es menor que 0, ir a la última imagen
  if (newIndex < 0) {
    newIndex = totalImages - 1;
  }
  // Si es mayor o igual al total, ir a la primera imagen
  else if (newIndex >= totalImages) {
    newIndex = 0;
  }
  
  currentGalleryIndex = newIndex;
  const newSrc = currentGalleryImages[currentGalleryIndex];
  
  // Animación de transición suave
  lightboxImage.style.opacity = '0';
  setTimeout(() => {
    lightboxImage.src = newSrc;
    lightboxImage.alt = 'Imagen ampliada ' + (currentGalleryIndex + 1);
    lightboxImage.style.opacity = '1';
  }, 150);
}

function closeLightbox() {
  lightbox.classList.remove('active');
  body.style.overflow = '';
  currentGalleryImages = [];
  currentGalleryIndex = 0;
  if (lightboxTriggerEl) {
    lightboxTriggerEl.focus();
    lightboxTriggerEl = null;
  }
  setTimeout(() => {
    if (!lightbox.classList.contains('active')) {
      lightboxImage.src = '';
    }
  }, 300);
}

lightboxClose.addEventListener('click', closeLightbox);
lightboxOverlay.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', function(e) {
  e.stopPropagation(); // Prevenir que el clic se propague al overlay
  navigateLightbox(-1);
});
lightboxNext.addEventListener('click', function(e) {
  e.stopPropagation(); // Prevenir que el clic se propague al overlay
  navigateLightbox(1);
});

// Teclas de navegación en el lightbox
document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('active')) trapTabKey(e, lightbox);
  if (e.key === 'Escape' && lightbox.classList.contains('active')) {
    closeLightbox();
  }
  if (e.key === 'ArrowLeft' && lightbox.classList.contains('active')) {
    navigateLightbox(-1);
  }
  if (e.key === 'ArrowRight' && lightbox.classList.contains('active')) {
    navigateLightbox(1);
  }
});

/* ============================================================
   GLOBAL EVENTS
   ============================================================ */
document.addEventListener('keydown', e => {
  if (searchOverlay.classList.contains('active')) trapTabKey(e, searchOverlay);

  if (e.key !== 'Escape') return;

  if (searchOverlay.classList.contains('active')) {
    if (searchInput.value.trim()) {
      searchInput.value = '';
      resetSearchToDefault();
      searchInput.focus();
    } else {
      closeSearch();
    }
  } else {
    const panel = document.getElementById('project-detail-panel');
    if (panel && panel.classList.contains('active')) {
      closeProjectWindow();
    }
  }
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    CONFIG = getConfig();
    // Chip/card sizes change across breakpoints, which can flip whether
    // these rows actually have anything left to scroll.
    updateCarouselEdgeFade(document.querySelector('.filter-chips'));
    updateCarouselEdgeFade(document.getElementById('projects-carousel'));
    updateCarouselHint();
  }, 250);
});

/* ============================================================
   CUSTOM PAGE SCROLLBAR
   Overlay drawn above the content instead of a native scrollbar, so it
   never reserves layout space or shifts anything. Only visible while the
   page actually has something to scroll (e.g. once a project's content
   makes the page taller than the viewport).
   ============================================================ */
function updatePageScrollbar() {
  if (!pageScrollbar || !pageScrollbarThumb) return;

  const html = document.documentElement;
  const scrollable = html.scrollHeight > html.clientHeight + 1;
  pageScrollbar.classList.toggle('visible', scrollable);
  if (!scrollable) return;

  const trackHeight = html.clientHeight;
  const thumbHeight = Math.max(40, (trackHeight / html.scrollHeight) * trackHeight);
  const maxThumbTop = trackHeight - thumbHeight;
  const scrollRatio = html.scrollTop / (html.scrollHeight - html.clientHeight);

  pageScrollbarThumb.style.height = `${thumbHeight}px`;
  pageScrollbarThumb.style.transform = `translateY(${scrollRatio * maxThumbTop}px)`;
}

window.addEventListener('scroll', updatePageScrollbar, { passive: true });
window.addEventListener('resize', updatePageScrollbar);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(updatePageScrollbar).observe(document.body);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  CONFIG = getConfig();
  startPrompt.style.display = 'none';

  document.addEventListener('click', handleUserInteraction);
  document.addEventListener('touchstart', handleUserInteraction);
  document.addEventListener('keydown', handleUserInteraction);

  checkIfLoaded();
  contentContainer.classList.add('hidden');
});