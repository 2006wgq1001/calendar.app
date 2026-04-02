import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './HomePage.css';

const HomePage = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState({
    events_count: 0,
    tasks_total: 0,
    tasks_done: 0,
    posts_count: 0,
    contacts_count: 0,
    teams_count: 0,
  });
  const [myPosts, setMyPosts] = useState([]);
  const [statusText, setStatusText] = useState(user?.status || '');
  const [savingStatus, setSavingStatus] = useState(false);

  const openCalendar = () => {
    navigate('/calendar');
  };

  // load and sort events from server
  const fetchEvents = async () => {
    try {
      const response = await axios.get('/events');
      let evs = response.data || [];
      evs.sort((a, b) => {
        const da = new Date(a.start_date);
        const db = new Date(b.start_date);
        if (da - db !== 0) return da - db;
        const ta = a.start_time || '';
        const tb = b.start_time || '';
        return ta.localeCompare(tb);
      });
      setEvents(evs);
    } catch (err) {
      console.error('Failed to load events on homepage', err);
    }
  };

  const fetchSummary = async () => {
    try {
      const response = await axios.get('/dashboard/summary');
      setSummary(response.data || {});
    } catch (err) {
      console.error('Failed to load dashboard summary', err);
    }
  };

  const fetchMyPosts = async () => {
    try {
      const response = await axios.get('/posts?scope=mine');
      setMyPosts((response.data || []).slice(0, 5));
    } catch (err) {
      console.error('Failed to load personal posts', err);
    }
  };

  const saveStatus = async () => {
    setSavingStatus(true);
    try {
      await axios.put('/status', { status: statusText });
    } catch (err) {
      console.error('Failed to save status', err);
    } finally {
      setSavingStatus(false);
    }
  };

  // fetch events when user becomes available
  useEffect(() => {
    if (user) {
      fetchEvents();
      fetchSummary();
      fetchMyPosts();
      setStatusText(user.status || '');
    }
  }, [user]);

  const moduleCards = [
    { title: 'AI 协同共享日历', desc: '多人协作排期、管理行程和提醒', action: () => navigate('/calendar') },
    { title: '任务管理系统', desc: '创建团队、分配任务、追踪进度', action: () => navigate('/tasks') },
    { title: '智能会议室', desc: '音视频沟通与会议协作', action: () => navigate('/meeting') },
    { title: '远程操控', desc: '发起协助请求，经对方同意后进入远程协助', action: () => navigate('/remote-control') },
    { title: '通讯录', desc: '添加联系人、分组标签、快捷沟通', action: () => navigate('/contacts') },
    { title: 'AI 助手系统', desc: '会议时段建议与任务拆解', action: () => navigate('/assistant') },
    { title: '内容社区（动态广场）', desc: '发布动态、评论互动、点赞', action: () => navigate('/community') },
    { title: '个人主页', desc: '维护个人信息与对外展示状态', action: () => navigate('/profile') },
  ];

  const kpiActions = [
    { key: 'events', label: '事件', value: summary.events_count || 0, action: () => navigate('/calendar') },
    { key: 'tasks', label: '任务', value: summary.tasks_total || 0, action: () => navigate('/tasks') },
    { key: 'done', label: '已完成', value: summary.tasks_done || 0, action: () => navigate('/tasks?status=done') },
    { key: 'teams', label: '团队', value: summary.teams_count || 0, action: () => navigate('/tasks?view=teams') },
  ];

  return (
    <div className="home-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>我的日程</h2>
          <button className="refresh-btn" onClick={() => { fetchEvents(); fetchSummary(); fetchMyPosts(); }}>
            刷新
          </button>
        </div>

        <div className="status-box">
          <div className="status-title">个人动态</div>
          <textarea
            value={statusText}
            onChange={(e) => setStatusText(e.target.value)}
            placeholder="写下你今天的状态..."
            maxLength={200}
          />
          <button className="save-status-btn" onClick={saveStatus} disabled={savingStatus}>
            {savingStatus ? '保存中...' : '保存状态'}
          </button>
        </div>

        <div className="kpi-grid">
          {kpiActions.map((item) => (
            <button
              key={item.key}
              className="kpi-item kpi-btn"
              onClick={item.action}
              title={`查看${item.label}相关内容`}
            >
              <span>{item.label}</span>
              <b>{item.value}</b>
            </button>
          ))}
        </div>

        <ul className="event-list">
          {events.length === 0 && <li>暂无事件</li>}
          {events.slice(0, 10).map((ev) => (
            <li key={ev.id} className="event-item">
              <div className="event-date">
                {ev.start_date}
                {ev.start_time && ` ${ev.start_time}`}
              </div>
              <div className="event-title">{ev.title}</div>
            </li>
          ))}
        </ul>
      </aside>

      <div className="main-content">
        <header className="home-header">
          <div>
            <h1>灵境工坊 · 协作中枢</h1>
            <p style={{ margin: '6px 0 0', fontSize: '12px', opacity: 0.75 }}>版本 2026.04.02-R2</p>
            <p>欢迎回来，{user && (user.name || user.username)}。今天继续推进团队目标。</p>
          </div>
          <div className="header-actions">
            <button className="home-btn" onClick={openCalendar}>日历</button>
            <button className="home-btn" onClick={() => navigate('/profile')}>个人主页</button>
            <button className="home-logout-btn" onClick={onLogout}>退出登录</button>
          </div>
        </header>

        <main className="home-main">
          <section className="modules-panel">
            <h2>模块能力</h2>
            <div className="module-grid">
              {moduleCards.map((card) => (
                <button key={card.title} className="module-card" onClick={card.action}>
                  <h3>{card.title}</h3>
                  <p>{card.desc}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="feed-panel">
            <h2>我的近期动态</h2>
            <ul className="my-posts-list">
              {myPosts.length === 0 && <li>还没有动态，去动态广场发布第一条吧。</li>}
              {myPosts.map((post) => (
                <li key={post.id}>
                  <div className="post-meta">{post.category} · {post.created_at}</div>
                  <div className="post-content">{post.content}</div>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
};

export default HomePage;
