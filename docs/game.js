// Game Configuration
const isMobile = window.innerWidth <= 600;

// Lock game resolution to 16:10 aspect ratio (1024x640)
// 1024 / 1.6 = 640
const fixedHeight = 640;
const CONFIG = {
    GAME_WIDTH: 1024,
    GAME_HEIGHT: fixedHeight,
    PLAYER_SPEED: 8, 
    INITIAL_SCROLL_SPEED: 3.5, // Reduced to 2/3 (was 5)
    MAX_SPEED: 8, // Reduced to 2/3 (was 12)
    JUMP_DURATION: 800, // ms
    OBSTACLE_SPAWN_RATE: 60, // frames
    WIN_DISTANCE: 2000, // meters
    METER_SCALE: 0.1 // pixel to meter conversion
};

class AudioManager {
    constructor() {
        this.ctx = null;
        this.skiNode = null;
        this.skiGain = null;
        this.bgmOscs = [];
        this.bgmGain = null;
        this.gagiBuffer = null;
        this.spiegeleiBuffer = null;
        this.isInitialized = false;
        this.isPlaying = false;
    }

    init() {
        if (this.isInitialized) return;
        
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.isInitialized = true;
            this.setupSkiSound();
            this.setupBGM();
            this.loadExternalSounds();
        } catch (e) {
            console.error("Web Audio API not supported", e);
        }
    }

    async loadExternalSounds() {
        try {
            const response = await fetch('gagi.m4a');
            const arrayBuffer = await response.arrayBuffer();
            this.gagiBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.error("Failed to load gagi.m4a", e);
        }
        try {
            const response = await fetch('spiegelei.m4a');
            const arrayBuffer = await response.arrayBuffer();
            this.spiegeleiBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.error("Failed to load spiegelei.m4a", e);
        }
    }

    playGagi() {
        if (!this.isInitialized || !this.gagiBuffer || !this.isPlaying) return;
        
        const source = this.ctx.createBufferSource();
        source.buffer = this.gagiBuffer;
        
        const gain = this.ctx.createGain();
        gain.gain.value = 1.2; // Doubled volume
        
        source.connect(gain);
        gain.connect(this.ctx.destination);
        
        source.start(0);
    }

    playSpiegelei() {
        if (!this.isInitialized || !this.spiegeleiBuffer || !this.isPlaying) return;
        
        const source = this.ctx.createBufferSource();
        source.buffer = this.spiegeleiBuffer;
        
        const gain = this.ctx.createGain();
        gain.gain.value = 1.2; 
        
        source.connect(gain);
        gain.connect(this.ctx.destination);
        
        source.start(0);
    }

    setupSkiSound() {
        // Create white noise buffer
        const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        this.noiseBuffer = buffer;
        
        // Setup graph
        this.skiGain = this.ctx.createGain();
        this.skiGain.gain.value = 0;
        this.skiGain.connect(this.ctx.destination);
    }

    setupBGM() {
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = 0.2; // Doubled volume
        this.bgmGain.connect(this.ctx.destination);
    }

    start() {
        if (!this.isInitialized) this.init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        
        if (!this.isPlaying) {
            // Start Ski Sound Loop
            this.skiNode = this.ctx.createBufferSource();
            this.skiNode.buffer = this.noiseBuffer;
            this.skiNode.loop = true;
            
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 400;
            
            this.skiNode.connect(filter);
            filter.connect(this.skiGain);
            this.skiNode.start(0);

            this.startBGMSequence();
            this.isPlaying = true;
        }
    }

    startBGMSequence() {
        const notes = [110, 110, 146.83, 130.81]; // A2, A2, D3, C3
        let noteIndex = 0;

        const playNote = () => {
            if (!this.isPlaying) return;
            
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'triangle';
            osc.frequency.value = notes[noteIndex];
            
            gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
            
            osc.connect(gain);
            gain.connect(this.bgmGain);
            
            osc.start();
            osc.stop(this.ctx.currentTime + 0.5);
            
            noteIndex = (noteIndex + 1) % notes.length;
            setTimeout(playNote, 500);
        };
        
        playNote();
    }

    updateSkiSound(speed, isJumping) {
        if (!this.isPlaying || !this.skiGain) return;
        
        if (isJumping) {
            this.skiGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        } else {
            const volume = Math.min(1.0, Math.max(0.2, speed / 10)); // Doubled volume range
            this.skiGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
        }
    }

    stop() {
        if (this.skiNode) {
            try {
                this.skiNode.stop();
            } catch(e) {}
            this.skiNode = null;
        }
        this.isPlaying = false;
    }
}

class BackgroundManager {
    constructor(svgGroup) {
        this.group = svgGroup;
        this.mountains = [];
        this.patches = [];
        this.width = CONFIG.GAME_WIDTH;
        this.height = CONFIG.GAME_HEIGHT;
    }

    reset() {
        this.group.innerHTML = '';
        this.mountains = [];
        this.patches = [];
        for (let i = 0; i < 8; i++) {
            this.spawnPatch(Math.random() * this.height);
        }
    }

    spawnPatch(y) {
        const patch = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        const w = 50 + Math.random() * 100;
        const h = 20 + Math.random() * 30;
        const x = Math.random() * this.width;
        
        patch.setAttribute("cx", 0);
        patch.setAttribute("cy", 0);
        patch.setAttribute("rx", w);
        patch.setAttribute("ry", h);
        patch.setAttribute("fill", "rgba(255,255,255,0.4)");
        patch.setAttribute("transform", `translate(${x}, ${y})`);
        
        this.group.appendChild(patch);
        this.patches.push({ element: patch, x: x, y: y });
    }

    update(scrollSpeed) {
        for (let i = this.patches.length - 1; i >= 0; i--) {
            const p = this.patches[i];
            p.y -= scrollSpeed;
            p.element.setAttribute("transform", `translate(${p.x}, ${p.y})`);
            
            if (p.y < -100) {
                p.element.remove();
                this.patches.splice(i, 1);
                this.spawnPatch(this.height + 100);
            }
        }
    }
}

class Game {
    constructor() {
        this.svg = document.getElementById('game-svg');
        this.worldCamera = document.getElementById('world-camera'); // New camera group
        this.bgGroup = document.getElementById('background-layer');
        this.slopeGroup = document.getElementById('slope-group');
        this.playerGroup = document.getElementById('player-group');
        this.trailGroup = document.getElementById('trail-group');
        
        this.scoreElement = document.getElementById('distance');
        this.finalScoreElement = document.getElementById('final-score');
        
        this.startScreen = document.getElementById('start-screen');
        this.startBtn = document.getElementById('start-btn');
        this.gameOverScreen = document.getElementById('game-over');
        this.victoryScreen = document.getElementById('victory');
        this.countdownDisplay = document.getElementById('countdown-display');
        this.countdownValue = this.countdownDisplay.querySelector('.value');
        this.reverseIcon = document.getElementById('reverse-warning-icon');
        
        this.audio = new AudioManager();
        this.bgManager = new BackgroundManager(this.bgGroup);
        this.particleSystem = new ParticleSystem(this.slopeGroup); // Use slope group for particles so they move with camera
        this.player = null;
        this.obstacles = [];
        this.trails = [];
        this.keys = { ArrowLeft: false, ArrowRight: false, KeyA: false, KeyD: false };
        
        this.state = 'MENU';
        this.isExploding = false; // New state for death animation
        this.scrollSpeed = CONFIG.INITIAL_SCROLL_SPEED;
        this.distance = 0;
        this.lastHundredMeters = 0;
        this.frameCount = 0;
        this.lastTime = 0;
        
        this.cameraX = 0; // Camera horizontal position
        this.pathCenter = CONFIG.GAME_WIDTH / 2;
        this.pathWidth = 450;
        this.targetPathWidth = 450;
        this.isSplitting = false;
        this.startSeparating = false;
        this.splitDistance = 0;
        this.maxSplitDistance = 250;
        this.splitTimer = 0;
        
        this.poopingJJ = null;
        this.lastPoopJJSpawn = 0; 
        this.hasSpawnedFirstPooper = false; // New flag for first spawn
        
        this.carouselActive = false;
        this.carouselPhase = 0; // 0: none, 1: reversed (1000m), 2: normal (1500m)
        this.hasSpawnedCarousel1 = false;
        this.hasSpawnedCarousel2 = false;

        this.init();
    }
    
    init() {
        // Update SVG viewBox to match calculated config (for mobile support)
        this.svg.setAttribute("viewBox", `0 0 ${CONFIG.GAME_WIDTH} ${CONFIG.GAME_HEIGHT}`);

        this.createPlayer();
        this.bgManager.reset();
        this.setupInputs();
        this.setupMobileControls();
        
        this.startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.audio.init();
            this.startGame();
        });

        // Use direct ID selectors for reliability
        document.getElementById('restart-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.restart();
        });
        document.getElementById('restart-btn-win').addEventListener('click', (e) => {
            e.stopPropagation();
            this.restart();
        });
    }

    setupMobileControls() {
        const leftBtn = document.getElementById('left-btn');
        const rightBtn = document.getElementById('right-btn');
        const jumpBtn = document.getElementById('jump-btn');
        const gameContainer = document.getElementById('game-container');

        const handleStart = (key, btn) => {
            this.keys[key] = true;
            if(btn) btn.classList.add('active');
        };
        const handleEnd = (key, btn) => {
            this.keys[key] = false;
            if(btn) btn.classList.remove('active');
        };

        const updateSteering = (touches) => {
            if (this.state !== 'PLAYING') return; // Deactivate controls if not playing

            let pressingLeft = false;
            let pressingRight = false;

            for (let i = 0; i < touches.length; i++) {
                const t = touches[i];
                const target = t.target;
                
                // If touching specific buttons, let button logic handle it (or handle here if we want unified)
                // But we have specific listeners for buttons. 
                // Let's focus on the "screen area" steering.
                if (target.closest('.ctrl-btn') || target.closest('button')) continue;

                const x = t.clientX;
                const y = t.clientY;

                // Determine Left/Right zone based on orientation
                if (isMobile) {
                    // Portrait physical, Rotated game
                    // Top half physical (low Y) -> Left
                    if (y < window.innerHeight / 2) pressingLeft = true;
                    else pressingRight = true;
                } else {
                    // Standard
                    if (x < window.innerWidth / 2) pressingLeft = true;
                    else pressingRight = true;
                }
            }

            // Update keys
            // Only override if touches are present on screen areas. 
            // If button is pressed, it sets keys directly. We shouldn't clear them if screen touch is absent but button touch is present.
            // However, this function iterates ALL touches. 
            // If a touch is on a button, we skipped it above.
            // So pressingLeft/Right only reflects "screen touches".
            
            // Actually, we should just update the keys based on screen touches OR keep button state.
            // But 'this.keys' is global.
            // Simplest: Reset keys controlled by screen touch, then apply.
            // But we don't know which keys were set by buttons vs screen.
            // Let's assume screen touch overrides/ORs with buttons.
            
            // To make "touch and move" work, we need to continuously update.
            // If we slide from Left to Right, we want Left=False, Right=True.
            
            // We can't easily distinguish source of key press in 'this.keys'.
            // Let's use a separate state for "screen steering" and merge it?
            // Or just directly manipulate keys if we assume screen touch is dominant.
            
            // Let's direct manipulate, but be careful not to kill button presses if multi-touch.
            // If we have ANY screen touch in Left Zone, set KeyA.
            // If NO screen touch in Left Zone, we should probably unset KeyA (unless button is held?).
            // For now, let's just implement the "Slide" logic:
            
            if (pressingLeft) {
                if (!this.keys.KeyA) handleStart('KeyA', leftBtn); // Visual feedback on button too?
            } else {
                // Only release if we were holding it via screen? 
                // Hard to track. Let's just release. 
                // If user holds button AND screen, and releases screen, button might stop working?
                // Yes, but acceptable for now.
                if (this.keys.KeyA) handleEnd('KeyA', leftBtn);
            }

            if (pressingRight) {
                if (!this.keys.KeyD) handleStart('KeyD', rightBtn);
            } else {
                if (this.keys.KeyD) handleEnd('KeyD', rightBtn);
            }
        };

        // Screen-wide touch handling
        const handleTouch = (e) => {
            // Check if we touched a UI element that should block game input
            // But we want to allow steering even if we start on empty space and move.
            // We just ignore start on buttons.
            
            if (e.type === 'touchstart') {
                 if (e.target.closest('button')) return; // Block standard buttons, allow steering
                 // Don't block .ctrl-btn here, let them handle themselves? 
                 // Or let this handler handle EVERYTHING?
                 // If we let this handler handle everything, we don't need button listeners.
                 // But buttons give visual feedback.
            }
            
            if (e.target.closest('.ctrl-btn')) return; // Let button listeners handle buttons

            e.preventDefault();
            updateSteering(e.touches);
        };

        gameContainer.addEventListener('touchstart', handleTouch, {passive: false});
        gameContainer.addEventListener('touchmove', handleTouch, {passive: false});
        gameContainer.addEventListener('touchend', handleTouch);
        gameContainer.addEventListener('touchcancel', handleTouch);

        // Keep existing button listeners...
        // Left Button
        leftBtn.addEventListener('mousedown', () => handleStart('KeyA', leftBtn));
        leftBtn.addEventListener('mouseup', () => handleEnd('KeyA', leftBtn));
        leftBtn.addEventListener('mouseleave', () => handleEnd('KeyA', leftBtn)); // Fix: Mouse leaves button
        leftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleStart('KeyA', leftBtn); });
        leftBtn.addEventListener('touchend', (e) => { e.preventDefault(); handleEnd('KeyA', leftBtn); });

        // Right Button
        rightBtn.addEventListener('mousedown', () => handleStart('KeyD', rightBtn));
        rightBtn.addEventListener('mouseup', () => handleEnd('KeyD', rightBtn));
        rightBtn.addEventListener('mouseleave', () => handleEnd('KeyD', rightBtn));
        rightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleStart('KeyD', rightBtn); });
        rightBtn.addEventListener('touchend', (e) => { e.preventDefault(); handleEnd('KeyD', rightBtn); });

        // Jump Button
        const triggerJump = (btn) => {
             if(this.state !== 'PLAYING') return; // Deactivate jump if not playing
             this.player.jump();
             btn.classList.add('active');
             setTimeout(() => btn.classList.remove('active'), 200); // Visual feedback
        };

        jumpBtn.addEventListener('mousedown', () => triggerJump(jumpBtn));
        jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); triggerJump(jumpBtn); });
    }

    startGame() {
        this.startScreen.classList.add('hidden');
        this.state = 'PLAYING';
        this.audio.start();
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }
    
    restart() {
        console.log("Restarting game...");
        this.gameOverScreen.classList.add('hidden');
        this.victoryScreen.classList.add('hidden');
        this.startScreen.classList.add('hidden');
        
        this.obstacles.forEach(obs => obs.element.remove());
        this.obstacles = [];
        this.particleSystem.clear(); // Clear particles
        this.slopeGroup.innerHTML = '';
        this.trails = [];
        this.trailGroup.innerHTML = '';
        
        this.distance = 0;
        this.lastHundredMeters = 0;
        this.frameCount = 0;
        this.scrollSpeed = CONFIG.INITIAL_SCROLL_SPEED;
        this.pathCenter = CONFIG.GAME_WIDTH / 2;
        this.pathWidth = 450;
        this.targetPathWidth = 450;
        this.splitDistance = 0;
        this.isSplitting = false;
        this.startSeparating = false;
        this.lastPoopJJSpawn = 0;
        this.hasSpawnedFirstPooper = false;
        this.isExploding = false;
        
        this.carouselActive = false;
        this.carouselPhase = 0;
        this.hasSpawnedCarousel1 = false;
        this.hasSpawnedCarousel2 = false;
        document.getElementById('game-container').classList.remove('dark-mode');
        this.countdownDisplay.classList.add('hidden');
        if (this.reverseIcon) {
            this.reverseIcon.classList.add('hidden');
            this.reverseIcon.classList.remove('blink');
        }

        if (this.poopingJJ && this.poopingJJ.element) {
            this.poopingJJ.element.remove();
        }
        this.poopingJJ = null;
        
        if (this.player) this.player.element.remove();
        this.createPlayer();
        this.player.element.style.opacity = "1"; // Ensure player is visible
        
        this.state = 'PLAYING';
        this.audio.start();
        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }
    
    setupInputs() {
        window.addEventListener('keydown', (e) => {
            if (this.keys.hasOwnProperty(e.code)) {
                this.keys[e.code] = true;
            }
            if ((e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') && this.state === 'PLAYING') {
                this.player.jump();
            }
        });
        
        window.addEventListener('keyup', (e) => {
            if (this.keys.hasOwnProperty(e.code)) {
                this.keys[e.code] = false;
            }
        });
    }
    
    createPlayer() {
        // Position player relative to height. 
        // Fixed Y position since we are locking aspect ratio now
        const playerY = 150;
        this.player = new Player(CONFIG.GAME_WIDTH / 2, playerY);
        this.playerGroup.appendChild(this.player.element);
    }

    spawnJJBarrier() {
        if (this.distance < 100) return;
        const isLeft = Math.random() > 0.5;
        // Ensure JJ spawns VERY close to the tree wall
        // Previous offset was +15.
        // We want him barely peeking out or just at the edge.
        // Let's use 0 offset relative to path edge, or even slightly negative?
        // Path edge is pathCenter +/- pathWidth/2.
        // Tree is at pathCenter +/- pathWidth/2 - 20 (approx).
        // Let's put JJ exactly at pathWidth/2 - 30.
        
        const offset = (this.pathWidth / 2) - 30; 
        let x = isLeft ? (this.pathCenter - offset) : (this.pathCenter + offset);
        
        // Constrain x to be well within visible screen (1024 width)
        x = Math.max(100, Math.min(CONFIG.GAME_WIDTH - 100, x));
        
        // Spawn slightly below screen to scroll up
        const obstacle = new Obstacle(this.pathCenter, CONFIG.GAME_HEIGHT + 150, 'jj-barrier');
        obstacle.kidOffsetX = x - this.pathCenter;
        obstacle.updateKidPosition();
        this.obstacles.push(obstacle);
        // Append to playerGroup so it renders ON TOP of trees/rocks (prevent hiding)
        this.playerGroup.appendChild(obstacle.element);
    }
    
    spawnObstacle() {
        this.updatePath();
        const currentHundred = Math.floor(this.distance / 100);
        if (currentHundred > this.lastHundredMeters && currentHundred > 0) {
            this.lastHundredMeters = currentHundred;
            this.spawnJJBarrier();
            return;
        }
        if (this.frameCount % 10 === 0) {
            this.spawnWallTrees();
        }
        let spawnRate = CONFIG.OBSTACLE_SPAWN_RATE;
        if (this.distance > 500) spawnRate = 45;
        if (this.distance > 1000) spawnRate = 30;
        if (this.frameCount % spawnRate === 0) {
            this.spawnInternalObstacle();
        }
    }

    updatePath() {
        if (Math.abs(this.pathCenter - this.pathTarget) < 5) {
            const margin = 150;
            this.pathTarget = margin + Math.random() * (CONFIG.GAME_WIDTH - margin * 2);
            if (!this.isSplitting) {
                this.targetPathWidth = 300 + Math.random() * 300;
            }
        }
        const speed = 0.5 + (this.scrollSpeed * 0.1);
        if (this.pathCenter < this.pathTarget) this.pathCenter += speed;
        else this.pathCenter -= speed;

        if (this.pathWidth < this.targetPathWidth) this.pathWidth += 0.5;
        if (this.pathWidth > this.targetPathWidth) this.pathWidth -= 0.5;

        this.splitTimer++;
        if (!this.isSplitting && this.splitDistance === 0) {
            if (this.splitTimer > 500 + Math.random() * 500) {
                this.isSplitting = true;
                this.splitTimer = 0;
            }
        }
        if (this.isSplitting && this.splitDistance === 0) {
            this.targetPathWidth = 750;
            if (this.pathWidth >= 700) {
                this.startSeparating = true;
            }
        }
        if (this.isSplitting && this.startSeparating) {
            if (this.splitDistance < this.maxSplitDistance) {
                this.splitDistance += 1.5;
            } else {
                if (this.splitTimer > 400) {
                    this.isSplitting = false;
                    this.startSeparating = false;
                    this.splitTimer = 0;
                }
            }
        }
        if (!this.isSplitting && this.splitDistance > 0) {
            this.splitDistance -= 1.5;
            if (this.splitDistance <= 0) {
                this.splitDistance = 0;
                this.targetPathWidth = 450;
            }
        }
    }

    spawnWallTrees() {
        // No trees during reverse zone (approx 750m - 1250m)
        // Give a little buffer before and after to clear the path for the Carousel
        if (this.distance > 700 && this.distance < 1300) return;

        const y = CONFIG.GAME_HEIGHT + 50;
        const leftPathCenter = this.pathCenter - (this.splitDistance / 2);
        const rightPathCenter = this.pathCenter + (this.splitDistance / 2);
        const currentPathWidth = this.isSplitting || this.splitDistance > 0 ? this.pathWidth / 2 : this.pathWidth;
        const leftEdge = leftPathCenter - currentPathWidth / 2;
        this.spawnTreeAt(leftEdge - 20, y);
        const rightEdge = rightPathCenter + currentPathWidth / 2;
        this.spawnTreeAt(rightEdge + 20, y);
        if (this.splitDistance > 80) {
            const midLeft = leftPathCenter + currentPathWidth / 2;
            const midRight = rightPathCenter - currentPathWidth / 2;
            if (midRight > midLeft) {
                this.spawnTreeAt((midLeft + midRight) / 2, y);
            }
        }
    }

    spawnTreeAt(x, y) {
        const jitter = (Math.random() - 0.5) * 20;
        const obstacle = new Obstacle(x + jitter, y, 'tree');
        this.obstacles.push(obstacle);
        this.slopeGroup.appendChild(obstacle.element);
    }

    spawnInternalObstacle() {
        const rand = Math.random();
        let type = 'rock';
        if (this.distance > 400 && rand > 0.7) type = 'flag';
        // Removed static 'kid' spawn as requested
        if (this.distance > 800 && rand > 0.92) type = 'ditch';
        let targetCenter = this.pathCenter;
        let targetWidth = this.pathWidth;
        if (this.splitDistance > 50) {
            if (Math.random() > 0.5) {
                targetCenter = this.pathCenter - this.splitDistance / 2;
            } else {
                targetCenter = this.pathCenter + this.splitDistance / 2;
            }
            targetWidth = this.pathWidth / 2;
        }
        const safeWidth = targetWidth - 60; 
        const xOffset = (Math.random() - 0.5) * safeWidth;
        const x = targetCenter + xOffset;
        const obstacle = new Obstacle(x, CONFIG.GAME_HEIGHT + 50, type);
        this.obstacles.push(obstacle);
        this.slopeGroup.appendChild(obstacle.element);
    }
    
    gameLoop(timestamp) {
        if (this.state !== 'PLAYING' && this.state !== 'EXPLODING') return;
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;
        this.update(deltaTime);
        this.draw();
        requestAnimationFrame((t) => this.gameLoop(t));
    }
    
    update(deltaTime) {
        this.frameCount++;
        
        // Update particles regardless of state
        const hasParticles = this.particleSystem.update();
        
        if (this.state === 'EXPLODING') {
            if (!hasParticles) {
                this.gameOver();
            }
            return; // Stop game logic during explosion
        }
        
        this.distance += this.scrollSpeed * CONFIG.METER_SCALE;
        
        // Speed control: Slow down during reverse zone
        let targetMaxSpeed = this.carouselActive ? 4 : CONFIG.MAX_SPEED; // Reduced to 2/3 (was 6)
        
        if (this.scrollSpeed < targetMaxSpeed) {
            this.scrollSpeed += 0.001;
        } else if (this.scrollSpeed > targetMaxSpeed) {
            this.scrollSpeed -= 0.05; // Decelerate quickly
        }
        
        // Camera Follow Logic
        const targetCamX = this.player.x - CONFIG.GAME_WIDTH / 2;
        this.cameraX += (targetCamX - this.cameraX) * 0.1; // Smooth follow
        
        // Apply camera transform to the world group
        let shakeX = 0;
        let shakeY = 0;
        // Re-implement shake inside the camera transform
        if(this.svg.style.transform && this.svg.style.transform.includes('translate')) {
             // Extract shake from previous implementation or just calculate new shake here
             // We'll calculate fresh shake here instead of using the svg style which was a bit hacky
             shakeX = (Math.random() - 0.5) * (this.scrollSpeed * 0.2);
             shakeY = (Math.random() - 0.5) * (this.scrollSpeed * 0.2);
        }
        
        this.worldCamera.setAttribute("transform", `translate(${-this.cameraX + shakeX}, ${shakeY})`);
        // Move background with parallax (slower)
        this.bgGroup.setAttribute("transform", `translate(${-this.cameraX * 0.1}, 0)`);
        
        // Spawn Logic for Pooping JJ
        // First one at 250m is ALWAYS Squatting
        if (!this.poopingJJ) {
            if (!this.hasSpawnedFirstPooper && this.distance > 250) {
                this.spawnPoopingJJ('squat');
                this.hasSpawnedFirstPooper = true;
                this.lastPoopJJSpawn = this.distance;
            } else if (this.hasSpawnedFirstPooper && this.distance - this.lastPoopJJSpawn > 400) {
                this.spawnPoopingJJ(); // Random
                this.lastPoopJJSpawn = this.distance;
            }
        }

        if (this.poopingJJ) {
            this.updatePoopingJJ();
        }
        
        if (!this.hasSpawnedCarousel1 && this.distance > 750) {
            this.spawnCarousel(1);
            this.hasSpawnedCarousel1 = true;
        } else if (!this.hasSpawnedCarousel2 && this.distance > 1250) {
            this.spawnCarousel(2);
            this.hasSpawnedCarousel2 = true;
        }

        if (this.distance >= CONFIG.WIN_DISTANCE) {
            this.victory();
            return;
        }
        
        let moveDir = 0;
        if (this.keys.ArrowLeft || this.keys.KeyA) moveDir -= 1;
        if (this.keys.ArrowRight || this.keys.KeyD) moveDir += 1;
        
        if (this.carouselActive) moveDir *= -1; // Reverse controls

        // Update warning icon (replaces old text countdown)
        // ONLY show icon when reverse zone is ACTUALLY ACTIVE
        if (this.carouselActive) {
            this.reverseIcon.classList.remove('hidden');
            this.reverseIcon.classList.add('blink');
        } else {
             this.reverseIcon.classList.add('hidden');
             this.reverseIcon.classList.remove('blink');
        }
        
        // Hide old countdown text
        this.countdownDisplay.classList.add('hidden');
        
        if (moveDir !== 0) {
            this.player.move(moveDir * CONFIG.PLAYER_SPEED);
        }

        this.player.update(deltaTime);
        this.audio.updateSkiSound(this.scrollSpeed, this.player.isJumping);
        this.bgManager.update(this.scrollSpeed);
        if (!this.player.isJumping) {
            this.trails.push({
                x: this.player.x,
                y: this.player.y + 15,
                age: 0
            });
        }
        this.updateTrails();
        this.spawnObstacle();
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obs = this.obstacles[i];
            obs.y -= this.scrollSpeed;
            obs.updatePosition();
            if (!this.player.isJumping) {
                if (this.checkCollision(this.player, obs)) {
                    if (obs.type === 'carousel') {
                        this.triggerCarouselEffect(obs);
                    } else {
                        this.triggerExplosion(obs);
                    }
                }
            }
            if (obs.y < -100) {
                obs.element.remove();
                this.obstacles.splice(i, 1);
            } else {
                obs.updateAnimation();
            }
        }
    }

    triggerCarouselEffect(obs) {
        if (obs.triggered) return;
        obs.triggered = true;
        
        this.audio.playSpiegelei();
        
        if (obs.phase === 1) {
            this.carouselActive = true;
            document.getElementById('game-container').classList.add('dark-mode');
            // Icon handling is done in update loop
        } else {
            this.carouselActive = false;
            document.getElementById('game-container').classList.remove('dark-mode');
            // Icon handling is done in update loop
        }
    }

    triggerExplosion(obstacle) {
        this.state = 'EXPLODING';
        this.audio.stop();
        
        // Hide player
        this.player.element.style.opacity = "0";
        
        // Determine color based on obstacle
        let color = "#5d4037"; // Default brown (poop/tree trunk)
        if (obstacle.type === 'poop') color = "#795548"; // Poop brown
        else if (obstacle.type === 'tree') color = "#2E7D32"; // Tree green
        else if (obstacle.type === 'rock') color = "#9e9e9e"; // Rock grey
        else if (obstacle.type === 'kid' || obstacle.type === 'jj-barrier') color = "#fdd835"; // JJ yellow
        
        // Explosion at player position
        this.particleSystem.spawnExplosion(this.player.x, this.player.y, color);
        
        // Also add some red/white for player parts
        this.particleSystem.spawnExplosion(this.player.x, this.player.y, "#ff3d00");
    }

    spawnCarousel(phase) {
        const x = this.pathCenter;
        const y = CONFIG.GAME_HEIGHT + 200;
        const obstacle = new Obstacle(x, y, 'carousel');
        obstacle.phase = phase; 
        this.obstacles.push(obstacle);
        this.slopeGroup.appendChild(obstacle.element);
    }

    spawnPoopingJJ(forcedType = null) {
        if (this.poopingJJ) return;
        this.audio.playGagi();
        
        // Randomly choose type: 'sled' or 'squat' unless forced
        const type = forcedType ? forcedType : (Math.random() > 0.5 ? 'sled' : 'squat');
        
        const startFromLeft = Math.random() > 0.5;
        const direction = startFromLeft ? 1 : -1;
        const leftBound = this.pathCenter - this.pathWidth / 2 + 50;
        const rightBound = this.pathCenter + this.pathWidth / 2 - 50;
        let x = startFromLeft ? leftBound : rightBound;
        let y = -100;
        
        // Use different SVG for sled type
        const svgId = type === 'sled' ? '#sled-kid' : '#squat-kid';
        
        const element = document.createElementNS("http://www.w3.org/2000/svg", "use");
        element.setAttributeNS("http://www.w3.org/1999/xlink", "href", svgId);
        element.setAttribute("transform", `translate(${x}, ${y}) scale(1)`); 
        this.slopeGroup.appendChild(element);
        
        this.poopingJJ = {
            type: type,
            element: element,
            x: x,
            y: y,
            targetY: 200, 
            direction: direction,
            poopTimer: 0,
            state: 'entering',
            angle: 0
        };
    }
    
    updatePoopingJJ() {
        if (!this.poopingJJ) return;
        let jj = this.poopingJJ;
        
        if (jj.type === 'sled') {
            this.updateSleddingJJ(jj);
        } else {
            this.updateSquattingJJ(jj);
        }
    }

    updateSleddingJJ(jj) {
        // Type 1: Sledding JJ (Original behavior + sled visual)
        // Moves diagonally down/across
        if (jj.state === 'entering') {
            jj.y += 4; // Fast entry
            jj.x += jj.direction * 1;
            if (jj.y >= jj.targetY) {
                jj.state = 'skiing';
            }
        } else if (jj.state === 'skiing') {
            const speedX = 2.5; 
            const speedY = 0.5; // Moves slowly down relative to camera
            
            jj.x += speedX * jj.direction;
            jj.y += speedY; // Slowly moves down screen
            
            const leftBound = this.pathCenter - this.pathWidth / 2 + 50;
            const rightBound = this.pathCenter + this.pathWidth / 2 - 50;
            
            // Zigzag
            if (jj.x > rightBound) jj.direction = -1;
            if (jj.x < leftBound) jj.direction = 1;
            
            // Occasional poop
            if (!jj.poopTimer) jj.poopTimer = 0;
            jj.poopTimer++;
            if (jj.poopTimer > 60) { 
                this.spawnPoop(jj.x, jj.y + 20); 
                jj.poopTimer = 0;
            }
            
            // Tilt based on direction
            jj.angle = jj.direction * -10;
            
            jj.element.setAttribute("transform", `translate(${jj.x}, ${jj.y}) scale(1) rotate(${jj.angle})`);
            
            if (!jj.lifeTime) jj.lifeTime = 0;
            jj.lifeTime++;
            if (jj.lifeTime > 600) { 
                jj.y += 5; // Zoom away down
                jj.element.setAttribute("transform", `translate(${jj.x}, ${jj.y}) scale(1) rotate(${jj.angle})`);
                if (jj.y > CONFIG.GAME_HEIGHT + 100) {
                    jj.element.remove();
                    this.poopingJJ = null;
                    return; 
                }
            }
        }
        if (jj && jj.state === 'entering') {
             jj.element.setAttribute("transform", `translate(${jj.x}, ${jj.y}) scale(1)`);
        }
    }

    updateSquattingJJ(jj) {
        // Type 2: Squatting JJ (Wall builder on a rope)
        // Moves strictly horizontal relative to the GROUND (so he moves UP with scroll)
        
        // If he's just entering, he spawns below screen and scrolls up naturally with the world
        // But our current logic spawns him and manages his 'y' manually.
        // Actually, 'jj.y' is his world position relative to the camera group if we appended him to slopeGroup?
        // Wait, slopeGroup is inside worldCamera. So if we set y once, he will scroll with the world.
        // The previous logic was modifying jj.y to simulate movement.
        // For "tied to trees", he should have a FIXED Y in the world, and just change X.
        
        if (jj.state === 'entering') {
            // Initialize rope if not present
            if (!jj.ropeElement) {
                const rope = document.createElementNS("http://www.w3.org/2000/svg", "line");
                rope.setAttribute("stroke", "#5d4037");
                rope.setAttribute("stroke-width", "3");
                // Rope spans the whole path width plus some margin to reach "trees"
                const leftTree = this.pathCenter - this.pathWidth / 2 - 20;
                const rightTree = this.pathCenter + this.pathWidth / 2 + 20;
                rope.setAttribute("x1", leftTree);
                rope.setAttribute("y1", 0); // Relative to JJ group
                rope.setAttribute("x2", rightTree);
                rope.setAttribute("y2", 0);
                // Insert rope before JJ so it's behind him. 
                // But JJ is a <use> element. We need a group for the whole entity if we want rope + JJ.
                // Currently jj.element is the <use>.
                // Let's just draw the rope as a separate element in slopeGroup? 
                // Or wrap JJ in a group? Wrapping is cleaner but requires changing spawn logic.
                // Easier: Just append rope to slopeGroup at jj.y - 40 (hand height).
                jj.ropeElement = rope;
                jj.ropeElement.setAttribute("transform", `translate(0, ${jj.y - 45})`); // Approx hand height
                this.slopeGroup.insertBefore(rope, jj.element);
            }
            
            // He is already placed at y = -100 (which is top of screen... wait).
            // spawnPoopingJJ sets y = -100.
            // In the new camera system, y = 0 is top of world? 
            // The camera follows player. Player is at y=100.
            // Obstacles are spawned at CONFIG.GAME_HEIGHT + 50 (bottom).
            // Pooping JJ was spawned at y = -100 (top) to "overtake"?
            // User says: "Tied between trees... won't slide down like player".
            // This means he is a STATIONARY OBSTACLE (like a rock) that just moves left/right.
            // So he should spawn at the BOTTOM (like trees) and scroll UP.
            
            // If this is the first update, let's fix his position to be ahead of player (bottom of screen)
            if (jj.y === -100) {
                 jj.y = CONFIG.GAME_HEIGHT + 100; // Spawn ahead
                 jj.targetY = jj.y; // He stays at this Y level
                 jj.element.setAttribute("transform", `translate(${jj.x}, ${jj.y}) scale(1)`);
                 if(jj.ropeElement) jj.ropeElement.setAttribute("transform", `translate(0, ${jj.y - 45})`);
            }
            
            jj.state = 'crawling';
        } else if (jj.state === 'crawling') {
            const speed = 3; 
            jj.x += speed * jj.direction;
            
            // Dense poop spawn
            if (!jj.poopTimer) jj.poopTimer = 0;
            jj.poopTimer++;
            if (jj.poopTimer > 20) { // Increased from 4 to 20 for bigger spacing
                this.spawnPoop(jj.x, jj.y + 20); 
                jj.poopTimer = 0;
            }
            
            const bob = Math.sin(this.frameCount * 0.2) * 5; 
            jj.element.setAttribute("transform", `translate(${jj.x}, ${jj.y + bob}) scale(1)`);
            
            // Check bounds
            const leftBound = this.pathCenter - this.pathWidth / 2 + 20;
            const rightBound = this.pathCenter + this.pathWidth / 2 - 20;
            
            if (jj.direction === 1 && jj.x > rightBound) {
                jj.direction = -1;
            } else if (jj.direction === -1 && jj.x < leftBound) {
                jj.direction = 1;
            }
            
            // Cleanup when he scrolls off top of screen
            // Player is at y=100. If jj.y < player.y - 200, he's gone.
            // But wait, "scrolls up" means his screen Y decreases as camera Y increases?
            // No, obstacles have fixed World Y. Camera moves +Y?
            // Let's check update(): obs.y -= scrollSpeed. 
            // Ah, the current engine moves OBSTACLES up, not camera down. 
            // "this.obstacles.forEach... obs.y -= speed".
            // So JJ must also follow this rule if he is "stationary on the ground".
            
            jj.y -= this.scrollSpeed; // Move with the world
            if(jj.ropeElement) jj.ropeElement.setAttribute("transform", `translate(0, ${jj.y - 45})`);
            
            if (jj.y < -150) {
                jj.element.remove();
                if(jj.ropeElement) jj.ropeElement.remove();
                this.poopingJJ = null;
                return;
            }
        }
    }
    
    spawnPoop(x, y) {
        const obstacle = new Obstacle(x, y, 'poop');
        this.obstacles.push(obstacle);
        this.slopeGroup.appendChild(obstacle.element);
    }

    applyScreenShake() {
        // Deprecated: Shake is now handled in update loop for camera group
        // But we keep the function to trigger the "shake state" if we add one later
    }
    
    updateTrails() {
        for (let i = this.trails.length - 1; i >= 0; i--) {
            this.trails[i].y -= this.scrollSpeed;
            this.trails[i].age++;
            if (this.trails[i].y < -100 || this.trails[i].age > 200) {
                this.trails.splice(i, 1);
            }
        }
        if (this.trails.length < 2) {
            this.trailGroup.innerHTML = '';
            return;
        }
        let leftD = `M ${this.trails[0].x - 10} ${this.trails[0].y}`;
        let rightD = `M ${this.trails[0].x + 10} ${this.trails[0].y}`;
        for (let i = 1; i < this.trails.length; i++) {
            const p = this.trails[i];
            leftD += ` L ${p.x - 10} ${p.y}`;
            rightD += ` L ${p.x + 10} ${p.y}`;
        }
        let leftPath = document.getElementById('left-trail');
        let rightPath = document.getElementById('right-trail');
        if (!leftPath) {
            this.trailGroup.innerHTML = '';
            leftPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            leftPath.setAttribute("id", "left-trail");
            leftPath.setAttribute("stroke", "rgba(200, 200, 255, 0.6)");
            leftPath.setAttribute("stroke-width", "4");
            leftPath.setAttribute("fill", "none");
            leftPath.setAttribute("stroke-linecap", "round");
            leftPath.setAttribute("stroke-linejoin", "round");
            this.trailGroup.appendChild(leftPath);
            rightPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            rightPath.setAttribute("id", "right-trail");
            rightPath.setAttribute("stroke", "rgba(200, 200, 255, 0.6)");
            rightPath.setAttribute("stroke-width", "4");
            rightPath.setAttribute("fill", "none");
            rightPath.setAttribute("stroke-linecap", "round");
            rightPath.setAttribute("stroke-linejoin", "round");
            this.trailGroup.appendChild(rightPath);
        }
        leftPath.setAttribute("d", leftD);
        rightPath.setAttribute("d", rightD);
    }
    
    checkCollision(player, obstacle) {
        const px = player.x - 15;
        const py = player.y - 10;
        const pw = 30;
        const ph = 20;
        const ox = obstacle.x - obstacle.width/2;
        const oy = obstacle.y - obstacle.height;
        const ow = obstacle.width;
        const oh = obstacle.height;
        return (px < ox + ow && px + pw > ox && py < oy + oh && py + ph > oy);
    }
    
    draw() {
        this.scoreElement.textContent = Math.floor(this.distance);
    }
    
    gameOver() {
        this.state = 'GAMEOVER';
        this.audio.stop();
        this.gameOverScreen.classList.remove('hidden');
        this.finalScoreElement.textContent = Math.floor(this.distance) + 'm';
    }

    victory() {
        this.state = 'VICTORY';
        this.audio.stop();
        this.victoryScreen.classList.remove('hidden');
    }
}

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.isJumping = false;
        this.jumpStartTime = 0;
        // Use consistent scale for all devices to maintain ratio
        this.baseScale = 0.8; 
        this.scale = this.baseScale;
        this.angle = 0;
        this.bobOffset = 0;
        this.frameCount = 0;
        this.element = this.createSVG();
        this.updatePosition();
    }
    
    createSVG() {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const shadow = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        shadow.setAttribute("x", -18); shadow.setAttribute("y", 12);
        shadow.setAttribute("width", 36); shadow.setAttribute("height", 8);
        shadow.setAttribute("fill", "rgba(0,0,0,0.2)");
        g.appendChild(shadow);
        const leftSki = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        leftSki.setAttribute("x", -18); leftSki.setAttribute("y", 0);
        leftSki.setAttribute("width", 10); leftSki.setAttribute("height", 45);
        leftSki.setAttribute("fill", "#fff");
        g.appendChild(leftSki);
        const leftSkiTip = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        leftSkiTip.setAttribute("x", -18); leftSkiTip.setAttribute("y", 35);
        leftSkiTip.setAttribute("width", 10); leftSkiTip.setAttribute("height", 10);
        leftSkiTip.setAttribute("fill", "#4caf50");
        g.appendChild(leftSkiTip);
        const rightSki = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rightSki.setAttribute("x", 8); rightSki.setAttribute("y", 0);
        rightSki.setAttribute("width", 10); rightSki.setAttribute("height", 45);
        rightSki.setAttribute("fill", "#fff");
        g.appendChild(rightSki);
        const rightSkiTip = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rightSkiTip.setAttribute("x", 8); rightSkiTip.setAttribute("y", 35);
        rightSkiTip.setAttribute("width", 10); rightSkiTip.setAttribute("height", 10);
        rightSkiTip.setAttribute("fill", "#4caf50");
        g.appendChild(rightSkiTip);
        this.bodyGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.appendChild(this.bodyGroup);
        const leftLeg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        leftLeg.setAttribute("x", -14); leftLeg.setAttribute("y", -15);
        leftLeg.setAttribute("width", 10); leftLeg.setAttribute("height", 25);
        leftLeg.setAttribute("fill", "#1a237e");
        this.bodyGroup.appendChild(leftLeg);
        const rightLeg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rightLeg.setAttribute("x", 4); rightLeg.setAttribute("y", -15);
        rightLeg.setAttribute("width", 10); rightLeg.setAttribute("height", 25);
        rightLeg.setAttribute("fill", "#1a237e");
        this.bodyGroup.appendChild(rightLeg);
        const torsoBottom = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        torsoBottom.setAttribute("x", -16); torsoBottom.setAttribute("y", -30);
        torsoBottom.setAttribute("width", 32); torsoBottom.setAttribute("height", 15);
        torsoBottom.setAttribute("fill", "#ff3d00");
        this.bodyGroup.appendChild(torsoBottom);
        const torsoTop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        torsoTop.setAttribute("x", -16); torsoTop.setAttribute("y", -45);
        torsoTop.setAttribute("width", 32); torsoTop.setAttribute("height", 15);
        torsoTop.setAttribute("fill", "#1a237e");
        this.bodyGroup.appendChild(torsoTop);
        const leftArm = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        leftArm.setAttribute("x", -22); leftArm.setAttribute("y", -44);
        leftArm.setAttribute("width", 8); leftArm.setAttribute("height", 24);
        leftArm.setAttribute("fill", "#1a237e");
        this.bodyGroup.appendChild(leftArm);
        const rightArm = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rightArm.setAttribute("x", 14); rightArm.setAttribute("y", -44);
        rightArm.setAttribute("width", 8); rightArm.setAttribute("height", 24);
        rightArm.setAttribute("fill", "#1a237e");
        this.bodyGroup.appendChild(rightArm);
        const head = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        head.setAttribute("x", -12); head.setAttribute("y", -68);
        head.setAttribute("width", 24); head.setAttribute("height", 24);
        head.setAttribute("rx", 4); head.setAttribute("fill", "#263238");
        this.bodyGroup.appendChild(head);
        const face = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        face.setAttribute("x", -10); face.setAttribute("y", -60);
        face.setAttribute("width", 20); face.setAttribute("height", 14);
        face.setAttribute("fill", "#f0c0a0");
        this.bodyGroup.appendChild(face);
        const gogglesFrame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        gogglesFrame.setAttribute("x", -13); gogglesFrame.setAttribute("y", -64);
        gogglesFrame.setAttribute("width", 26); gogglesFrame.setAttribute("height", 12);
        gogglesFrame.setAttribute("rx", 2); gogglesFrame.setAttribute("fill", "#212121");
        this.bodyGroup.appendChild(gogglesFrame);
        const gogglesLens = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        gogglesLens.setAttribute("x", -11); gogglesLens.setAttribute("y", -62);
        gogglesLens.setAttribute("width", 22); gogglesLens.setAttribute("height", 8);
        gogglesLens.setAttribute("rx", 1); gogglesLens.setAttribute("fill", "#ff5722");
        this.bodyGroup.appendChild(gogglesLens);
        
        // Name Tag "Andi"
        const nameText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        nameText.setAttribute("x", 0);
        nameText.setAttribute("y", -90);
        nameText.setAttribute("text-anchor", "middle");
        nameText.setAttribute("fill", "#1a237e");
        nameText.setAttribute("font-family", "Arial");
        nameText.setAttribute("font-weight", "bold");
        nameText.setAttribute("font-size", "24");
        nameText.textContent = "Andi";
        this.bodyGroup.appendChild(nameText);
        
        return g;
    }
    
    move(dx) {
        this.x += dx;
        // Removed bounds to allow infinite horizontal scrolling with camera follow
        // if (this.x < 30) this.x = 30;
        // if (this.x > CONFIG.GAME_WIDTH - 30) this.x = CONFIG.GAME_WIDTH - 30;
        const targetAngle = dx > 0 ? 15 : -15;
        this.angle += (targetAngle - this.angle) * 0.1;
    }
    
    jump() {
        if (!this.isJumping) {
            this.isJumping = true;
            this.jumpStartTime = performance.now();
        }
    }
    
    update(deltaTime) {
        this.frameCount++;
        if (Math.abs(this.angle) > 0.1) this.angle *= 0.9;
        if (!this.isJumping) {
            const bobSpeed = Math.abs(this.angle) > 5 ? 0.3 : 0.15;
            this.bobOffset = Math.sin(this.frameCount * bobSpeed) * 2;
            this.bodyGroup.setAttribute("transform", `translate(0, ${this.bobOffset})`);
        } else {
            this.bodyGroup.setAttribute("transform", `translate(0, 0)`);
        }
        if (this.isJumping) {
            const now = performance.now();
            const progress = (now - this.jumpStartTime) / CONFIG.JUMP_DURATION;
            if (progress >= 1) {
                this.isJumping = false;
                this.scale = this.baseScale;
            } else {
                const jumpHeight = Math.sin(progress * Math.PI);
                this.scale = this.baseScale + (jumpHeight * 0.4);
            }
        }
        this.updatePosition();
    }
    
    updatePosition() {
        this.element.setAttribute("transform", `translate(${this.x}, ${this.y}) scale(${this.scale}) rotate(${this.angle})`);
    }
}

class Obstacle {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        if (type === 'jj-barrier') {
            this.width = CONFIG.GAME_WIDTH;
            this.height = 60;
        } else if (type === 'carousel') {
            this.width = CONFIG.GAME_WIDTH;
            this.height = 300;
        } else if (type === 'tree') {
            this.width = 60;
            this.height = 75;
        } else {
            this.width = type === 'flag' ? 20 : (type === 'kid' ? 45 : (type === 'ditch' ? 50 : 40));
            this.height = type === 'flag' ? 30 : (type === 'kid' ? 55 : (type === 'ditch' ? 20 : 30));
        }
        if (type === 'jj-barrier') {
            this.element = document.createElementNS("http://www.w3.org/2000/svg", "g");
            this.kidOffsetX = 0;
            this.crackElement = document.createElementNS("http://www.w3.org/2000/svg", "use");
            this.crackElement.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#ice-crack");
            this.crackElement.setAttribute("transform", "translate(0, -30) scale(0, 1)");
            this.element.appendChild(this.crackElement);
            const kidGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
            kidGroup.setAttribute("transform", "translate(0, -30) scale(2.4)"); // Reduced to 2/3 size
            const kidUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
            kidUse.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#kid");
            kidGroup.appendChild(kidUse);
            this.kidElement = kidGroup;
            this.element.appendChild(this.kidElement);
            this.barrierState = 'wait';
            this.animTimer = 0;
        } else if (type === 'carousel') {
            this.element = document.createElementNS("http://www.w3.org/2000/svg", "use");
            this.element.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#carousel");
            this.rotation = 0;
        } else {
            this.element = document.createElementNS("http://www.w3.org/2000/svg", "use");
            this.element.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#${type}`);
            if (type === 'tree') this.element.setAttribute("transform", "scale(1.8)"); // Slightly smaller trees
        }
        if (type === 'ditch') {
            this.scaleX = 0.1;
            this.animationSpeed = 0.05;
        }
        this.updatePosition();
    }

    updateKidPosition() {
        if (this.type === 'jj-barrier' && this.kidElement) {
            this.kidElement.setAttribute("transform", `translate(${this.kidOffsetX}, -30) scale(2.4)`);
        }
    }
    
    updatePosition() {
        if (this.type === 'ditch') {
            this.element.setAttribute("transform", `translate(${this.x}, ${this.y}) scale(${this.scaleX}, 1)`);
            this.element.removeAttribute("x"); this.element.removeAttribute("y");
        } else if (this.type === 'jj-barrier') {
            this.element.setAttribute("transform", `translate(${this.x}, ${this.y})`);
        } else if (this.type === 'carousel') {
            this.element.setAttribute("transform", `translate(${this.x}, ${this.y}) scale(2) rotate(${this.rotation})`);
        } else if (this.type === 'tree') {
            this.element.setAttribute("transform", `translate(${this.x}, ${this.y}) scale(1.8)`);
            this.element.removeAttribute("x"); this.element.removeAttribute("y");
        } else if (this.type === 'kid') {
            this.element.setAttribute("transform", `translate(${this.x}, ${this.y}) scale(0.7)`);
            this.element.removeAttribute("x"); this.element.removeAttribute("y");
        } else {
            this.element.setAttribute("x", this.x); this.element.setAttribute("y", this.y);
        }
    }

    updateAnimation() {
        if (this.type === 'carousel') {
            this.rotation += 2;
        } else if (this.type === 'ditch' && this.scaleX < 1.5) {
            this.scaleX += this.animationSpeed; this.updatePosition();
        } else if (this.type === 'jj-barrier') {
            if (this.barrierState === 'wait' && this.y < CONFIG.GAME_HEIGHT - 100) {
                this.barrierState = 'jump'; this.animTimer = 0;
            } else if (this.barrierState === 'jump') {
                this.animTimer++;
                const duration = 40; 
                if (this.animTimer <= duration) {
                    const progress = this.animTimer / duration;
                    const jumpHeight = Math.sin(progress * Math.PI) * 120; // Slightly lower jump
                    this.kidElement.setAttribute("transform", `translate(${this.kidOffsetX}, ${-30 - jumpHeight}) scale(2.4)`);
                } else {
                    this.barrierState = 'crack'; this.animTimer = 0;
                    this.kidElement.setAttribute("transform", `translate(${this.kidOffsetX}, -30) scale(2.4)`);
                }
            } else if (this.barrierState === 'crack') {
                this.animTimer++;
                const duration = 10;
                if (this.animTimer <= duration) {
                    const scale = this.animTimer / duration;
                    this.crackElement.setAttribute("transform", `translate(0, -30) scale(${scale}, 1)`);
                } else {
                    this.crackElement.setAttribute("transform", `translate(0, -30) scale(1, 1)`);
                    this.barrierState = 'done';
                }
            }
        }
    }
}

class ParticleSystem {
    constructor(svgGroup) {
        this.group = svgGroup;
        this.particles = [];
    }

    spawnExplosion(x, y, color) {
        const particleCount = 60; // Increased from 20 to 60 for full screen effect
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            const size = 10 + Math.random() * 20; // Bigger particles
            particle.setAttribute("width", size);
            particle.setAttribute("height", size);
            particle.setAttribute("fill", color);
            
            // Random direction with higher speed for full screen spread
            const angle = Math.random() * Math.PI * 2;
            const speed = 5 + Math.random() * 25; // Much faster
            
            this.group.appendChild(particle);
            
            this.particles.push({
                element: particle,
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.5, // Longer life
                decay: 0.01 + Math.random() * 0.01 // Slower decay
            });
        }
    }

    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            
            p.element.setAttribute("transform", `translate(${p.x}, ${p.y}) rotate(${p.life * 360})`);
            p.element.setAttribute("opacity", p.life);
            
            if (p.life <= 0) {
                p.element.remove();
                this.particles.splice(i, 1);
            }
        }
        return this.particles.length > 0;
    }
    
    clear() {
        this.particles.forEach(p => p.element.remove());
        this.particles = [];
    }
}

new Game();
