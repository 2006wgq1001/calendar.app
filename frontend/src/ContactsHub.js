import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './ContactsHub.css';

function ContactsHub() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [searchResult, setSearchResult] = useState([]);
  const [draft, setDraft] = useState({ tag: '', note: '' });
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [showRequestModal, setShowRequestModal] = useState(false);

  const fetchContacts = async () => {
    const response = await axios.get('/contacts');
    setContacts(response.data || []);
  };

  const fetchFriendRequests = async () => {
    const [incomingRes, outgoingRes] = await Promise.all([
      axios.get('/contact-requests/incoming'),
      axios.get('/contact-requests/outgoing'),
    ]);
    setIncomingRequests(incomingRes.data || []);
    setOutgoingRequests(outgoingRes.data || []);
  };

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchContacts(), fetchFriendRequests()]);
    };

    init().catch((e) => console.error(e));

    const timer = setInterval(() => {
      fetchFriendRequests().catch((e) => console.error(e));
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (incomingRequests.length > 0) {
      setShowRequestModal(true);
    }
  }, [incomingRequests]);

  const searchUsers = async () => {
    if (!keyword.trim()) {
      setSearchResult([]);
      return;
    }
    const response = await axios.get(`/contacts/search?q=${encodeURIComponent(keyword.trim())}`);
    setSearchResult(response.data || []);
  };

  const addContact = async (userId) => {
    await axios.post('/contacts', {
      contact_user_id: userId,
      tag: draft.tag,
      note: draft.note,
      is_favorite: false,
    });
    await fetchFriendRequests();
    alert('好友申请已发送，等待对方同意。');
  };

  const toggleFavorite = async (contact) => {
    await axios.put(`/contacts/${contact.id}`, { is_favorite: !contact.is_favorite });
    await fetchContacts();
  };

  const removeContact = async (id) => {
    await axios.delete(`/contacts/${id}`);
    await fetchContacts();
  };

  const respondFriendRequest = async (requestId, action) => {
    await axios.post(`/contact-requests/${requestId}/respond`, { action });
    await Promise.all([fetchContacts(), fetchFriendRequests()]);
  };

  return (
    <div className="contacts-page">
      <header>
        <h2>通讯录</h2>
        <button onClick={() => navigate('/')}>返回工作台</button>
      </header>

      <section className="contacts-layout">
        <div className="contacts-block">
          <h3>添加好友</h3>
          <div className="row">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="输入用户名搜索"
            />
            <button onClick={searchUsers}>搜索</button>
          </div>
          <div className="row">
            <input
              value={draft.tag}
              onChange={(e) => setDraft((p) => ({ ...p, tag: e.target.value }))}
              placeholder="标签（如 前端 / 客户）"
            />
            <input
              value={draft.note}
              onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
              placeholder="备注"
            />
          </div>

          <ul>
            {searchResult.map((u) => (
              <li key={u.id}>
                <span>{u.username}（{u.name || '未设置昵称'}）</span>
                <button onClick={() => addContact(u.id)}>添加</button>
              </li>
            ))}
          </ul>

          <h3 className="sub-title">已发送申请</h3>
          <ul>
            {outgoingRequests.length === 0 && <li>暂无待处理申请</li>}
            {outgoingRequests.map((req) => (
              <li key={req.id}>
                <span>{req.receiver?.username || '未知用户'}（等待处理）</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="contacts-block">
          <h3>收到的好友申请</h3>
          <ul>
            {incomingRequests.length === 0 && <li>暂无新的好友申请</li>}
            {incomingRequests.map((req) => (
              <li key={req.id}>
                <div>
                  <strong>{req.requester?.username || '未知用户'}</strong>
                  <div className="contact-meta">{req.request_note || '对方没有留言'}</div>
                </div>
                <div className="actions">
                  <button onClick={() => respondFriendRequest(req.id, 'accepted')}>同意</button>
                  <button className="danger" onClick={() => respondFriendRequest(req.id, 'rejected')}>拒绝</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="contacts-block">
          <h3>我的联系人</h3>
          <ul>
            {contacts.length === 0 && <li>还没有联系人</li>}
            {contacts.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.contact_user?.username}</strong>
                  <div className="contact-meta">{c.tag || '未分组'} · {c.note || '无备注'}</div>
                </div>
                <div className="actions">
                  <button onClick={() => toggleFavorite(c)}>{c.is_favorite ? '取消星标' : '星标'}</button>
                  <button className="danger" onClick={() => removeContact(c.id)}>删除</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {showRequestModal && incomingRequests.length > 0 && (
        <div className="request-modal-mask">
          <div className="request-modal">
            <h3>你收到了新的好友申请</h3>
            <p>请及时处理，避免错过协作消息。</p>
            <ul>
              {incomingRequests.map((req) => (
                <li key={`modal-${req.id}`}>
                  <span>{req.requester?.username || '未知用户'} 想添加你为好友</span>
                  <div className="actions">
                    <button onClick={() => respondFriendRequest(req.id, 'accepted')}>同意</button>
                    <button className="danger" onClick={() => respondFriendRequest(req.id, 'rejected')}>拒绝</button>
                  </div>
                </li>
              ))}
            </ul>
            <button className="modal-close" onClick={() => setShowRequestModal(false)}>稍后处理</button>
          </div>
        </div>
      )}

    </div>
  );
}

export default ContactsHub;
