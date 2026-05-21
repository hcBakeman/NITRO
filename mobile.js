import { input, triggerFire } from './game.js';

let isMobile = false;
let joystickLeft = null;
let joystickRight = null;
let stickLeft = null;
let stickRight = null;

// State of touches
let leftTouchId = null;
let rightTouchId = null;

// Joystick constraints
const MAX_RADIUS = 50;

export function initMobileControls() {
  // Simple check for touch capabilities
  isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  
  if (!isMobile) return;
  
  // 1. Show the fullscreen button in the menu
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.style.display = 'block';
    btnFullscreen.addEventListener('click', async () => {
      try {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape').catch(() => {});
        }
        btnFullscreen.style.display = 'none'; // hide once in fullscreen
      } catch (err) {
        console.warn("Fullscreen request failed:", err);
      }
    });
  }

  // 2. Setup touch controls
  const mobileControls = document.getElementById('mobile-controls');
  if (mobileControls) {
    mobileControls.style.display = 'block';
    
    joystickLeft = document.getElementById('joystick-left');
    stickLeft = joystickLeft.querySelector('.joystick-stick');
    
    joystickRight = document.getElementById('joystick-right');
    stickRight = joystickRight.querySelector('.joystick-stick');
    
    const btnFire = document.getElementById('btn-mobile-fire');
    
    // Bind touch events
    mobileControls.addEventListener('touchstart', handleTouchStart, {passive: false});
    mobileControls.addEventListener('touchmove', handleTouchMove, {passive: false});
    mobileControls.addEventListener('touchend', handleTouchEnd);
    mobileControls.addEventListener('touchcancel', handleTouchEnd);
    
    // Dedicated fire button handling
    btnFire.addEventListener('touchstart', (e) => {
      e.preventDefault();
      triggerFire(true);
    });
    btnFire.addEventListener('touchend', (e) => {
      e.preventDefault();
      triggerFire(false);
    });
  }
}

function handleTouchStart(e) {
  e.preventDefault(); // Prevent scrolling
  
  const leftRect = joystickLeft.getBoundingClientRect();
  const rightRect = joystickRight.getBoundingClientRect();
  
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    
    // Check if touch is near left joystick
    if (leftTouchId === null && isInside(touch, leftRect)) {
      leftTouchId = touch.identifier;
      updateJoystick(joystickLeft, stickLeft, touch, 'left');
    }
    // Check if touch is near right joystick
    else if (rightTouchId === null && isInside(touch, rightRect)) {
      rightTouchId = touch.identifier;
      updateJoystick(joystickRight, stickRight, touch, 'right');
    }
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.identifier === leftTouchId) {
      updateJoystick(joystickLeft, stickLeft, touch, 'left');
    } else if (touch.identifier === rightTouchId) {
      updateJoystick(joystickRight, stickRight, touch, 'right');
    }
  }
}

function handleTouchEnd(e) {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.identifier === leftTouchId) {
      leftTouchId = null;
      stickLeft.style.transform = `translate(-50%, -50%)`;
      input.forward = false;
      input.backward = false;
    } else if (touch.identifier === rightTouchId) {
      rightTouchId = null;
      stickRight.style.transform = `translate(-50%, -50%)`;
      input.left = false;
      input.right = false;
    }
  }
}

function isInside(touch, rect) {
  // Add a generous hit area around the base
  const padding = 50; 
  return (
    touch.clientX >= rect.left - padding &&
    touch.clientX <= rect.right + padding &&
    touch.clientY >= rect.top - padding &&
    touch.clientY <= rect.bottom + padding
  );
}

function updateJoystick(base, stick, touch, type) {
  const rect = base.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  let dx = touch.clientX - centerX;
  let dy = touch.clientY - centerY;
  
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > MAX_RADIUS) {
    dx = (dx / distance) * MAX_RADIUS;
    dy = (dy / distance) * MAX_RADIUS;
  }
  
  stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  
  // Map to inputs based on threshold
  const threshold = 15;
  if (type === 'left') {
    // Left joystick controls throttle (Y axis)
    input.forward = dy < -threshold;
    input.backward = dy > threshold;
  } else if (type === 'right') {
    // Right joystick controls steering (X axis)
    input.left = dx < -threshold;
    input.right = dx > threshold;
  }
}
