import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './RemoteControlHub.css';

function RemoteControlHub() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [controlNote, setControlNote] = useState('我想远程协助你处理问题');
  const [showRequestModal, setShowRequestModal] = useState(false);

  const fetchContacts = async () => {
    const response = await axios.get('/contacts');
    setContacts(response.data || []);
  };

  const fetchRemoteControlRequests = async () => {
    const [incomingRes, outgoingRes] = await Promise.all([
      axios.get('/remote-control-requests/incoming'),
      axios.get('/remote-control-requests/outgoing'),
    ]);
    setIncomingRequests(incomingRes.data || []);
    setOutgoingRequests(outgoingRes.data || []);
  };

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchContacts(), fetchRemoteControlRequests()]);
    };

    init().catch((e) => console.error(e));

    const timer = setInterval(() => {
      fetchRemoteControlRequests().catch((e) => console.error(e));
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (incomingRequests.length > 0) {
      setShowRequestModal(true);
    }
  }, [incomingRequests]);

  const requestRemoteControl = async () => {
    const targetContact = contacts.find((c) => String(c.id) === String(selectedContactId));
    const targetUserId = targetContact?.contact_user?.id || targetContact?.contact_user_id;
    const targetName = targetContact?.contact_user?.username || '对方';

    if (!targetUserId) {
      alert('请先在联系人列表中选择一个对象。');
      return;
    }

    const response = await axios.post('/remote-control-requests', {
      target_user_id: targetUserId,
      control_note: controlNote,
    });

    const roomId = response?.data?.request?.room_id;
    await fetchRemoteControlRequests();
    alert('远程操控请求已发送，正在进入协助房间等待对方同意。');

    if (roomId) {
      navigate('/meeting', {
        state: {
          autoJoinRoomId: roomId,
          controlRole: 'controller',
          controlPeerName: targetName,
        },
      });
    }
  };

  const respondRemoteControlRequest = async (requestId, action) => {
    const response = await axios.post(`/remote-control-requests/${requestId}/respond`, { action });
    await fetchRemoteControlRequests();

    if (action === 'accepted') {
      const roomId = response?.data?.request?.room_id;
      if (roomId) {
        navigate('/meeting', {
          state: {
            autoJoinRoomId: roomId,
            controlRole: 'target',
            controlPeerName: response?.data?.request?.requester?.username || '对方',
          },
        });
      }
    }
  };

  return (
    <div className="remote-control-page">
      <header>
        <h2>远程操控</h2>
        <button onClick={() => navigate('/')}>返回工作台</button>
      </header>

      <section className="remote-control-layout">
        <div className="remote-control-block">
          <h3>发起远程操控</h3>
          <p className="tip">从联系人中选择一个人发起远程协助，对方同意后进入同一协助房间。</p>
          <div className="row">
            <select
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
              disabled={contacts.length === 0}
            >
              <option value="">请选择通讯录联系人</option>
              {contacts.map((c) => (
                <option key={`target-${c.id}`} value={String(c.id)}>
                  {(c.contact_user?.username || '未知用户') + (c.note ? `（${c.note}）` : '')}
                </option>
              ))}
            </select>
            <input
              value={controlNote}
              onChange={(e) => setControlNote(e.target.value)}
              placeholder="请求说明（会展示给对方）"
            />
            <button onClick={requestRemoteControl} disabled={!selectedContactId || contacts.length === 0}>
              发送远程操控请求
            </button>
          </div>
          {contacts.length === 0 && <p className="empty-hint">当前没有联系人，请先去通讯录添加好友。</p>}
        </div>

        <div className="remote-control-block">
          <h3>收到的请求</h3>
          <ul>
            {incomingRequests.length === 0 && <li>暂无待处理请求</li>}
            {incomingRequests.map((req) => (
              <li key={req.id}>
                <div>
                  <strong>{req.requester?.username || '未知用户'}</strong>
                  <div className="meta">{req.control_note || '对方请求远程协助操作你的电脑'}</div>
                </div>
                <div className="actions">
                  <button onClick={() => respondRemoteControlRequest(req.id, 'accepted')}>同意</button>
                  <button className="danger" onClick={() => respondRemoteControlRequest(req.id, 'rejected')}>拒绝</button>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="sub-title">我发起的请求</h3>
          <ul>
            {outgoingRequests.length === 0 && <li>暂无请求</li>}
            {outgoingRequests.map((req) => (
              <li key={`outgoing-${req.id}`}>
                <span>{req.target_user?.username || '未知用户'}（等待对方确认）</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {showRequestModal && incomingRequests.length > 0 && (
        <div className="request-modal-mask">
          <div className="request-modal">
            <h3>远程操控确认</h3>
            <p>有人申请远程操控你的电脑，请确认是否同意。</p>
            <ul>
              {incomingRequests.map((req) => (
                <li key={`control-modal-${req.id}`}>
                  <span>
                    {req.requester?.username || '未知用户'} 请求操控你的电脑
                    {req.control_note ? `：${req.control_note}` : ''}
                  </span>
                  <div className="actions">
                    <button onClick={() => respondRemoteControlRequest(req.id, 'accepted')}>同意</button>
                    <button className="danger" onClick={() => respondRemoteControlRequest(req.id, 'rejected')}>拒绝</button>
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

export default RemoteControlHub;