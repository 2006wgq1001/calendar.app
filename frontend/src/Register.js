import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios, { setAuthToken } from './axiosConfig';
import './Login.css'; // reuse styles

const Register = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post('/register', {
        username,
        password,
      });
      if (response.data.success) {
        if (response.data.token) {
          setAuthToken(response.data.token);
        }
        onLogin(response.data.user);
        navigate('/');
      } else {
        setError(response.data.message || '注册失败');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.response?.data?.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>📅 注册账号</h1>
          <p>创建新用户</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label>用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              required
            />
          </div>

          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              required
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </button>
        </form>

        <div className="login-footer">
          <p>已有账号？ <Link to="/login">登录</Link></p>
        </div>
      </div>
    </div>
  );
};

export default Register;
