import axios from 'axios';

// 配置axios默认设置
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const envBaseURL = (process.env.REACT_APP_API_BASE_URL || '').trim();
const defaultBaseURL = isLocalhost ? 'http://localhost:5000/api' : '/api';
// 线上统一走同域 /api，避免旧环境变量导致跨域被浏览器拦截。
axios.defaults.baseURL = isLocalhost ? (envBaseURL || defaultBaseURL) : defaultBaseURL;
axios.defaults.withCredentials = true; // 允许发送cookies
axios.defaults.headers.common['Content-Type'] = 'application/json';

const AUTH_TOKEN_KEY = 'calendar_auth_token';

export const getAuthToken = () => {
	try {
		return localStorage.getItem(AUTH_TOKEN_KEY) || '';
	} catch (error) {
		return '';
	}
};

export const setAuthToken = (token) => {
	if (!token) return;
	try {
		localStorage.setItem(AUTH_TOKEN_KEY, token);
	} catch (error) {
		// Ignore storage errors and continue with in-memory session.
	}
};

export const clearAuthToken = () => {
	try {
		localStorage.removeItem(AUTH_TOKEN_KEY);
	} catch (error) {
		// Ignore storage errors.
	}
};

axios.interceptors.request.use((config) => {
	const token = getAuthToken();
	if (token) {
		config.headers = config.headers || {};
		config.headers.Authorization = `Bearer ${token}`;
	}
	return config;
});

export default axios;