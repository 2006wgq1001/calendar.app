import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './LandingPage.css';

const featureCards = [
  {
    title: '协作日历',
    desc: '统一查看团队日程、事件提醒与排期冲突。',
  },
  {
    title: '智能会议室',
    desc: '支持同房间音视频、屏幕共享和远程协助。',
  },
  {
    title: '远程操控',
    desc: '在通讯录中选择联系人，发起远程协助请求。',
  },
  {
    title: '任务与社区',
    desc: '管理任务进度，并在动态广场同步协作消息。',
  },
];

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-badge">新版已上线</div>
        <h1>灵境工坊 · 协作中枢</h1>
        <p>
          访问网址现在会直接看到新的协作首页，包含日历、会议、任务、通讯录和远程操控模块。
        </p>
        <div className="landing-actions">
          <button className="primary-btn" onClick={() => navigate('/login')}>
            登录进入
          </button>
          <Link className="secondary-btn" to="/register">
            注册账号
          </Link>
        </div>
      </section>

      <section className="landing-grid">
        {featureCards.map((card) => (
          <article key={card.title} className="feature-card">
            <h2>{card.title}</h2>
            <p>{card.desc}</p>
          </article>
        ))}
      </section>
    </div>
  );
};

export default LandingPage;