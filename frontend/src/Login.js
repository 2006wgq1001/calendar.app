import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios, { setAuthToken } from './axiosConfig';
import './Login.css';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const testConnection = async () => {
    try {
      console.log('Testing connection to backend...');
      const response = await axios.get('/test');
      console.log('Connection test successful:', response.data);
    } catch (err) {
      console.error('Connection test failed:', err);
    }
  };

  // 在组件加载时测试连接
  useEffect(() => {
    testConnection();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    console.log('Login attempt with:', { username, password });

    try {
      console.log('Sending login request to /login...');
      const response = await axios.post('/login', {
        username,
        password
      });
      console.log('Raw response:', response);
      console.log('Response data:', response.data);

      if (response.data.success) {
        if (response.data.token) {
          setAuthToken(response.data.token);
        }
        console.log('Login successful, user data:', response.data.user);
        onLogin(response.data.user);
      } else {
        console.log('Login failed, response:', response.data);
        setError(response.data.message || '登录失败');
      }
    } catch (err) {
      console.error('Login error details:', err);
      console.error('Error response:', err.response);
      console.error('Error status:', err.response?.status);
      console.error('Error data:', err.response?.data);

      if (err.response) {
        // 服务器响应了错误状态码
        setError(err.response.data?.message || `登录失败 (${err.response.status})`);
      } else if (err.request) {
        // 请求发送了但没有收到响应
        console.error('No response received:', err.request);
        setError('网络连接失败，请检查后端服务器是否运行');
      } else {
        // 其他错误
        setError('请求配置错误');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>📅 日历应用</h1>
          <p>请登录以继续</p>
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
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="login-footer">
          <p>默认账号：123456 / 123456</p>
          <p>没有账号？ <Link to="/register">注册</Link></p>
        </div>
      </div>
    </div>
  );
};

export default Login;