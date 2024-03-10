// src/pages/HomePage.js

import React from 'react';
import ClockFace from '../components/ClockFace';

const HomePage = () => {
  return (
    <div className="home-page">
      <h1>Welcome to Verity</h1>
      <ClockFace />
    </div>
  );
};

export default HomePage;