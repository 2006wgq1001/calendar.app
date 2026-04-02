import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './CommunityHub.css';

const categories = ['工作动态', '技术分享', '求助', '生活日常', '娱乐'];

function CommunityHub() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [commentDraft, setCommentDraft] = useState({});

  const fetchPosts = async () => {
    const response = await axios.get('/posts');
    setPosts(response.data || []);
  };

  useEffect(() => {
    fetchPosts().catch((e) => console.error(e));
  }, []);

  const createPost = async () => {
    if (!content.trim()) return;
    await axios.post('/posts', { content: content.trim(), category });
    setContent('');
    await fetchPosts();
  };

  const likePost = async (postId) => {
    await axios.post(`/posts/${postId}/like`);
    await fetchPosts();
  };

  const commentPost = async (postId) => {
    const text = (commentDraft[postId] || '').trim();
    if (!text) return;
    await axios.post(`/posts/${postId}/comments`, { content: text });
    setCommentDraft((prev) => ({ ...prev, [postId]: '' }));
    await fetchPosts();
  };

  return (
    <div className="community-page">
      <header>
        <h2>内容社区 · 动态广场</h2>
        <button onClick={() => navigate('/')}>返回工作台</button>
      </header>

      <section className="post-editor">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="分享你的想法、工作进展或问题..."
          maxLength={600}
        />
        <button onClick={createPost}>发布动态</button>
      </section>

      <section className="posts-list">
        {posts.length === 0 && <div className="empty">暂时还没有动态</div>}
        {posts.map((post) => (
          <article key={post.id} className="post-card">
            <div className="post-head">
              <strong>{post.author?.name || post.author?.username}</strong>
              <span>{post.category} · {post.created_at}</span>
            </div>
            <p>{post.content}</p>
            <div className="post-actions">
              <button onClick={() => likePost(post.id)}>点赞 {post.likes || 0}</button>
            </div>

            <div className="comment-box">
              <input
                value={commentDraft[post.id] || ''}
                onChange={(e) => setCommentDraft((prev) => ({ ...prev, [post.id]: e.target.value }))}
                placeholder="写评论..."
              />
              <button onClick={() => commentPost(post.id)}>发送</button>
            </div>

            <ul className="comment-list">
              {(post.comments || []).map((c) => (
                <li key={c.id}>
                  <strong>{c.user?.username}:</strong> {c.content}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  );
}

export default CommunityHub;
