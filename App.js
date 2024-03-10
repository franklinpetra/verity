// App.js
import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import Home from '../pages/Home';
import About from '../pages/About';
import Contact from '../pages/Contact';
import ClockFace from '../components/ClockFace'; // Import the ClockFace component

const App = () => {
  return (
    <Router>
      <div className="App">
        <Switch>
          <Route exact path="/pages/Home" component={Home} />
          <Route path="/pages/About" component={About} />
          <Route path="/page/Contact" component={Contact} />
          <Route path="/component/ClockFace" component={ClockFace} /> {/* Add route for ClockFace */}
        </Switch>
      </div>
    </Router>
  );
};

export default App;