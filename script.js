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

// Front-to-back order of real (non-"coming soon") project titles, once the
// visitor has opened at least one — null means "still the natural
// SECTION_ORDER layout". Persists for the session (survives goHome()
// re-renders and filter changes) but resets on an actual page reload,
// which is the intended "most-recently-opened-first" behavior.
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

// Centralized <img> error fallback, applied to every image on the page
// (present and future) via a single listener instead of an inline
// onerror="..." attribute per tag. Image load errors don't bubble, so this
// listens on the capturing phase instead of delegating the normal way.
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

  // Hovering pauses the auto-dismiss (tracked as remaining time, not just
  // a flag) so leaving mid-countdown resumes with whatever was left rather
  // than a fresh 5s — and if the countdown had already finished while
  // hovered, the remaining time is just ~0, so it dismisses right as the
  // mouse leaves instead of mid-hover.
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
  // Only the loading screen's own logo gates entry into the site — none of
  // the projects' cover/gallery images, which load progressively (lazily,
  // as each card actually scrolls into view) once the visitor is already
  // in. Gating entry on dozens of project images first would make the site
  // feel stuck on a slow connection for little benefit.
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
// Shared token for the carousel's own momentum scroll instance (see
// initDragToScroll/createMomentumWheel) — reassigned fresh each time
// bindHomeViewEvents() runs, and bumped by reorderCarouselWithFlip to
// cancel an in-flight glide before a FLIP reorder starts.
let carouselScrollToken = null;

function getAllProjectsFlat() {
  // Finished work first, "coming soon" placeholders last — so the very
  // first thing anyone sees is 100% real, shippable projects, not a wall
  // that's 60% empty placeholder tiles. Order is stable within each group
  // (still follows SECTION_ORDER), only the real/coming-soon split moves.
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

// Same real-project list getAllProjectsFlat() returns, but reordered to
// match customRealOrderTitles once the visitor has opened something (see
// bringProjectToFront). Rebuilt from the canonical `real` list each call
// rather than caching entry objects directly, so it can never go stale if
// sectionsContent itself changes.
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

// Moves a project to the front of the custom order. No-op for anything
// that isn't a real project (coming-soon cards never participate in this
// — clicking one shows the "coming soon" toast instead of calling this at
// all, but this guard keeps the function itself safe to call with any
// title regardless of caller).
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
  // Only shown when there's something to divide (i.e. at least one
  // coming-soon entry) — a bare divider with nothing muted after it would
  // just be visual noise.
  const dividerHTML = comingSoon.length > 0
    ? `<div class="carousel-divider" id="carousel-divider" aria-hidden="true"><span>More in<br>progress</span></div>`
    : '';
  // Decorative bookends — not real projects, so they're excluded from the
  // click/FLIP-reorder/filter logic in bindHomeViewEvents, reorderCarousel
  // WithFlip, and applyFilter (all three check for .bookend-card).
  const bookendStartHTML = `<div class="project-card bookend-card" aria-hidden="true"><img src="assets/shared/welcome-logo.png" alt="" class="bookend-card-icon"></div>`;
  const bookendEndHTML = `<div class="project-card bookend-card" aria-hidden="true"><img src="assets/shared/grid-logo.png" alt="" class="bookend-card-icon"></div>`;
  // The "grid" bookend sits right after the last *real* project (before the
  // divider/coming-soon tail), not at the true end of the whole carousel.
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
  // A few px of slack so browser-zoom scrollLeft rounding can't strand a
  // real edge a hair short of maxScroll/0 with its fade still showing.
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

// Smoothly slides `card` to the front of the carousel using the FLIP
// technique (First/Last/Invert/Play): measure where every real card
// currently sits, move the clicked one first in the DOM (which snaps
// everyone to their new flex positions instantly, invisibly), then counter
// -animate each card from its old position back to its new one so the
// whole reshuffle reads as one continuous slide rather than a jump cut.
// Only real (non-"coming soon") cards ever participate, both because the
// caller only invokes this for real projects and as a second line of
// defense in the query below. Resolves once the slide has finished (or
// immediately if the card was already at the front / nothing to animate).
const FLIP_DURATION_MS = 450;

function reorderCarouselWithFlip(card) {
  return new Promise(resolve => {
    const carousel = document.getElementById('projects-carousel');
    if (!carousel || !card) { resolve(); return; }

    const realCards = [...carousel.querySelectorAll('.project-card:not(.coming-soon):not(.bookend-card)')];
    if (realCards[0] === card) { resolve(); return; }

    // A momentum glide from an earlier wheel scroll could still be mid-
    // flight and keep nudging scrollLeft on its own during the FLIP below,
    // fighting the transforms this sets up. Bumping the shared token tells
    // that loop's next frame to stop.
    if (carouselScrollToken) carouselScrollToken.value++;

    // Measure every card's *actual current* on-screen position before
    // resetting scrollLeft, so the FLIP animation slides from wherever the
    // visitor was actually looking instead of from the scrolled-to-start
    // position.
    const firstRects = new Map(realCards.map(c => [c, c.getBoundingClientRect()]));

    // Now it's safe to snap the viewport back to the start in the same
    // synchronous tick as the reorder below, so the delta computed against
    // firstRects captures both the scroll reset and the reorder as one
    // continuous slide.
    carousel.scrollLeft = 0;
    // Insert before the current first *real* card (not carousel.firstChild)
    // so the decorative bookend card at the very start of the carousel
    // (see renderHomeView) stays in front of everything, even after a
    // reorder.
    carousel.insertBefore(card, realCards[0]);

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

    // Blocks hover/pointer interaction on every card (see
    // .projects-carousel.reordering in style.css) for the duration of the
    // slide — without this, hovering a card mid-FLIP would trigger its own
    // hover transform/shine on top of the one currently being animated by
    // the FLIP itself, fighting over the same `transform` property.
    carousel.classList.add('reordering');

    // Flush the instant "jump back" transforms above before switching
    // transitions back on, or the browser would coalesce it with the next
    // change and just animate from the *final* position (i.e. not at all).
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

// Wires up wheel-to-horizontal-scroll, edge-fade tracking, and click-and-drag
// (touch-like) scrolling for any horizontally-scrolling row (the project
// carousel, the filter chips row). Returns a `wasDragged()` getter so
// callers can suppress a click that was actually the tail end of a drag.
function initDragToScroll(el, tokenHolder) {
  if (!el) return () => false;

  // Same momentum/velocity-amplified easing as the page's own vertical
  // scroll (see createMomentumWheel), so the carousel glides across wheel
  // notches instead of snapping one flat `scrollLeft += deltaY` step per
  // notch.
  const momentum = REDUCE_MOTION_MQ.matches ? null : createMomentumWheel({
    getPos: () => el.scrollLeft,
    setPos: x => { el.scrollLeft = x; },
    getMax: () => el.scrollWidth - el.clientWidth,
    // A caller-supplied tokenHolder (the carousel passes carouselScrollToken)
    // lets that caller cancel an in-flight glide from outside this closure —
    // otherwise each element just owns its own token as before.
    tokenHolder: tokenHolder || { value: 0 },
  });

  el.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    if (momentum) momentum(e.deltaY); else el.scrollLeft += e.deltaY;
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
  // Kept in the module-level carouselScrollToken so reorderCarouselWithFlip
  // (defined elsewhere) can cancel an in-flight momentum glide before it
  // starts a FLIP reorder.
  carouselScrollToken = { value: 0 };
  const carouselDragged = initDragToScroll(carousel, carouselScrollToken);
  updateCarouselHint();
  observeCarouselVisibility();

  contentContainer.querySelectorAll('.project-card').forEach(card => {
    // Decorative bookends (see renderHomeView) — no project behind them,
    // so they stay out of the click/keyboard/entrance-animation wiring
    // below entirely.
    if (card.classList.contains('bookend-card')) return;

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
        // Bring the clicked project to the front of the carousel instead
        // of just scrolling the viewport to it. No manual projectTransitionLock
        // here — reorderCarouselWithFlip already blocks pointer-events on
        // every card for the slide's duration (see .reordering in
        // style.css), and openProjectWindow arms its own lock the instant
        // it runs; locking here too would just stack both durations
        // instead of letting them overlap.
        reorderCarouselWithFlip(card).then(() => {
          openProjectWindow(title, image, description, gallery);
        });
      } else {
        // Filtered to a specific engine: just scrolls the viewport to the
        // card, no reorder.
        scrollCarouselToCard(card);
        openProjectWindow(title, image, description, gallery);
      }
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

  // Each card's stagger delay (set inline by projectCardHTML) is based on
  // its position in the full, unfiltered list — fine for "All Projects",
  // but every coming-soon card sits after all the real ones in that list
  // (see getAllProjectsFlat), so a filtered view that mixes both needs its
  // own delay recomputed from each card's rank among only the currently-
  // visible cards, or it would animate out of left-to-right order. Doesn't
  // touch cardFadeUp itself (same animation, same duration/easing — just a
  // truthful "which number am I now" delay).
  let visibleIndex = 0;
  contentContainer.querySelectorAll('.project-card').forEach(card => {
    // Bookends have no data-section (they're not real projects) — they
    // stay visible across every filter instead of only matching "All
    // Projects", since they bookend the carousel itself, not any one
    // engine's subset of it.
    const matches = filterKey === 'all' || card.dataset.section === filterKey || card.classList.contains('bookend-card');
    const wasHidden = card.classList.contains('filtered-out');

    if (matches) {
      card.style.animationDelay = `${Math.min(visibleIndex, 12) * 0.05}s`;
      visibleIndex++;
    }

    // Only cards that are actually about to go from hidden -> visible need
    // their entrance replayed (and re-locked until it finishes). Cards that
    // were already visible and stay visible are untouched, so they don't
    // needlessly re-animate or lose clickability on every filter change.
    if (matches && wasHidden) {
      card.classList.remove('entrance-done');
    }

    card.classList.toggle('filtered-out', !matches);
  });

  // The "More in progress" divider only makes sense in the unfiltered,
  // real-then-coming-soon layout of the "All Projects" view — hide it for
  // any specific engine filter, where cards are just matches/non-matches.
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
    // role="status" + aria-live so a screen reader announces the toast on
    // its own — it self-dismisses in 3s, so moving focus to it (the usual
    // way to announce new content) would be disruptive rather than helpful.
    messageEl.setAttribute('role', 'status');
    messageEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(messageEl);

    // Registered once here, not on every showComingSoonMessage call below —
    // messageEl itself is reused across calls, so re-adding this each time
    // would stack up a fresh listener per call.
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

  // Fresh node every call (innerHTML above just recreated it), so this one
  // is fine to re-add each time.
  const closeBtn = messageEl.querySelector('.coming-soon-close');
  closeBtn.addEventListener('click', () => {
    messageEl.classList.remove('active');
  });

  // Cancel any still-pending auto-dismiss from a previous toast before
  // arming a new one — without this, opening a second "coming soon" card
  // while the first toast's 3s timer was still running let that old timer
  // dismiss the *new* toast early.
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

// Returns a Promise that resolves once the new background image has fully
// faded in (immediately for the first project opened; after the ~400ms
// crossfade-out when switching between projects). openProjectWindow awaits
// this before revealing the panel content, so the background is always
// fully visible *before* the new project's content appears, never after
// or (worse) at the same time as it's still catching up.
async function setPageBackground(imageUrl) {
  if (!pageBackground) return;

  if (backgroundSwapTimeout) {
    clearTimeout(backgroundSwapTimeout);
    backgroundSwapTimeout = null;
  }

  if (pageBackground.classList.contains('active')) {
    // Already showing a project's art (switching project-to-project):
    // crossfade instead of snapping straight to the new image.
    pageBackground.classList.remove('active');
    await new Promise(resolve => {
      backgroundSwapTimeout = setTimeout(() => {
        backgroundSwapTimeout = null;
        resolve();
      }, 400);
    });
  }

  // Preload (and decode, where supported) before ever touching
  // backgroundImage, so the element only switches to the new URL once that
  // art is actually ready to paint, rather than sitting on a blank rect on
  // a slow connection while it downloads. A decode() failure (bad/aborted
  // image) is swallowed so it can't leave the sequence stuck.
  const img = new Image();
  img.src = imageUrl;
  await img.decode().catch(() => {});

  pageBackground.style.backgroundImage = `url('${imageUrl}')`;
  await new Promise(resolve => requestAnimationFrame(resolve));
  pageBackground.classList.add('active');

  // Resolve once the fade-in transition (opacity, 0.4s — see .page-
  // background in style.css) actually finishes, with a ~450ms fallback in
  // case transitionend never fires (e.g. prefers-reduced-motion collapses
  // the duration to ~0 and the browser skips the event for it).
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

// Safety-net fallback only (see releaseTransitionLock in openProjectWindow,
// which normally releases the lock as soon as the reveal animation actually
// finishes) — generous enough to cover a slow-loading background image on
// top of the worst case ~400ms bg crossfade-out + 400ms fade-in + 450ms
// panel reveal, so the UI can never get stuck locked if that path fails.
const PROJECT_TRANSITION_LOCK_MS = 3000;

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

  // Switching straight from an already-open project: hide its content now,
  // before the new innerHTML is assigned below, so the outgoing project's
  // markup is never visible at the same time as (or replaced in place by)
  // the incoming one. revealPanelContent() re-adds .active once the new
  // content and background are actually ready.
  if (panel.classList.contains('active')) {
    panel.classList.remove('active');
  }

  // Updates the *data* behind "most recently opened first" regardless of
  // how the project was opened (direct carousel click or via search) — a
  // no-op for anything that isn't a real project. The visual reorder
  // (sliding the clicked card to the front of the carousel) is a separate,
  // opt-in step some callers trigger themselves before calling this
  // function; this just keeps the underlying order itself always current,
  // so the next unfiltered render reflects it either way.
  bringProjectToFront(title);

  projectTransitionLock = true;
  // Released the moment the reveal animation (projectDetailReveal, inside
  // revealPanelContent below) actually finishes. PROJECT_TRANSITION_LOCK_MS
  // is only a safety-net fallback for the rare case that path never runs
  // (e.g. the background image never finishes loading), so the UI can't
  // get stuck locked.
  let lockReleased = false;
  function releaseTransitionLock() {
    if (lockReleased) return;
    lockReleased = true;
    projectTransitionLock = false;
  }
  setTimeout(releaseTransitionLock, PROJECT_TRANSITION_LOCK_MS);

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

  // Highlight the matching carousel card as "selected" (slightly bigger,
  // no hover) so it's obvious which project the open panel belongs to.
  contentContainer.querySelectorAll('.project-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.projectTitle === title);
  });

  // Most projects show a click-to-play teaser video, declared explicitly
  // per-project via `projectData.video`. Some (e.g. the Guerrero model)
  // don't have a teaser and use a silent, looping turntable clip instead —
  // declared via `projectData.media`. That clip is an autoplaying muted
  // <video> (the `project-media-gif` class name is legacy — it reads like
  // a GIF but is a far smaller video file).
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

  // The panel itself is `display: none` until `.active` is added (see
  // .project-detail-panel in style.css), so everything above this point —
  // building and assigning the HTML included — is invisible regardless of
  // timing. That's what lets the reveal itself wait for the background:
  // this only runs once setPageBackground's promise resolves, which happens
  // only after the background's own fade-in transition has fully finished —
  // so the background is already fully visible by the time the content
  // reveal plays.
  function revealPanelContent() {
    // Force the reveal animation to (re)play even when the panel is
    // already open and we're just swapping to a different project.
    panel.classList.remove('active');
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
    //
    // focus() by default triggers the browser's own scroll-into-view, which
    // our custom scroll systems know nothing about — an in-flight wheel-
    // momentum glide (e.g. from scrolling the home page right before
    // clicking a card) would fight that native scroll for control of the
    // position every frame, making the page jump one way and then snap
    // back the other. cancelPageScrollAnimation() cancels any such glide,
    // and preventScroll stops focus() from scrolling at all — the page
    // should never move just because a project opened.
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
        // Use the same custom easing as the rest of the page's scrolling
        // (smoothScrollTo) instead of the browser's native smooth scroll,
        // for a consistent feel.
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
    // Brief fade-out instead of cutting the content away instantly.
    // .project-detail-panel has no fade-out transition of its own (only
    // the reveal-in animation), so this drives one via inline styles; the
    // global prefers-reduced-motion rule (transition-duration: 0.01ms
    // !important) overrides it automatically for users who need that.
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

  // The carousel-visibility observer (see observeCarouselVisibility) isn't
  // touched here — it tracks the carousel itself, which is still on screen
  // and unchanged by closing a project, and keeps running so it's already
  // correctly set up if another project gets opened next.
  scrollToProjectBtn?.classList.remove('visible');
}

/* ============================================================
   MOMENTUM WHEEL SCROLL (page + carousel)
   ============================================================ */
// Native wheel scrolling moves a small, fixed step per notch — covering
// any real amount of content takes a lot of individual scroll ticks. This
// replaces that with a target position that every wheel tick nudges
// (amplified more the harder/faster the gesture is) and the actual scroll
// position eases toward every frame, so a quick burst of ticks blends into
// one continuous glide instead of a series of small, separate jumps, and a
// single hard flick covers noticeably more ground than a gentle nudge.
// Shared by the page's own vertical scroll and the carousel/filter-chips'
// horizontal one (see createMomentumWheel below) so both feel the same.
const REDUCE_MOTION_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOMENTUM_EASE = 0.15;       // per-frame catch-up rate toward the target
const MOMENTUM_BASE_MULT = 1.6;   // baseline amplification over the raw wheel delta
const MOMENTUM_VELOCITY_MULT = 1.6; // extra amplification added for a hard/fast gesture
const MOMENTUM_VELOCITY_REF = 80; // |deltaY| considered "one full unit" of velocity boost

// getPos/setPos/getMax let the same easing + amplification logic drive
// either window.scrollY (the page) or an element's scrollLeft (the
// carousel) — each caller just supplies how to read/write/clamp its own
// axis. Returns a function you feed raw wheel deltas into.
//
// `tokenHolder` ({ value: N }) is what makes this safe to run alongside
// *other* animated scrollers on the same axis (specifically: the page's
// own momentum instance vs. the "View Project" button's smoothScrollTo,
// below — both share one holder). Every driver increments the shared
// value when it wants control and only keeps stepping while its own
// snapshot still matches the live value, so whichever one moved last
// simply wins instead of two rAF loops fighting the browser for scrollTop
// every frame — which is what two scrollers would otherwise do if a wheel-
// driven glide was still in flight when something else (the button, or
// focus()'s own native scroll-into-view) also tried to move the same
// scroll position.
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
    // At non-100% browser zoom, the browser can round scrollLeft to its own
    // sub-pixel grid — a small enough step (near the end of the glide) can
    // round right back to `current`, making no visible progress. Without
    // this, that reads as "not there yet" forever: the loop keeps re-
    // running the same no-op step, never reaches `target`, and — since the
    // position genuinely never changes — never fires another native scroll
    // event either, so whatever listens for one (e.g. the carousel's edge-
    // fade class) never finds out the glide is effectively done.
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
    // Re-sync to the real current position whenever we're not already
    // mid-glide under our own control (someone else may have moved the
    // scroll position since our last tick) — only accumulate onto the
    // existing target while our own animation is the one actively
    // chasing it.
    if (target === null || reclaiming || rafId === null) target = getPos();

    const boost = Math.min(Math.abs(delta) / MOMENTUM_VELOCITY_REF, 1);
    const multiplier = MOMENTUM_BASE_MULT + boost * MOMENTUM_VELOCITY_MULT;
    target = Math.max(0, Math.min(getMax(), target + delta * multiplier));

    if (!rafId) rafId = requestAnimationFrame(step);
  };
}

// Shared by the page's momentum instance below and smoothScrollTo (the
// "View Project" button) — see createMomentumWheel's comment above for
// why. The carousel gets its own separate holder (carouselScrollToken, set
// up in bindHomeViewEvents) since it animates a different axis — that one
// is still shared with reorderCarouselWithFlip, so a FLIP reorder can
// cancel an in-flight carousel glide.
const pageScrollToken = { value: 0 };

// Vertical page scroll. Skipped entirely for prefers-reduced-motion (plain
// native scrolling instead) and for wheel events landing inside anything
// that manages its own scroll — the carousel/filter-chips (handled by
// their own momentum instance in initDragToScroll below) and the search
// overlay's results list, which would otherwise have the page behind it
// hijacked instead of its own content.
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

// Explicitly hands control of the page scroll back to "nobody" — call this
// right before anything that triggers the *browser's own* scrolling (like
// focus() on a newly-revealed element), so a still-running wheel glide
// from before that moment can't keep dragging the position around while
// the native scroll is also trying to move it.
function cancelPageScrollAnimation() {
  pageScrollToken.value++;
}

/* ============================================================
   SCROLL-TO-PROJECT (floating button)
   ============================================================ */
// Custom eased scroll instead of the native scrollIntoView/scrollTo
// smooth-scroll — browsers' built-in "smooth" easing is fixed and fairly
// brisk, not the gentle slide-in feel this button wants. Same
// requestAnimationFrame + easing approach as the rest of the site's custom
// animations (the FLIP carousel reorder, the pulse rings). Shares
// pageScrollToken with the page's own wheel-momentum instance (see
// createMomentumWheel above) so the two can never fight over scrollY —
// whichever one starts most recently simply wins.
function smoothScrollTo(targetY, duration) {
  const myToken = ++pageScrollToken.value;
  const startY = window.scrollY;
  const distance = targetY - startY;
  if (Math.abs(distance) < 1) return;
  const startTime = performance.now();

  // ease-in-out cubic: gentle at both ends, matches "slide in" rather than
  // the more mechanical linear/ease-out feel of a native smooth scroll.
  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    // A newer smoothScrollTo call, a fresh wheel-momentum glide, or a
    // manual touch scroll (see the touchstart listener below) has taken
    // over; stop fighting it for control of the scroll position.
    if (myToken !== pageScrollToken.value) return;
    const progress = Math.min((now - startTime) / duration, 1);
    window.scrollTo(0, startY + distance * ease(progress));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Touch scrolling doesn't fire 'wheel' events, so the page-momentum
// listener never sees it and never claims pageScrollToken on its own —
// without this, a manual touch-scroll mid-animation would just get
// overridden back onto the animated path every frame until the
// animation's own duration ran out.
window.addEventListener('touchstart', () => { pageScrollToken.value++; }, { passive: true });

// Lands on the panel's own top edge rather than centering/nudging it, so
// the carousel above scrolls fully out of view while the panel's hero
// video/art — the first thing the project actually shows — ends up right
// at the top of the viewport, leaving the rest of the screen for content.
scrollToProjectBtn?.addEventListener('click', () => {
  const panel = document.getElementById('project-detail-panel');
  if (!panel) return;
  smoothScrollTo(window.scrollY + panel.getBoundingClientRect().top, 800);
});

// The button's job is "jump down to the content you can't see yet" — once
// the carousel itself has scrolled out of view, that job is already done
// (the visitor is already looking at the project content, whether they
// clicked the button or just scrolled there manually), so it hides right
// away instead of waiting for them to reach the bottom of that content.
// Scrolling back up and bringing the carousel back into view brings the
// button back too. The carousel element is rebuilt fresh every
// renderHomeView() call, so this is (re)wired from bindHomeViewEvents
// rather than tied to individual project open/close cycles.
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
            const matchedCard = [...contentContainer.querySelectorAll('.project-card')].find(c => c.dataset.projectTitle === title);
            if (matchedCard) scrollCarouselToCard(matchedCard);
            openProjectWindow(title, image, description, gallery);
          }, 300);
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
              const matchedCard = [...contentContainer.querySelectorAll('.project-card')].find(c => c.dataset.projectTitle === title);
              if (matchedCard) scrollCarouselToCard(matchedCard);
              openProjectWindow(title, image, description, gallery);
            }, 300);
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

  // The gallery wraps around, so the nav buttons are always available
  // whenever there's more than one image.
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
    // Stop this Escape from also reaching the GLOBAL EVENTS keydown
    // listener further down, which would otherwise see the project panel
    // still .active and close that too. Escape with the lightbox open
    // should only close the lightbox; a second Escape press then closes
    // the project.
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
let scrollbarUpdateQueued = false;

// Native 'scroll' events can fire more than once per frame (and definitely
// fire on every 'resize'/ResizeObserver tick too), each one doing a
// read-then-write on layout properties. Collapsing all of that into at
// most one read+write per animation frame keeps it from ever competing
// with the browser's own paint work during an active scroll or resize.
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