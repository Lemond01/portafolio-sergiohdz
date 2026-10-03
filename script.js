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
const scrollToProjectBtn = document.getElementById('scroll-to-project-btn');

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

// Front-to-back order of real projects once one's been opened; null = default SECTION_ORDER. Session-only.
let customRealOrderTitles = null;

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
// Enter/Space activation for div[role="button"] elements, which don't get it for free.
function makeKeyboardClickable(el) {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      el.click();
    }
  });
}

// Site-wide <img> error fallback (capturing phase — image errors don't bubble):
//   .img-hide-on-error        → hide it
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
      showWelcomeNotification();
    }, CONFIG.loadingFadeOut);
  }, CONFIG.loadingScreenDuration);
}

/* ============================================================
   WELCOME NOTIFICATION (one-time toast after the loading screen)
   ============================================================ */
const WELCOME_NOTIFICATION_DURATION_MS = 5000;
let welcomeNotificationTimer = null;
let welcomeNotificationShownAt = null;
let welcomeNotificationRemainingMs = WELCOME_NOTIFICATION_DURATION_MS;

function showWelcomeNotification() {
  const el = document.getElementById('welcome-notification');
  if (!el) return;

  requestAnimationFrame(() => el.classList.add('visible'));

  welcomeNotificationRemainingMs = WELCOME_NOTIFICATION_DURATION_MS;
  armWelcomeNotificationTimer();

  // Hovering pauses the countdown; leaving resumes with whatever time was left.
  el.addEventListener('mouseenter', () => {
    if (!welcomeNotificationTimer) return;
    clearTimeout(welcomeNotificationTimer);
    welcomeNotificationTimer = null;
    welcomeNotificationRemainingMs = Math.max(0, welcomeNotificationRemainingMs - (Date.now() - welcomeNotificationShownAt));
  });
  el.addEventListener('mouseleave', () => {
    if (welcomeNotificationTimer) return;
    armWelcomeNotificationTimer();
  });
}

function armWelcomeNotificationTimer() {
  welcomeNotificationShownAt = Date.now();
  welcomeNotificationTimer = setTimeout(() => {
    welcomeNotificationTimer = null;
    document.getElementById('welcome-notification')?.classList.remove('visible');
  }, welcomeNotificationRemainingMs);
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
  // Only the logo gates entry — project images load lazily once inside.
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
      console.log("Error starting welcome music:", error);
      setTimeout(() => {
        if (welcomeAudio && !welcomeAudio.paused) return;
        welcomeAudio.play().catch(e => console.log("Second attempt failed:", e));
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
   PROJECT DATA — sections, projects, and their gallery images
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
    { type: 'engine', name: 'Sandbox', section: 'godot-projects', keywords: ['godot', 'gdscript', 'roblox', 'obby', 'sandbox'] },
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
// Carousel's momentum-scroll token (see initDragToScroll/createMomentumWheel).
// Bumped by reorderCarouselWithFlip to cancel an in-flight glide before a reorder.
let carouselScrollToken = null;

function getAllProjectsFlat() {
  // Real projects first, "coming soon" placeholders last.
  const real = [];
  const comingSoon = [];
  SECTION_ORDER.forEach(sectionKey => {
    const section = sectionsContent[sectionKey];
    if (!section) return;
    section.projects.forEach(project => {
      const entry = { sectionKey, sectionEngine: section.engine, project };
      (project.comingSoon ? comingSoon : real).push(entry);
    });
  });
  return { real, comingSoon, all: [...real, ...comingSoon] };
}

// getAllProjectsFlat()'s real-project list, reordered per customRealOrderTitles (see bringProjectToFront).
function getOrderedReal() {
  const { real } = getAllProjectsFlat();
  if (!customRealOrderTitles) return real;
  const byTitle = new Map(real.map(entry => [entry.project.title, entry]));
  const ordered = customRealOrderTitles.map(t => byTitle.get(t)).filter(Boolean);
  real.forEach(entry => {
    if (!ordered.includes(entry)) ordered.push(entry); // e.g. a project added after the order was first captured
  });
  return ordered;
}

// Moves a project to the front of the custom order. No-op for coming-soon/unknown titles.
function bringProjectToFront(title) {
  const { real } = getAllProjectsFlat();
  if (!real.some(entry => entry.project.title === title)) return;
  const currentOrder = customRealOrderTitles || real.map(entry => entry.project.title);
  customRealOrderTitles = [title, ...currentOrder.filter(t => t !== title)];
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

  const { comingSoon } = getAllProjectsFlat();
  const real = getOrderedReal();
  const realHTML = real.map((entry, i) => projectCardHTML(entry, i)).join('');
  const comingSoonHTML = comingSoon
    .map((entry, i) => projectCardHTML(entry, real.length + i))
    .join('');
  // Only shown when there's at least one coming-soon entry to separate from.
  const dividerHTML = comingSoon.length > 0
    ? `<div class="carousel-divider" id="carousel-divider" aria-hidden="true"><span>More in<br>progress</span></div>`
    : '';
  // Decorative, non-interactive bookends — excluded via .bookend-card checks
  // in bindHomeViewEvents, reorderCarouselWithFlip, and applyFilter.
  const bookendStartHTML = `<div class="project-card bookend-card" aria-hidden="true"><img src="assets/shared/welcome-logo.png" alt="" class="bookend-card-icon"></div>`;
  const bookendEndHTML = `<div class="project-card bookend-card" aria-hidden="true"><img src="assets/shared/grid-logo.png" alt="" class="bookend-card-icon"></div>`;
  const projectsHTML = bookendStartHTML + realHTML + bookendEndHTML + dividerHTML + comingSoonHTML;

  contentContainer.innerHTML = `
    <section class="content-section home-section">
      <h1 class="home-title">Sergio Hernández</h1>
      <p class="home-subtitle">Game developer — Unreal Engine, Godot &amp; web games, plus 3D art in Blender. Explore my work below, or filter by engine.</p>
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
  // Slack for browser-zoom scrollLeft rounding, so a real edge doesn't get stranded mid-fade.
  const EDGE_TOLERANCE = 8;
  const maxScroll = carousel.scrollWidth - carousel.clientWidth;
  carousel.classList.toggle('at-start', carousel.scrollLeft <= EDGE_TOLERANCE);
  carousel.classList.toggle('at-end', carousel.scrollLeft >= maxScroll - EDGE_TOLERANCE);
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

// Scrolls so the card lands in position 1, not 0 (0 sits under the left edge fade).
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

// Slides `card` to the front via FLIP: measure every real card, move the
// clicked one first in the DOM, then counter-animate each from its old
// position to its new one. Resolves once done (or immediately if already first).
const FLIP_DURATION_MS = 450;

function reorderCarouselWithFlip(card) {
  return new Promise(resolve => {
    const carousel = document.getElementById('projects-carousel');
    if (!carousel || !card) { resolve(); return; }

    const realCards = [...carousel.querySelectorAll('.project-card:not(.coming-soon):not(.bookend-card)')];
    if (realCards[0] === card) { resolve(); return; }

    // Force any still-entering card to its resting state — its cardFadeUp
    // animation would otherwise fight the FLIP's own transform.
    realCards.forEach(c => c.classList.add('entrance-done'));

    if (carouselScrollToken) carouselScrollToken.value++; // cancel any in-flight glide

    // Measure real on-screen positions before resetting scrollLeft.
    const firstRects = new Map(realCards.map(c => [c, c.getBoundingClientRect()]));

    carousel.scrollLeft = 0;
    carousel.insertBefore(card, realCards[0]); // keeps the start bookend in front

    let anyMoved = false;
    realCards.forEach(c => {
      const first = firstRects.get(c);
      const deltaX = first.left - c.getBoundingClientRect().left;
      if (Math.abs(deltaX) < 1) return;
      anyMoved = true;
      c.style.transition = 'none';
      c.style.transform = `translateX(${deltaX}px)`;
    });

    if (!anyMoved) { resolve(); return; }

    // Block hover/pointer on every card during the slide (see .reordering in style.css).
    carousel.classList.add('reordering');

    // Flush the instant transforms before switching transitions back on, or
    // the browser coalesces them and skips the animation.
    void carousel.offsetWidth;

    realCards.forEach(c => {
      c.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      c.style.transform = '';
    });

    setTimeout(() => {
      realCards.forEach(c => {
        c.style.transition = '';
        c.style.transform = '';
      });
      carousel.classList.remove('reordering');
      resolve();
    }, FLIP_DURATION_MS);
  });
}

// Wheel-to-horizontal-scroll, edge-fade tracking, and click-and-drag for a
// horizontally-scrolling row. Returns a `wasDragged()` getter so callers can
// suppress a click that was actually the tail end of a drag.
function initDragToScroll(el, tokenHolder) {
  if (!el) return () => false;

  // Same momentum easing as the page's vertical scroll (see createMomentumWheel).
  const momentum = REDUCE_MOTION_MQ.matches ? null : createMomentumWheel({
    getPos: () => el.scrollLeft,
    setPos: x => { el.scrollLeft = x; },
    getMax: () => el.scrollWidth - el.clientWidth,
    // Caller-supplied tokenHolder lets it cancel an in-flight glide externally.
    tokenHolder: tokenHolder || { value: 0 },
  });

  el.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    if (momentum) momentum(e.deltaY); else el.scrollLeft += e.deltaY;
  }, { passive: false });

  el.addEventListener('scroll', () => updateCarouselEdgeFade(el));
  updateCarouselEdgeFade(el);

  // Capture only once movement crosses the threshold, or Chromium retargets plain clicks.
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
  // Module-level, so reorderCarouselWithFlip can cancel an in-flight glide too.
  carouselScrollToken = { value: 0 };
  const carouselDragged = initDragToScroll(carousel, carouselScrollToken);
  updateCarouselHint();
  observeCarouselVisibility();

  contentContainer.querySelectorAll('.project-card').forEach(card => {
    if (card.classList.contains('bookend-card')) return; // decorative, no project behind it

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

      if (activeFilter === 'all') {
        // No manual lock here — reorderCarouselWithFlip blocks pointer-events
        // during the slide, and openProjectWindow arms its own lock.
        reorderCarouselWithFlip(card).then(() => {
          openProjectWindow(title, image, description, gallery);
        });
      } else {
        scrollCarouselToCard(card);
        openProjectWindow(title, image, description, gallery);
      }
    });

    // Clickable/hoverable again as soon as THIS card's own entrance finishes.
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

  // Recompute each visible card's stagger delay from its rank among only the
  // currently-visible cards (coming-soon cards sit after all real ones in the
  // unfiltered list, so a mixed filtered view needs its own left-to-right order).
  let visibleIndex = 0;
  contentContainer.querySelectorAll('.project-card').forEach(card => {
    // Bookends have no data-section — always visible, not tied to one engine.
    const matches = filterKey === 'all' || card.dataset.section === filterKey || card.classList.contains('bookend-card');
    const wasHidden = card.classList.contains('filtered-out');

    if (matches) {
      card.style.animationDelay = `${Math.min(visibleIndex, 12) * 0.05}s`;
      visibleIndex++;
    }

    // Only replay the entrance for cards newly going hidden -> visible.
    if (matches && wasHidden) {
      card.classList.remove('entrance-done');
    }

    card.classList.toggle('filtered-out', !matches);
  });

  // The divider only makes sense in the unfiltered "All Projects" layout.
  const divider = document.getElementById('carousel-divider');
  if (divider) divider.classList.toggle('filtered-out', filterKey !== 'all');

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
let comingSoonMessageTimeout = null;

function showComingSoonMessage(projectTitle) {
  let messageEl = document.getElementById('coming-soon-message');

  if (!messageEl) {
    messageEl = document.createElement('div');
    messageEl.id = 'coming-soon-message';
    messageEl.className = 'coming-soon-message';
    // role="status" + aria-live announces it without stealing focus from a 3s toast.
    messageEl.setAttribute('role', 'status');
    messageEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(messageEl);

    // Registered once — messageEl is reused across calls.
    messageEl.addEventListener('click', (e) => {
      if (e.target === messageEl) {
        messageEl.classList.remove('active');
      }
    });
  }

  messageEl.innerHTML = `
    <div class="coming-soon-content">
      <p><strong>${projectTitle}</strong> is coming soon!</p>
      <p>Stay tuned for updates.</p>
      <button class="coming-soon-close">Close</button>
    </div>
  `;

  messageEl.classList.add('active');

  // Fresh node every call (innerHTML just recreated it), fine to re-add.
  const closeBtn = messageEl.querySelector('.coming-soon-close');
  closeBtn.addEventListener('click', () => {
    messageEl.classList.remove('active');
  });

  // Cancel any pending auto-dismiss from a previous toast before arming a new one.
  if (comingSoonMessageTimeout) clearTimeout(comingSoonMessageTimeout);
  comingSoonMessageTimeout = setTimeout(() => {
    comingSoonMessageTimeout = null;
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
        <a href="/linkedin" class="connect-button" target="_blank" rel="noopener">LinkedIn</a>
        <a href="/github" class="connect-button" target="_blank" rel="noopener">GitHub</a>
        <a href="/artstation" class="connect-button" target="_blank" rel="noopener">ArtStation</a>
      </div>
      <div class="social-icons">
        <a href="/line" target="_blank" rel="noopener" aria-label="Line"><i class="fa-brands fa-line" aria-hidden="true"></i></a>
        <a href="/discord" target="_blank" rel="noopener" aria-label="Discord"><i class="fa-brands fa-discord" aria-hidden="true"></i></a>
        <a href="/instagram" target="_blank" rel="noopener" aria-label="Instagram"><i class="fa-brands fa-square-instagram" aria-hidden="true"></i></a>
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

// Resolves once the new background has fully faded in, so openProjectWindow
// can reveal content only after the background is already visible.
async function setPageBackground(imageUrl) {
  if (!pageBackground) return;

  if (backgroundSwapTimeout) {
    clearTimeout(backgroundSwapTimeout);
    backgroundSwapTimeout = null;
  }

  if (pageBackground.classList.contains('active')) {
    // Already showing art: crossfade instead of snapping to the new image.
    pageBackground.classList.remove('active');
    await new Promise(resolve => {
      backgroundSwapTimeout = setTimeout(() => {
        backgroundSwapTimeout = null;
        resolve();
      }, 400);
    });
  }

  // Preload/decode first so the swap only happens once the art is ready to paint.
  const img = new Image();
  img.src = imageUrl;
  await img.decode().catch(() => {});

  pageBackground.style.backgroundImage = `url('${imageUrl}')`;
  await new Promise(resolve => requestAnimationFrame(resolve));
  pageBackground.classList.add('active');

  // Resolve on transitionend (opacity, 0.4s), with a 450ms fallback in case it never fires.
  await new Promise(resolve => {
    let settled = false;
    const onEnd = e => {
      if (e.target !== pageBackground || e.propertyName !== 'opacity') return;
      settled = true;
      pageBackground.removeEventListener('transitionend', onEnd);
      resolve();
    };
    pageBackground.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      if (settled) return;
      pageBackground.removeEventListener('transitionend', onEnd);
      resolve();
    }, 450);
  });
}

function clearPageBackground() {
  if (!pageBackground) return;
  pageBackground.classList.remove('active');
}

// Safety-net fallback only — releaseTransitionLock (in openProjectWindow)
// normally fires as soon as the reveal animation finishes.
const PROJECT_TRANSITION_LOCK_MS = 3000;

function openProjectWindow(title, image, description, galleryImages) {
  // Ignore clicks mid-transition, so rapid clicking can't desync background/content.
  if (projectTransitionLock) return;

  if (title === currentOpenProjectTitle) return; // already viewing this project

  const panel = document.getElementById('project-detail-panel');
  if (!panel) return;

  // Hide the outgoing project's content before swapping in the new innerHTML
  // below, so the two are never visible at once. revealPanelContent() re-adds
  // .active once the new content and background are ready.
  if (panel.classList.contains('active')) {
    panel.classList.remove('active');
  }

  // Updates "most recently opened first" data; no-op for non-real projects.
  // The visual carousel reorder is a separate step callers trigger themselves.
  bringProjectToFront(title);

  projectTransitionLock = true;
  // Released once the reveal animation finishes (see revealPanelContent below);
  // PROJECT_TRANSITION_LOCK_MS is just a safety-net fallback.
  let lockReleased = false;
  function releaseTransitionLock() {
    if (lockReleased) return;
    lockReleased = true;
    projectTransitionLock = false;
  }
  setTimeout(releaseTransitionLock, PROJECT_TRANSITION_LOCK_MS);

  // Stop the old video and restore music before swapping content — removing
  // a video via innerHTML never fires 'pause'/'ended'.
  if (currentVideo) {
    currentVideo.pause();
    currentVideo.removeEventListener('play', onVideoPlay);
    currentVideo.removeEventListener('pause', onVideoPause);
    currentVideo.removeEventListener('ended', onVideoEnded);
    currentVideo = null;
    restoreAmbientMusic();
  }

  const backgroundReady = setPageBackground(image);

  const galleryToUse = galleryImages && galleryImages.length > 0
    ? galleryImages
    : DEFAULT_GALLERY_IMAGES;

  const galleryHTML = galleryToUse
    .map((imgSrc, index) => `<div class="gallery-item" data-index="${index}" role="button" tabindex="0" aria-label="View gallery image ${index + 1} of ${galleryToUse.length}"><img src="${imgSrc}" alt="Gallery ${index + 1} - ${title}" loading="lazy" class="img-fallback-coming-soon"></div>`)
    .join('');

  const formattedDescription = description ? description.replace(/\n/g, '<br>') : '';

  // Look up the project's own data across every section, for its specific values
  let projectData = null;

  Object.keys(sectionsContent).forEach(sectionKey => {
    const section = sectionsContent[sectionKey];
    if (section && section.projects) {
      const found = section.projects.find(p => p.title === title);
      if (found) {
        projectData = found;
      }
    }
  });

  // Fall back to generic placeholder values if the project isn't found
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

  // Build the tech-tags markup
  const techTagsHTML = projectData.techTags && projectData.techTags.length > 0
    ? projectData.techTags.map(tag => `<span class="tech-tag">${tag}</span>`).join('')
    : '';

  // Build the contributions markup
  const contributionsHTML = projectData.contributions && projectData.contributions.length > 0
    ? projectData.contributions.map(p => `<p>${p}</p>`).join('')
    : '<p>No contributions data available.</p>';

  currentOpenProjectTitle = title;
  updateCarouselHint();

  // Highlight the matching carousel card as "selected".
  contentContainer.querySelectorAll('.project-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.projectTitle === title);
  });

  // Most projects use a click-to-play teaser (`projectData.video`); a few
  // (e.g. the Guerrero model) use a silent looping turntable clip instead
  // (`projectData.media`) — an autoplaying muted <video>.
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
      <div class="project-detail-footer">
        <button class="project-nav-btn project-nav-back" id="project-nav-back">
          <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to all projects
        </button>
      </div>
    </div>
  `;

  // Panel is `display: none` until `.active` is added, so everything above
  // stays invisible regardless of timing — this only runs once the
  // background is fully faded in.
  function revealPanelContent() {
    panel.classList.remove('active'); // force the reveal animation to (re)play
    void panel.offsetWidth;
    panel.classList.add('active');
    updateScrollToProjectBtnVisibility();

    // Releases projectTransitionLock as soon as this reveal animation
    // (projectDetailReveal, 0.45s — see .project-detail-panel.active in
    // style.css) actually finishes.
    panel.addEventListener('animationend', function onReveal(e) {
      if (e.animationName !== 'projectDetailReveal') return;
      panel.removeEventListener('animationend', onReveal);
      releaseTransitionLock();
    });

    const video = document.getElementById('project-video');
    if (video) {
      currentVideo = video;
      handleVideoPlayback(video);
    }

    // Focus the video (or heading, tabindex="-1") so Tab skips the carousel.
    cancelPageScrollAnimation();
    if (video) {
      video.focus({ preventScroll: true });
    } else {
      const heading = document.getElementById('project-detail-heading');
      if (heading) heading.focus({ preventScroll: true });
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

    const backBtn = document.getElementById('project-nav-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        closeProjectWindow();
        const carousel = document.getElementById('projects-carousel');
        if (carousel) smoothScrollTo(window.scrollY + carousel.getBoundingClientRect().top, 800);
      });
    }
  }

  backgroundReady.then(() => setTimeout(revealPanelContent, 200));
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
  if (panel && panel.classList.contains('active')) {
    // Brief fade-out via inline styles (the panel has no CSS transition of
    // its own); prefers-reduced-motion overrides this automatically.
    panel.style.transition = 'opacity 0.2s ease';
    panel.style.opacity = '0';
    setTimeout(() => {
      panel.classList.remove('active');
      panel.innerHTML = '';
      panel.style.opacity = '';
      panel.style.transition = '';
    }, 200);
  } else if (panel) {
    panel.classList.remove('active');
    panel.innerHTML = '';
  }

  // observeCarouselVisibility keeps running — the carousel itself is unaffected.
  scrollToProjectBtn?.classList.remove('visible');
}

/* ============================================================
   MOMENTUM WHEEL SCROLL (page + carousel)
   ============================================================ */
// Replaces native wheel scrolling's fixed step-per-notch with an eased,
// velocity-amplified glide toward a target position. Shared by the page's
// vertical scroll and the carousel/filter-chips' horizontal one.
const REDUCE_MOTION_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOMENTUM_EASE = 0.15;       // per-frame catch-up rate toward the target
const MOMENTUM_BASE_MULT = 1.6;   // baseline amplification over the raw wheel delta
const MOMENTUM_VELOCITY_MULT = 1.6; // extra amplification added for a hard/fast gesture
const MOMENTUM_VELOCITY_REF = 80; // |deltaY| considered "one full unit" of velocity boost

// Drives window.scrollY or an element's scrollLeft via getPos/setPos/getMax.
// tokenHolder lets it coexist with other animated scrollers on the same axis.
function createMomentumWheel({ getPos, setPos, getMax, tokenHolder }) {
  let target = null;
  let rafId = null;
  let myToken = 0;

  function step() {
    if (myToken !== tokenHolder.value) { rafId = null; return; } // superseded
    const current = getPos();
    const diff = target - current;
    if (Math.abs(diff) < 0.5) {
      setPos(target);
      rafId = null;
      return;
    }
    setPos(current + diff * MOMENTUM_EASE);
    // At non-100% browser zoom, a small step can round back to `current`,
    // making no visible progress and looping forever without ever firing
    // another scroll event. Snap to target instead.
    if (getPos() === current) {
      setPos(target);
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(step);
  }

  return function feedDelta(delta) {
    const reclaiming = myToken !== tokenHolder.value;
    myToken = ++tokenHolder.value;
    // Re-sync to the real position unless we're already mid-glide under our own control.
    if (target === null || reclaiming || rafId === null) target = getPos();

    const boost = Math.min(Math.abs(delta) / MOMENTUM_VELOCITY_REF, 1);
    const multiplier = MOMENTUM_BASE_MULT + boost * MOMENTUM_VELOCITY_MULT;
    target = Math.max(0, Math.min(getMax(), target + delta * multiplier));

    if (!rafId) rafId = requestAnimationFrame(step);
  };
}

// Shared by the page's momentum instance and smoothScrollTo (the "View
// Project" button). The carousel has its own token (carouselScrollToken).
const pageScrollToken = { value: 0 };

// Vertical page scroll. Skipped for prefers-reduced-motion and for wheel
// events inside anything with its own scroll (carousel/filter-chips, search).
let pageMomentum = null;
if (!REDUCE_MOTION_MQ.matches) {
  pageMomentum = createMomentumWheel({
    getPos: () => window.scrollY,
    setPos: y => window.scrollTo(0, y),
    getMax: () => document.documentElement.scrollHeight - window.innerHeight,
    tokenHolder: pageScrollToken,
  });

  window.addEventListener('wheel', e => {
    if (e.target.closest('.projects-carousel, .filter-chips, .search-overlay, .lightbox')) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // let horizontal gestures pass through untouched
    e.preventDefault();
    pageMomentum(e.deltaY);
  }, { passive: false });
}

// Call before anything that triggers native scrolling (e.g. focus()), so a
// still-running wheel glide can't fight it for the scroll position.
function cancelPageScrollAnimation() {
  pageScrollToken.value++;
}

/* ============================================================
   SCROLL-TO-PROJECT (floating button)
   ============================================================ */
// Custom eased scroll (gentler than native smooth-scroll). Shares
// pageScrollToken with the page's wheel-momentum instance so they can't fight.
function smoothScrollTo(targetY, duration) {
  const myToken = ++pageScrollToken.value;
  const startY = window.scrollY;
  const distance = targetY - startY;
  if (Math.abs(distance) < 1) return;
  const startTime = performance.now();

  // ease-in-out cubic: gentle at both ends.
  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    if (myToken !== pageScrollToken.value) return; // superseded
    const progress = Math.min((now - startTime) / duration, 1);
    window.scrollTo(0, startY + distance * ease(progress));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Touch scrolling doesn't fire 'wheel' events, so claim the token manually.
window.addEventListener('touchstart', () => { pageScrollToken.value++; }, { passive: true });

// Lands on the panel's own top edge, so the panel's hero video/art ends up
// right at the top of the viewport.
scrollToProjectBtn?.addEventListener('click', () => {
  const panel = document.getElementById('project-detail-panel');
  if (!panel) return;
  smoothScrollTo(window.scrollY + panel.getBoundingClientRect().top, 800);
});

// Visible only while a project is open AND the carousel is in view — once
// scrolled past it, the button's job (jump to content) is already done.
// Re-wired from bindHomeViewEvents since the carousel is rebuilt each render.
let isCarouselInView = true;
let carouselVisibilityObserver = null;

function updateScrollToProjectBtnVisibility() {
  scrollToProjectBtn?.classList.toggle('visible', !!currentOpenProjectTitle && isCarouselInView);
}

function observeCarouselVisibility() {
  carouselVisibilityObserver?.disconnect();

  const carousel = document.getElementById('projects-carousel');
  if (!carousel) return;

  carouselVisibilityObserver = new IntersectionObserver(([entry]) => {
    isCarouselInView = entry.isIntersecting;
    updateScrollToProjectBtnVisibility();
  });
  carouselVisibilityObserver.observe(carousel);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goHome() {
  // A project can be open while already on 'home', so check both.
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
        revealSearchedComingSoon(title);
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

      if (title && image) {
        openSearchedProject(title, image, description, gallery);
      }
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
        revealSearchedComingSoon(title);
      } else {
        const sectionData = sectionsContent[section];
        let gallery = [];
        if (sectionData) {
          const project = sectionData.projects.find(p => p.title === title);
          if (project && project.gallery) {
            gallery = project.gallery;
          }
        }
        openSearchedProject(title, image, description, gallery);
      }
    });
  });
}

// Brings the searched project's card to the front and opens it. Rebuilds the
// home view only when coming from a different section; otherwise just switches
// the filter (which closes any open project itself, see applyFilter).
function openSearchedProject(title, image, description, gallery) {
  if (currentSection === 'home') {
    if (activeFilter !== 'all') applyFilter('all');
  } else {
    goHome();
  }

  const matchedCard = [...contentContainer.querySelectorAll('.project-card')].find(c => c.dataset.projectTitle === title);
  if (matchedCard) {
    reorderCarouselWithFlip(matchedCard).then(() => {
      openProjectWindow(title, image, description, gallery);
    });
  } else {
    openProjectWindow(title, image, description, gallery);
  }
}

// Same idea for a coming-soon project found via search (see openSearchedProject).
function revealSearchedComingSoon(title) {
  if (currentSection === 'home') {
    if (activeFilter !== 'all') applyFilter('all');
  } else {
    goHome();
  }

  const matchedCard = [...contentContainer.querySelectorAll('.project-card')].find(c => c.dataset.projectTitle === title);
  if (matchedCard) scrollCarouselToCard(matchedCard);
  showComingSoonMessage(title);
}

function navigateToSection(section, callback) {
  goHome();
  applyFilter(section);

  if (callback) {
    setTimeout(callback, 150);
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
   LIGHTBOX — gallery image viewer with wrap-around navigation
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
  lightboxImage.alt = 'Enlarged image';
  lightbox.classList.add('active');
  body.style.overflow = 'hidden';
  lightboxClose.focus();

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
  
  // Wrap around at either end instead of stopping.
  const totalImages = currentGalleryImages.length;
  let newIndex = currentGalleryIndex + direction;

  if (newIndex < 0) {
    newIndex = totalImages - 1;
  } else if (newIndex >= totalImages) {
    newIndex = 0;
  }

  currentGalleryIndex = newIndex;
  const newSrc = currentGalleryImages[currentGalleryIndex];

  // Cross-fade to the new image rather than swapping it instantly.
  lightboxImage.style.opacity = '0';
  setTimeout(() => {
    lightboxImage.src = newSrc;
    lightboxImage.alt = 'Enlarged image ' + (currentGalleryIndex + 1);
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
  e.stopPropagation(); // Don't let the click reach the overlay (which would close the lightbox)
  navigateLightbox(-1);
});
lightboxNext.addEventListener('click', function(e) {
  e.stopPropagation(); // Don't let the click reach the overlay (which would close the lightbox)
  navigateLightbox(1);
});

// Lightbox keyboard navigation
document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('active')) trapTabKey(e, lightbox);
  if (e.key === 'Escape' && lightbox.classList.contains('active')) {
    closeLightbox();
    // Stop this Escape from also reaching GLOBAL EVENTS below and closing the project too.
    e.stopImmediatePropagation();
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
    updateCarouselEdgeFade(document.querySelector('.filter-chips'));
    updateCarouselEdgeFade(document.getElementById('projects-carousel'));
    updateCarouselHint();
  }, 250);
});

/* ============================================================
   CUSTOM PAGE SCROLLBAR — overlay, visible only when there's something to scroll
   ============================================================ */
let scrollbarUpdateQueued = false;

// Collapses scroll/resize events into at most one read+write per frame.
function updatePageScrollbar() {
  if (scrollbarUpdateQueued) return;
  scrollbarUpdateQueued = true;

  requestAnimationFrame(() => {
    scrollbarUpdateQueued = false;
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
  });
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