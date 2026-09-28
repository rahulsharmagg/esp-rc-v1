<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { BLEController } from '../lib/ble.svelte';

  interface Props {
    ble: BLEController;
  }

  let { ble }: Props = $props();

  let canvasEl: HTMLCanvasElement | null = $state(null);
  let ctx: CanvasRenderingContext2D | null = null;
  const width = 150;
  const height = 150;

  let activeMovement = 'S';
  let effectiveCmd = 'S';
  let speed = 200;
  let gridOffsetY = 0;
  let gridOffsetX = 0;
  let gridRotation = 0;
  let vehicleRotation = 0;
  let targetVehicleAngle = 0;
  const gridSpacing = 15;

  let animFrameId: number | null = null;
  let lastFrameTime = performance.now();

  function updateMeshPhysics(dt: number) {
    const speedFactor = (speed / 200);
    const scrollSpeed = 60 * speedFactor;

    // 1. Grid translation & world mesh rotation
    effectiveCmd = activeMovement;

    // In Autonomous Mode with no manual override, animate AI autonomous cruising & reactive avoidance
    if (ble.driveMode === 'AUTOMATIC' && activeMovement === 'S') {
      if (ble.irLeft && ble.irRight) {
        effectiveCmd = 'B';
      } else if (ble.irLeft) {
        effectiveCmd = 'R';
      } else if (ble.irRight) {
        effectiveCmd = 'L';
      } else if (ble.distance > 0 && ble.distance <= 22) {
        effectiveCmd = ble.servoAngle > 90 ? 'L' : 'R';
      } else {
        effectiveCmd = 'F';
      }
    }

    switch (effectiveCmd) {
      case 'F':
        gridOffsetY = (gridOffsetY + scrollSpeed * dt) % gridSpacing;
        gridRotation += (0 - gridRotation) * 8 * dt;
        targetVehicleAngle = 0;
        break;
      case 'B':
        gridOffsetY = (gridOffsetY - scrollSpeed * dt);
        if (gridOffsetY < 0) gridOffsetY += gridSpacing;
        gridRotation += (0 - gridRotation) * 8 * dt;
        targetVehicleAngle = 0;
        break;
      case 'G': // FWD Left
        gridOffsetY = (gridOffsetY + scrollSpeed * 0.8 * dt) % gridSpacing;
        gridOffsetX = (gridOffsetX + scrollSpeed * 0.5 * dt) % gridSpacing;
        gridRotation += (-10 - gridRotation) * 8 * dt;
        targetVehicleAngle = -14;
        break;
      case 'I': // FWD Right
        gridOffsetY = (gridOffsetY + scrollSpeed * 0.8 * dt) % gridSpacing;
        gridOffsetX = (gridOffsetX - scrollSpeed * 0.5 * dt);
        if (gridOffsetX < 0) gridOffsetX += gridSpacing;
        gridRotation += (10 - gridRotation) * 8 * dt;
        targetVehicleAngle = 14;
        break;
      case 'H': // REV Left
        gridOffsetY = (gridOffsetY - scrollSpeed * 0.8 * dt);
        if (gridOffsetY < 0) gridOffsetY += gridSpacing;
        gridOffsetX = (gridOffsetX + scrollSpeed * 0.5 * dt) % gridSpacing;
        gridRotation += (8 - gridRotation) * 8 * dt;
        targetVehicleAngle = 12;
        break;
      case 'J': // REV Right
        gridOffsetY = (gridOffsetY - scrollSpeed * 0.8 * dt);
        if (gridOffsetY < 0) gridOffsetY += gridSpacing;
        gridOffsetX = (gridOffsetX - scrollSpeed * 0.5 * dt);
        if (gridOffsetX < 0) gridOffsetX += gridSpacing;
        gridRotation += (-8 - gridRotation) * 8 * dt;
        targetVehicleAngle = -12;
        break;
      case 'L': // Pivot Left
        gridOffsetX = (gridOffsetX + scrollSpeed * 0.9 * dt) % gridSpacing;
        gridRotation += (-18 - gridRotation) * 8 * dt;
        targetVehicleAngle = -24;
        break;
      case 'R': // Pivot Right
        gridOffsetX = (gridOffsetX - scrollSpeed * 0.9 * dt);
        if (gridOffsetX < 0) gridOffsetX += gridSpacing;
        gridRotation += (18 - gridRotation) * 8 * dt;
        targetVehicleAngle = 24;
        break;
      case 'S':
      default:
        gridRotation += (0 - gridRotation) * 6 * dt;
        targetVehicleAngle = 0;
        break;
    }

    // 2. Smooth Robot Vehicle Rotation (Spring dynamics)
    vehicleRotation += (targetVehicleAngle - vehicleRotation) * 12 * dt;
  }

  function render() {
    if (!ctx) return;
    const w = width;
    const h = height;
    const cx = w / 2;
    const cy = h / 2;

    // 1. Clear background (Deep Tactical Radar Black)
    ctx.fillStyle = '#050a07';
    ctx.fillRect(0, 0, w, h);

    // 2. Animated Mesh Grid (Radar Green Matrix)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate((gridRotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    const spacing = gridSpacing;
    const extra = spacing * 2;
    const offX = (gridOffsetX % spacing);
    const offY = (gridOffsetY % spacing);

    ctx.strokeStyle = 'rgba(34, 197, 94, 0.18)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = -extra + offX; x <= w + extra; x += spacing) {
      ctx.moveTo(x, -extra);
      ctx.lineTo(x, h + extra);
    }
    for (let y = -extra + offY; y <= h + extra; y += spacing) {
      ctx.moveTo(-extra, y);
      ctx.lineTo(w + extra, y);
    }
    ctx.stroke();

    // Speed Lines on Forward (Green HUD Trails)
    if (effectiveCmd === 'F' || effectiveCmd === 'G' || effectiveCmd === 'I') {
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.40)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = spacing; x < w; x += spacing * 2) {
        const sy = (offY * 2 + (x * 7) % h) % h;
        ctx.moveTo(x, sy);
        ctx.lineTo(x, (sy + 12) % h);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 3. Radar Range Rings & Crosshairs (Tactical HUD Green)
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.38)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.arc(cx, cy, 55, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(34, 197, 94, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // 4. Ultrasonic Sensor Cone & Distance Target (if enabled)
    if (ble.ultrasonicEnabled) {
      const angleRad = (-(ble.servoAngle - 90) - 90 + vehicleRotation) * (Math.PI / 180);
      const coneLength = 52;
      const endX = cx + Math.cos(angleRad) * coneLength;
      const endY = cy + Math.sin(angleRad) * coneLength;

      const coneSpan = (18 * Math.PI) / 180;
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, coneLength, angleRad - coneSpan, angleRad + coneSpan);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (ble.distance > 0 && ble.distance <= 120) {
        const distRatio = Math.max(0.15, Math.min(1.0, ble.distance / 120));
        const obsX = cx + Math.cos(angleRad) * (coneLength * distRatio);
        const obsY = cy + Math.sin(angleRad) * (coneLength * distRatio);

        ctx.fillStyle = ble.distance <= 22 ? '#ef4444' : (ble.distance <= 40 ? '#f59e0b' : '#22c55e');
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(obsX, obsY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // 5. Left & Right IR Proximity Sensor Badges (Relative to Vehicle Heading)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((vehicleRotation * Math.PI) / 180);

    const irY = -18;
    
    if (ble.irLeftEnabled) {
      const irLX = -26;
      ctx.fillStyle = ble.irLeft ? '#ef4444' : 'rgba(255, 255, 255, 0.2)';
      ctx.strokeStyle = ble.irLeft ? '#f87171' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      if (ble.irLeft) {
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;
      }
      ctx.fillRect(irLX - 3, irY - 6, 6, 12);
      ctx.strokeRect(irLX - 3, irY - 6, 6, 12);
      ctx.shadowBlur = 0;
    }

    if (ble.irRightEnabled) {
      const irRX = 26;
      ctx.fillStyle = ble.irRight ? '#ef4444' : 'rgba(255, 255, 255, 0.2)';
      ctx.strokeStyle = ble.irRight ? '#f87171' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      if (ble.irRight) {
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;
      }
      ctx.fillRect(irRX - 3, irY - 6, 6, 12);
      ctx.strokeRect(irRX - 3, irY - 6, 6, 12);
      ctx.shadowBlur = 0;
    }

    // 6. Central Vehicle Robot / Cyber Chevron Icon with dynamic turning rotation
    // Side tank treads
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.fillRect(-11, -8, 3, 16);
    ctx.strokeRect(-11, -8, 3, 16);
    ctx.fillRect(8, -8, 3, 16);
    ctx.strokeRect(8, -8, 3, 16);

    // Chassis body
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#dc2626';
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Cockpit windshield core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -3, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function loop(now: number) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    updateMeshPhysics(dt);
    render();
    animFrameId = requestAnimationFrame(loop);
  }

  onMount(() => {
    if (canvasEl) {
      ctx = canvasEl.getContext('2d');
      ble.onMovementChange = (cmd, spd) => {
        if (cmd.startsWith('D:')) {
          const parts = cmd.substring(2).split(',');
          const left = parseInt(parts[0], 10);
          const right = parseInt(parts[1], 10);
          if (left > 0 && right > 0) activeMovement = 'F';
          else if (left < 0 && right < 0) activeMovement = 'B';
          else if (left < 0 && right > 0) activeMovement = 'L';
          else if (left > 0 && right < 0) activeMovement = 'R';
          else activeMovement = 'S';

          // Differential angle proportional calculation
          const diff = (right - left) / 255;
          targetVehicleAngle = Math.max(-25, Math.min(25, diff * 20));
        } else {
          activeMovement = cmd || 'S';
        }
        speed = spd;
      };
      animFrameId = requestAnimationFrame(loop);
    }
  });

  onDestroy(() => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });
</script>

<div class="minimap-container">
  <div class="minimap-box">
    <canvas 
      bind:this={canvasEl} 
      width={width} 
      height={height} 
      class="minimap-canvas"
    ></canvas>
    <span class="minimap-label">RADAR 150×150</span>
  </div>
</div>
