import React from 'react';
import './ClockFace.css';

const ClockFace = () => {
  // Array of button labels
  const labels = ['Button 1', 'Button 2', 'Button 3', 'Button 4', 'Button 5', 'Button 6', 'Button 7', 'Button 8', 'Button 9', 'Button 10', 'Button 11', 'Button 12'];

  return (
    <div className="parent-container">
      <div className="clock-face">
        {labels.map((label, index) => (
          <div key={index} className="button">
            <button>{label}</button>
            <input type="text" placeholder={`Text Box ${index + 1}`} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClockFace;
