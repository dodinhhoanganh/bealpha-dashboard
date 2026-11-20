"use client";

import { useEffect, useRef } from "react";

import { useTheme } from "@/components/layout/ThemeProvider";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shape: "star" | "vinyl" | "note";
  opacity: number;
  rotation: number;
  rotationSpeed: number;
}

export default function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];

    const isDark = theme === "dark";
    const colors = isDark
      ? ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444"]
      : ["#2563eb", "#059669", "#7c3aed", "#d97706", "#dc2626"];

    const shapes: ("star" | "vinyl" | "note")[] = ["star", "vinyl", "note"];

    let draggedParticle: Particle | null = null;

    const mouse = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      radius: 150,
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (draggedParticle) {
        draggedParticle.x = e.clientX;
        draggedParticle.y = e.clientY;
        draggedParticle.vx = 0;
        draggedParticle.vy = 0;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (Math.sqrt(dx * dx + dy * dy) < p.size * 1.5) {
          // 1.5 multiplier makes it easier to grab
          draggedParticle = p;
          break;
        }
      }
    };

    const handleMouseUp = () => {
      draggedParticle = null;
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    };

    const initParticles = () => {
      particles = [];
      const numParticles = Math.min(
        Math.floor((window.innerWidth * window.innerHeight) / 50000),
        25,
      );

      for (let i = 0; i < numParticles; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.1, // Even slower
          vy: (Math.random() - 0.5) * 0.1, // Even slower
          size: Math.random() * 15 + 12, // Slightly larger to show icon details
          color: colors[Math.floor(Math.random() * colors.length)],
          shape: shapes[Math.floor(Math.random() * shapes.length)],
          opacity: Math.random() * 0.15 + 0.25, // Opacity between 0.25 and 0.40
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.02, // Very slow continuous rotation
        });
      }
    };

    const hexToRgba = (hex: string, alpha: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const drawShape = (p: Particle) => {
      ctx.beginPath();
      ctx.fillStyle = hexToRgba(p.color, p.opacity);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);

      if (p.shape === "star") {
        const spikes = 5;
        const outerRadius = p.size;
        const innerRadius = p.size / 2;
        let rot = (Math.PI / 2) * 3;
        const step = Math.PI / spikes;

        ctx.moveTo(0, -outerRadius);
        for (let i = 0; i < spikes; i++) {
          ctx.lineTo(Math.cos(rot) * outerRadius, Math.sin(rot) * outerRadius);
          rot += step;
          ctx.lineTo(Math.cos(rot) * innerRadius, Math.sin(rot) * innerRadius);
          rot += step;
        }
        ctx.lineTo(0, -outerRadius);
        ctx.closePath();
      } else if (p.shape === "vinyl") {
        ctx.arc(0, 0, p.size, 0, Math.PI * 2, false);
        ctx.arc(0, 0, p.size * 0.25, 0, Math.PI * 2, true);
      } else if (p.shape === "note") {
        const r = p.size * 0.4;
        // Left head
        ctx.moveTo(-p.size / 2 + r, p.size / 2);
        ctx.arc(-p.size / 2, p.size / 2, r, 0, Math.PI * 2);
        // Right head
        ctx.moveTo(p.size / 2 + r, p.size / 2);
        ctx.arc(p.size / 2, p.size / 2, r, 0, Math.PI * 2);
        // Stems
        ctx.rect(
          -p.size / 2 + r - r * 0.4,
          -p.size * 0.8,
          r * 0.4,
          p.size * 1.3,
        );
        ctx.rect(
          p.size / 2 + r - r * 0.4,
          -p.size * 0.8,
          r * 0.4,
          p.size * 1.3,
        );
        // Beam
        ctx.rect(
          -p.size / 2 + r - r * 0.4,
          -p.size * 0.8,
          p.size + r * 0.4,
          r * 0.6,
        );
      }

      ctx.fill();
      ctx.restore();
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bgColor = isDark ? "#101820" : "#f8fafc";
      canvas.style.backgroundColor = bgColor;

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Soft speed limit to prevent them from flying too fast
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

        // Strict friction to keep them floating extremely slowly
        if (speed > 0.1 && draggedParticle !== p) {
          p.vx *= 0.95;
          p.vy *= 0.95;
        }

        // Smoothly rotate towards movement direction, but ONLY if moving fast enough
        // If moving too slow, the tiny random physics drift causes the angle to glitch wildly
        if (speed > 0.1) {
          const targetAngle = Math.atan2(p.vy, p.vx);
          let angleDiff = targetAngle - p.rotation;

          // Normalize angle difference to take the shortest path
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

          // Turn 5% of the way towards the target angle per frame (very smooth)
          p.rotation += angleDiff * 0.05;
        }

        // Move
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off edges
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        // Mouse interaction (repel) - significantly weaker
        const mdx = mouse.x - p.x;
        const mdy = mouse.y - p.y;
        const distance = Math.sqrt(mdx * mdx + mdy * mdy);

        if (
          draggedParticle !== p &&
          distance > 0.1 &&
          distance < mouse.radius
        ) {
          const forceDirectionX = mdx / distance;
          const forceDirectionY = mdy / distance;
          const force = (mouse.radius - distance) / mouse.radius;
          const repulseX = forceDirectionX * force * -0.15; // Weaker repulsion
          const repulseY = forceDirectionY * force * -0.15;

          p.x += repulseX;
          p.y += repulseY;
        }

        drawShape(p);

        // Draw connections and handle physical collisions
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const cdx = p.x - p2.x;
          const cdy = p.y - p2.y;
          const dist = Math.sqrt(cdx * cdx + cdy * cdy);

          // Physical collision (Normal Physics - only affects adjacent overlapping objects)
          const collisionRadius = p.size + p2.size;
          if (dist < collisionRadius && dist > 0) {
            const force = (collisionRadius - dist) / collisionRadius;
            const repulseX = (cdx / dist) * force * 0.5; // Physical bounce force
            const repulseY = (cdy / dist) * force * 0.5;

            if (draggedParticle !== p) {
              p.vx += repulseX;
              p.vy += repulseY;
            }
            if (draggedParticle !== p2) {
              p2.vx -= repulseX;
              p2.vy -= repulseY;
            }
          }

          // Draw connecting lines
          if (dist < 200) {
            ctx.beginPath();
            const opacity = 1 - dist / 200;
            ctx.strokeStyle = isDark
              ? `rgba(255, 255, 255, ${opacity * 0.2})`
              : `rgba(0, 0, 0, ${opacity * 0.15})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    resize();
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      cancelAnimationFrame(animationFrameId);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
    />
  );
}
