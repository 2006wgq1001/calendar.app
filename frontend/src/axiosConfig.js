import axios from 'axios';

// 配置axios默认设置
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const envBaseURL = (process.env.REACT_APP_API_BASE_URL || '').trim();

const isPrivateIpv4Host = (hostname) => {
	const parts = String(hostname || '').split('.').map((item) => Number(item));
	if (parts.length !== 4 || parts.some((num) => Number.isNaN(num) || num < 0 || num > 255)) {
		return false;
	}

	if (parts[0] === 10) return true;
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	if (parts[0] === 192 && parts[1] === 168) return true;
	return false;
};

const shouldUseLocalBackendPort =
	isLocalhost ||
	(window.location.port === '3000' && isPrivateIpv4Host(window.location.hostname));

const defaultPublicApiBaseURL = (process.env.REACT_APP_DEFAULT_PUBLIC_API_BASE_URL || 'https://calendarapp-production-d085.up.railway.app/api').trim();
const preferSameOriginApi = window.location.hostname.endsWith('railway.app');

const defaultBaseURL = shouldUseLocalBackendPort
	? `${window.location.protocol}//${window.location.hostname}:5000/api`
	: (preferSameOriginApi ? '/api' : defaultPublicApiBaseURL);
// 使用环境变量中的 API 基础 URL，确保前端能正确连接到后端
axios.defaults.baseURL = envBaseURL || defaultBaseURL;
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