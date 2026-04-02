import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Calendar from './Calendar';
import EventModal from './EventModal';
import Login from './Login';
import Register from './Register';
import HomePage from './HomePage';
import LandingPage from './LandingPage';
import Profile from './Profile';
import MeetingRoom from './MeetingRoom';
import TaskHub from './TaskHub';
import ContactsHub from './ContactsHub';
import CommunityHub from './CommunityHub';
import AssistantHub from './AssistantHub';
import RemoteControlHub from './RemoteControlHub';
import axios, { clearAuthToken, setAuthToken } from './axiosConfig';
import './App.css';

const ROUTER_BASENAME = window.location.hostname.includes('github.io') ? '/calendar-app' : '/';

function App() {
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) {
      fetchEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, user]);

  const checkAuth = async () => {
    try {
      const response = await axios.get('/auth/check');
      setUser(response.data.user);
      if (response.data.token) {
        setAuthToken(response.data.token);
      }
    } catch (error) {
      setUser(null);
      clearAuthToken();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    try {
      await axios.post('/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuthToken();
      setUser(null);
    }
  };

  const fetchEvents = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);
    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth() + 1;
      // 前端主动发出请求给后端
      const response = await axios.get(`/events?year=${year}&month=${month}`);
      setEvents(response.data);
    } catch (error) {
      console.error('Error fetching events:', error);
      setError('加载事件失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  const handleDateClick = (date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
    setIsModalOpen(true);
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setSelectedDate(new Date(event.start_date));
    setIsModalOpen(true);
  };

  const handleSaveEvent = async (eventData) => {
    try {
      if (selectedEvent) {
        await axios.put(`/events/${selectedEvent.id}`, eventData);
      } else {
        await axios.post('/events', eventData);
      }
      fetchEvents();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving event:', error);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      await axios.delete(`/events/${eventId}`);
      fetchEvents();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error deleting event:', error);
    }
  };

  if (authLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <Router basename={ROUTER_BASENAME}>
      <div className="App">
        <Routes>
          <Route
            path="/login"
            element={
              user ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />
            }
          />
          <Route
            path="/register"
            element={
              user ? <Navigate to="/" replace /> : <Register onLogin={handleLogin} />
            }
          />
          <Route
            path="/"
            element={
              user ? <HomePage user={user} onLogout={handleLogout} /> : <LandingPage />
            }
          />
          <Route
            path="/profile"
            element={
              user ? (
                <Profile user={user} setUser={setUser} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/calendar"
            element={
              user ? (
                <>
                  <header className="app-header">
                    <h1>📅 日历应用</h1>
                    <button className="logout-btn" onClick={handleLogout}>
                      退出登录
                    </button>
                  </header>
                  <main>
                    <Calendar
                      events={events}
                      onDateClick={handleDateClick}
                      onEventClick={handleEventClick}
                      currentMonth={currentMonth}
                      setCurrentMonth={setCurrentMonth}
                      loading={loading}
                      error={error}
                    />
                    <EventModal
                      isOpen={isModalOpen}
                      onClose={() => setIsModalOpen(false)}
                      onSave={handleSaveEvent}
                      onDelete={handleDeleteEvent}
                      selectedDate={selectedDate}
                      event={selectedEvent}
                    />
                  </main>
                </>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/meeting"
            element={
              user ? (
                <MeetingRoom user={user} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/tasks"
            element={
              user ? (
                <TaskHub />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/contacts"
            element={
              user ? (
                <ContactsHub />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/community"
            element={
              user ? (
                <CommunityHub />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/assistant"
            element={
              user ? (
                <AssistantHub />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/remote-control"
            element={
              user ? (
                <RemoteControlHub />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;