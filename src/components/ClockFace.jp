// src/components/ClockFace.js

import React from 'react';
import './ClockFace.css';

const ClockFace = () => {
  // Define the clock face dimensions and center point
  const size = 200;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.4;

  // Generate the clock face buttons
  const buttons = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * 30 * Math.PI) / 180;
    const buttonX = centerX + radius * Math.sin(angle);
    const buttonY = centerY - radius * Math.cos(angle);

    return (
      <circle
        key={index}
        cx={buttonX}
        cy={buttonY}
        r="20"
        fill="white"
        stroke="black"
        strokeWidth="2"
      />
    );
  });

  return (
    <div className="clock-face">
      <svg width={size} height={size}>
        <circle cx={centerX} cy={centerY} r={radius} fill="#f0f0f0" />
        {buttons}
      </svg>
      <div className="chat-box">
        {/* Add the chat box content */}
      </div>
    </div>
  );
};

export default ClockFace;