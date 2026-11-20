"use client";

import React, { useEffect, useState } from "react";


type MascotState =
  | "idle"
  | "email"
  | "password"
  | "error"
  | "success"
  | "loading";

interface ChickenMascotProps {
  state: MascotState;
  emailLength?: number;
}

/**
 * beAlpha Chicken Mascot — SVG + CSS animations
 * States:
 *   idle     → looking forward, blinks
 *   email    → eyes track typing (look left-right)
 *   password → wings cover eyes
 *   error    → surprised/sad
 *   success  → happy celebration
 *   loading  → slightly bouncing
 */
export default function ChickenMascot({
  state,
  emailLength = 0,
}: ChickenMascotProps) {
  const [blink, setBlink] = useState(false);

  // Blink animation on idle
  useEffect(() => {
    if (state !== "idle") return;
    const interval = setInterval(
      () => {
        setBlink(true);
        setTimeout(() => setBlink(false), 150);
      },
      3000 + Math.random() * 2000,
    );
    return () => clearInterval(interval);
  }, [state]);

  // Eye position based on email length (look left to right)
  const maxShift = 4;
  const eyeShiftX =
    state === "email"
      ? Math.min(emailLength * 0.3, maxShift) - maxShift / 2
      : 0;
  const eyeShiftY = state === "email" ? 1 : 0;

  // Wing position
  const wingsUp = state === "password";

  // Eye scale for blink/surprise
  const eyeScaleY =
    blink || state === "loading" ? 0.1 : state === "error" ? 1.3 : 1;
  const eyeScaleX = state === "error" ? 1.2 : 1;

  // Mouth shape
  const getMouth = () => {
    switch (state) {
      case "error":
        return (
          <ellipse
            cx="100"
            cy="128"
            rx="5"
            ry="6"
            fill="#E8943A"
            stroke="#D4802E"
            strokeWidth="1"
          />
        );
      case "success":
        return (
          <path
            d="M92 124 Q100 132 108 124"
            fill="none"
            stroke="#E8943A"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        );
      default:
        return (
          <>
            {/* Beak */}
            <path
              d="M93 120 L100 128 L107 120 Z"
              fill="#F4A832"
              stroke="#E8943A"
              strokeWidth="1"
            />
            <line
              x1="96"
              y1="122"
              x2="104"
              y2="122"
              stroke="#E8943A"
              strokeWidth="0.8"
            />
          </>
        );
    }
  };

  return (
    <div
      className="relative select-none"
      style={{
        width: 180,
        height: 200,
        animation:
          state === "loading"
            ? "mascotBounce 0.6s ease-in-out infinite"
            : state === "success"
              ? "mascotCelebrate 0.5s ease-out"
              : "none",
      }}
    >
      <svg
        viewBox="0 0 200 200"
        width="180"
        height="200"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Body gradient */}
          <radialGradient id="bodyGrad" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#FFFDF5" />
            <stop offset="100%" stopColor="#FFF5E0" />
          </radialGradient>
          {/* Head gradient */}
          <radialGradient id="headGrad" cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#FFF8E8" />
          </radialGradient>
          {/* Crown gradient */}
          <linearGradient id="crownGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFD93D" />
            <stop offset="100%" stopColor="#F4A832" />
          </linearGradient>
          {/* Shadow */}
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="0"
              dy="3"
              stdDeviation="4"
              floodColor="#000"
              floodOpacity="0.1"
            />
          </filter>
        </defs>

        {/* === BODY (below head) === */}
        <ellipse
          cx="100"
          cy="165"
          rx="42"
          ry="32"
          fill="url(#bodyGrad)"
          stroke="#F0E0C0"
          strokeWidth="1.5"
          filter="url(#softShadow)"
        />

        {/* === FEET === */}
        <ellipse
          cx="80"
          cy="192"
          rx="12"
          ry="5"
          fill="#F4A832"
          stroke="#E8943A"
          strokeWidth="1"
        />
        <ellipse
          cx="120"
          cy="192"
          rx="12"
          ry="5"
          fill="#F4A832"
          stroke="#E8943A"
          strokeWidth="1"
        />

        {/* === WINGS === */}
        <g
          style={{
            transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transformOrigin: "65px 130px",
            transform: wingsUp
              ? "rotate(-60deg) translate(-10px, -30px)"
              : "rotate(0deg)",
          }}
        >
          {/* Left wing */}
          <ellipse
            cx="58"
            cy="150"
            rx="16"
            ry="24"
            fill="#FFF5E0"
            stroke="#F0E0C0"
            strokeWidth="1.5"
            transform="rotate(-10 58 150)"
          />
        </g>
        <g
          style={{
            transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transformOrigin: "135px 130px",
            transform: wingsUp
              ? "rotate(60deg) translate(10px, -30px)"
              : "rotate(0deg)",
          }}
        >
          {/* Right wing */}
          <ellipse
            cx="142"
            cy="150"
            rx="16"
            ry="24"
            fill="#FFF5E0"
            stroke="#F0E0C0"
            strokeWidth="1.5"
            transform="rotate(10 142 150)"
          />
        </g>

        {/* === HEAD === */}
        <circle
          cx="100"
          cy="95"
          r="48"
          fill="url(#headGrad)"
          stroke="#F0E0C0"
          strokeWidth="1.5"
          filter="url(#softShadow)"
        />

        {/* === CROWN / COMB === */}
        <g>
          <path
            d="M85 52 Q88 38 94 48 Q97 36 100 46 Q103 34 106 46 Q112 38 115 52"
            fill="url(#crownGrad)"
            stroke="#E8943A"
            strokeWidth="1"
          />
        </g>

        {/* === ALPHA SYMBOL on forehead === */}
        <text
          x="100"
          y="78"
          textAnchor="middle"
          fontSize="14"
          fontWeight="800"
          fontFamily="Inter, sans-serif"
          fill="#F4A832"
          opacity="0.5"
        >
          α
        </text>

        {/* === EYES === */}
        <g
          style={{
            transition: "transform 0.2s ease-out",
            transform: `translate(${eyeShiftX}px, ${eyeShiftY}px)`,
          }}
        >
          {/* Left eye */}
          <g
            style={{
              transformOrigin: "85px 95px",
              transition: "transform 0.15s ease",
              transform: `scaleX(${eyeScaleX}) scaleY(${eyeScaleY})`,
            }}
          >
            <circle
              cx="85"
              cy="95"
              r="8"
              fill="white"
              stroke="#E0D4C0"
              strokeWidth="1"
            />
            <circle cx="85" cy="95" r="5" fill="#2D2D2D" />
            <circle cx="83" cy="93" r="1.8" fill="white" />
          </g>
          {/* Right eye */}
          <g
            style={{
              transformOrigin: "115px 95px",
              transition: "transform 0.15s ease",
              transform: `scaleX(${eyeScaleX}) scaleY(${eyeScaleY})`,
            }}
          >
            <circle
              cx="115"
              cy="95"
              r="8"
              fill="white"
              stroke="#E0D4C0"
              strokeWidth="1"
            />
            <circle cx="115" cy="95" r="5" fill="#2D2D2D" />
            <circle cx="113" cy="93" r="1.8" fill="white" />
          </g>
        </g>

        {/* === CHEEKS === */}
        <circle cx="72" cy="108" r="7" fill="#FFB5B5" opacity="0.4" />
        <circle cx="128" cy="108" r="7" fill="#FFB5B5" opacity="0.4" />

        {/* === MOUTH / BEAK === */}
        {getMouth()}

        {/* === Wing covers for password (on top of eyes) === */}
        {wingsUp && (
          <>
            <ellipse
              cx="85"
              cy="92"
              rx="18"
              ry="14"
              fill="#FFF5E0"
              stroke="#F0E0C0"
              strokeWidth="1.5"
              style={{ animation: "wingCover 0.35s ease-out" }}
            />
            <ellipse
              cx="115"
              cy="92"
              rx="18"
              ry="14"
              fill="#FFF5E0"
              stroke="#F0E0C0"
              strokeWidth="1.5"
              style={{ animation: "wingCover 0.35s ease-out" }}
            />
          </>
        )}
      </svg>

      {/* CSS animations */}
      <style jsx>{`
        @keyframes mascotBounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
        @keyframes mascotCelebrate {
          0% {
            transform: scale(1);
          }
          30% {
            transform: scale(1.1) rotate(-3deg);
          }
          60% {
            transform: scale(1.05) rotate(3deg);
          }
          100% {
            transform: scale(1) rotate(0deg);
          }
        }
        @keyframes wingCover {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
