import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from './axiosConfig';
import './MeetingRoom.css';

const resolveSignalUrl = () => {
  const explicitSignalUrl = (process.env.REACT_APP_SIGNAL_URL || '').trim();
  if (explicitSignalUrl) {
    return explicitSignalUrl;
  }

  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return ((process.env.REACT_APP_API_BASE_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:5000');
  }

  if (window.location.hostname.endsWith('railway.app')) {
    return window.location.origin;
  }

  return ((process.env.REACT_APP_API_BASE_URL || '').replace(/\/api\/?$/, '') || window.location.origin);
};

const SIGNAL_URL = resolveSignalUrl();

const DEFAULT_RTC_ICE_SERVERS = (() => {
  const stunDefaults = [
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const turnUrl = (process.env.REACT_APP_TURN_URL || '').trim();
  const turnUsername = (process.env.REACT_APP_TURN_USERNAME || '').trim();
  const turnCredential = (process.env.REACT_APP_TURN_CREDENTIAL || '').trim();

  // 可选：支持通过 JSON 数组传入多个 TURN 配置。
  // 例子：[{"urls":"turn:xxx:3478","username":"u","credential":"p"}]
  const turnServersJson = (process.env.REACT_APP_TURN_SERVERS_JSON || '').trim();
  let customTurnServers = [];
  if (turnServersJson) {
    try {
      const parsed = JSON.parse(turnServersJson);
      if (Array.isArray(parsed)) {
        customTurnServers = parsed.filter((item) => item && item.urls);
      }
    } catch (error) {
      // ignore invalid env value and continue with defaults
    }
  }

  if (turnUrl) {
    customTurnServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  // 兜底公共中继（生产建议替换为你自己的 TURN）。
  const fallbackTurnServers = [
    {
      urls: 'turn:relay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:relay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];

  return [
    ...stunDefaults,
    ...(customTurnServers.length > 0 ? customTurnServers : fallbackTurnServers),
  ];
})();

function RemoteVideo({ stream, label }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      const playPromise = videoRef.current.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // 某些浏览器会拦截自动播放，等待用户交互后会恢复。
        });
      }
    }
  }, [stream]);

  return (
    <div className="video-card">
      <video ref={videoRef} autoPlay playsInline />
      <div className="video-label">{label}</div>
    </div>
  );
}

const MeetingRoom = ({ user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [roomInput, setRoomInput] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [status, setStatus] = useState('未加入房间');
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [liveInterimText, setLiveInterimText] = useState('');
  const [transcriptLines, setTranscriptLines] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [meetingSummary, setMeetingSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [taskSyncLoading, setTaskSyncLoading] = useState(false);
  const [taskSyncMessage, setTaskSyncMessage] = useState('');
  const [shouldGenerateTeamTasks, setShouldGenerateTeamTasks] = useState(false);
  const [generatedTasks, setGeneratedTasks] = useState([]);
  const [showGeneratedTasks, setShowGeneratedTasks] = useState(false);
  const [meetingMembers, setMeetingMembers] = useState([]);
  const [roomHostSocketId, setRoomHostSocketId] = useState('');

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const makingOfferRef = useRef({});
  const pendingCandidatesRef = useRef({});
  const screenStreamRef = useRef(null);
  const isScreenSharingRef = useRef(false);
  const recognitionRef = useRef(null);
  const shouldKeepRecognizingRef = useRef(false);
  const autoJoinOnceRef = useRef(false);
  const rtcConfigLoadedRef = useRef(false);
  const rtcConfigPromiseRef = useRef(null);
  const rtcIceServersRef = useRef(DEFAULT_RTC_ICE_SERVERS);
  const remoteStreamsRef = useRef({});
  const controlRole = location.state?.controlRole || '';
  const controlPeerName = location.state?.controlPeerName || '对方';

  const currentUserName = user?.name || user?.username || '我';

  const normalizeMember = (member) => ({
    socketId: member?.socketId || '',
    userId: member?.userId || null,
    name: member?.name || `成员 ${(member?.socketId || '').slice(0, 6)}`,
    role: member?.role || 'member',
  });

  const mergeMembers = (prev, incoming) => {
    const map = new Map();
    [...prev, ...incoming].forEach((item) => {
      const normalized = normalizeMember(item);
      const key = normalized.socketId || `u-${normalized.userId || normalized.name}`;
      map.set(key, normalized);
    });
    return Array.from(map.values());
  };

  const shouldInitiatePeer = (peerId) => {
    const selfId = socketRef.current?.id || '';
    return Boolean(selfId && peerId && roomHostSocketId && selfId === roomHostSocketId);
  };

  const normalizeActionItems = (rawItems, fallbackSummary = '') => {
    let items = rawItems;
    if (Array.isArray(items)) {
      // use as-is
    } else if (items && typeof items === 'object') {
      items = [items];
    } else if (typeof items === 'string' && items.trim()) {
      items = [{ task: items.trim(), owner: '待确认', deadline: '待定' }];
    } else {
      items = [];
    }

    const normalized = items
      .map((item, idx) => {
        if (typeof item === 'string') {
          return { task: item.trim(), owner: '待确认', deadline: '待定' };
        }
        if (!item || typeof item !== 'object') {
          return null;
        }

        const task = String(item.task || item.title || '').trim() || `会议行动项 ${idx + 1}`;
        const owner = String(item.owner || item.assignee || '').trim() || '待确认';
        const deadline = String(item.deadline || item.due_date || '').trim() || '待定';
        return { task, owner, deadline };
      })
      .filter(Boolean)
      .filter((item) => item.task);

    if (normalized.length === 0 && fallbackSummary) {
      normalized.push({
        task: `根据会议摘要跟进：${String(fallbackSummary).slice(0, 60)}`,
        owner: '待确认',
        deadline: '待定',
      });
    }

    return normalized;
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      return;
    }

    setRecognitionSupported(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interimText = '';
      const finalTexts = [];

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = (result[0]?.transcript || '').trim();
        if (!text) continue;
        if (result.isFinal) {
          finalTexts.push(text);
        } else {
          interimText += `${text} `;
        }
      }

      setLiveInterimText(interimText.trim());

      if (finalTexts.length > 0) {
        const now = new Date();
        const timeText = now.toTimeString().slice(0, 8);
        const appended = finalTexts.map((text) => `${timeText} ${currentUserName}: ${text}`);
        setTranscriptLines((prev) => [...prev, ...appended].slice(-500));
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setStatus('语音识别权限被拒绝，请在浏览器中允许麦克风权限');
      }
    };

    recognition.onend = () => {
      if (shouldKeepRecognizingRef.current) {
        try {
          recognition.start();
          return;
        } catch (error) {
          console.error('Restart speech recognition failed:', error);
        }
      }
      setIsRecognizing(false);
      setLiveInterimText('');
    };

    recognitionRef.current = recognition;

    return () => {
      shouldKeepRecognizingRef.current = false;
      try {
        recognition.stop();
      } catch (error) {
        console.error('Stop speech recognition failed:', error);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserName]);

  useEffect(() => {
    return () => {
      leaveRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRoomId = () => {
    const random = Math.random().toString().slice(2, 8);
    setRoomInput(random);
  };

  const startSpeechRecognition = () => {
    if (!recognitionSupported || !recognitionRef.current) {
      setStatus('当前浏览器不支持语音识别，请使用最新版 Chrome/Edge');
      return;
    }

    if (isRecognizing) {
      return;
    }

    shouldKeepRecognizingRef.current = true;
    try {
      recognitionRef.current.start();
      setIsRecognizing(true);
      setStatus('语音识别进行中');
    } catch (error) {
      console.error('Start speech recognition failed:', error);
      setStatus('语音识别启动失败，请稍后重试');
    }
  };

  const stopSpeechRecognition = () => {
    shouldKeepRecognizingRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        console.error('Stop speech recognition failed:', error);
      }
    }
    setIsRecognizing(false);
    setLiveInterimText('');
  };

  const getOrCreateSocket = () => {
    if (!socketRef.current) {
      socketRef.current = io(SIGNAL_URL, {
        withCredentials: true,
        // 先走 polling，确保在禁用 websocket 的网络里也能建立信令。
        transports: ['polling', 'websocket'],
        upgrade: true,
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 800,
        timeout: 15000,
      });

      socketRef.current.on('connect', () => {
        setStatus('已连接会议服务，等待加入房间');
      });

      socketRef.current.on('connect_error', () => {
        setStatus('连接会议服务失败，请确认后端已启动');
      });

      socketRef.current.on('disconnect', () => {
        setStatus('会议服务连接已断开，正在尝试重连');
      });

      socketRef.current.on('room-error', (payload) => {
        setStatus(payload?.message || '加入房间失败');
      });

      socketRef.current.on('room-users', async ({ roomId, users, hostSocketId }) => {
        setStatus(`已加入房间 ${roomId}`);
        setRoomHostSocketId(hostSocketId || '');
        const selfMember = {
          socketId: socketRef.current?.id || '',
          userId: user?.id || null,
          name: currentUserName,
          role: hostSocketId && hostSocketId === socketRef.current?.id ? 'host' : 'member',
        };
        setMeetingMembers((prev) => mergeMembers(prev, [...(users || []), selfMember]));
        for (const item of users) {
          if (shouldInitiatePeer(item.socketId)) {
            await createOfferToPeer(item.socketId);
          }
        }
      });

      socketRef.current.on('user-joined', async ({ socketId, userId, name }) => {
        setStatus('有新成员加入房间');
        setMeetingMembers((prev) => mergeMembers(prev, [{ socketId, userId, name, role: 'member' }]));
        if (shouldInitiatePeer(socketId)) {
          await createOfferToPeer(socketId);
        }
      });

      socketRef.current.on('room-role-updated', ({ hostSocketId }) => {
        setRoomHostSocketId(hostSocketId || '');
        setMeetingMembers((prev) => prev.map((member) => ({
          ...member,
          role: member.socketId === hostSocketId ? 'host' : 'member',
        })));
      });

      socketRef.current.on('signal', async ({ from, signal }) => {
        await handleSignal(from, signal);
      });

      socketRef.current.on('user-left', ({ socketId }) => {
        removePeer(socketId);
        setMeetingMembers((prev) => prev.filter((m) => m.socketId !== socketId));
        setStatus('有成员离开房间');
      });
    }

    if (socketRef.current.disconnected) {
      socketRef.current.connect();
    }

    return socketRef.current;
  };

  const loadRtcConfig = async () => {
    if (rtcConfigLoadedRef.current) {
      return rtcIceServersRef.current;
    }

    if (!rtcConfigPromiseRef.current) {
      rtcConfigPromiseRef.current = axios.get('/webrtc-config')
        .then((response) => {
          const nextIceServers = Array.isArray(response?.data?.iceServers) && response.data.iceServers.length > 0
            ? response.data.iceServers
            : DEFAULT_RTC_ICE_SERVERS;
          rtcIceServersRef.current = nextIceServers;
          rtcConfigLoadedRef.current = true;
          return nextIceServers;
        })
        .catch((error) => {
          console.error('Load WebRTC config failed:', error);
          rtcConfigLoadedRef.current = true;
          rtcIceServersRef.current = DEFAULT_RTC_ICE_SERVERS;
          return DEFAULT_RTC_ICE_SERVERS;
        });
    }

    return rtcConfigPromiseRef.current;
  };

  const getLocalStream = async () => {
    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }

    return localStreamRef.current;
  };

  const createPeerConnection = async (peerId) => {
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId];
    }

    const socket = socketRef.current;
    const localStream = await getLocalStream();

    const peer = new RTCPeerConnection({
      iceServers: rtcIceServersRef.current,
    });

    // 添加所有轨道
    localStream.getTracks().forEach((track) => {
      peer.addTrack(track, localStream);
    });

    // If screen sharing is active, send screen video track to newly created peer.
    if (isScreenSharingRef.current && screenStreamRef.current) {
      const sharedTrack = screenStreamRef.current.getVideoTracks()[0];
      if (sharedTrack) {
        const sender = peer.getSenders().find((item) => item.track && item.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(sharedTrack);
        }
      }
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', {
          targetId: peerId,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    peer.ontrack = (event) => {
      const [streamFromEvent] = event.streams || [];
      let stream = streamFromEvent;

      if (!stream) {
        stream = remoteStreamsRef.current[peerId] || new MediaStream();
        if (event.track && !stream.getTracks().some((item) => item.id === event.track.id)) {
          stream.addTrack(event.track);
        }
      }

      remoteStreamsRef.current[peerId] = stream;

      setRemoteStreams((prev) => ({
        ...prev,
        [peerId]: stream
      }));
    };

    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        if (peer.connectionState === 'failed') {
          setStatus('音视频连接失败，可能是网络中继不可用，请检查 TURN 配置');
        }
        removePeer(peerId);
      }
    };

    peerConnectionsRef.current[peerId] = peer;
    return peer;
  };

  const createOfferToPeer = async (peerId) => {
    const socket = socketRef.current;
    const peer = await createPeerConnection(peerId);

    if (!socket || !peer || makingOfferRef.current[peerId]) {
      return;
    }

    if (peer.signalingState !== 'stable') {
      return;
    }

    makingOfferRef.current[peerId] = true;
    try {
      const offer = await peer.createOffer();
      if (peer.signalingState !== 'stable') {
        return;
      }

      await peer.setLocalDescription(offer);

      socket.emit('signal', {
        targetId: peerId,
        signal: { type: 'offer', sdp: offer.sdp }
      });
    } catch (error) {
      console.error('Create offer failed:', error);
    } finally {
      makingOfferRef.current[peerId] = false;
    }
  };

  const renegotiateAllPeers = async () => {
    const peerIds = Object.keys(peerConnectionsRef.current);
    for (const peerId of peerIds) {
      try {
        const peer = peerConnectionsRef.current[peerId];
        if (peer) {
          // 确保连接状态稳定
          if (peer.signalingState !== 'stable') {
            // 等待状态稳定
            await new Promise(resolve => {
              const checkState = () => {
                if (peer.signalingState === 'stable') {
                  resolve();
                } else {
                  setTimeout(checkState, 100);
                }
              };
              checkState();
            });
          }
          await createOfferToPeer(peerId);
        }
      } catch (error) {
        console.error('Renegotiate peer failed:', error);
      }
    }
  };

  const replaceOutgoingVideoTrack = async (nextVideoTrack) => {
    const peers = Object.values(peerConnectionsRef.current);
    for (const peer of peers) {
      const sender = peer.getSenders().find((item) => item.track && item.track.kind === 'video');
      if (!sender) {
        continue;
      }
      try {
        await sender.replaceTrack(nextVideoTrack || null);
      } catch (error) {
        console.error('Replace outgoing video track failed:', error);
      }
    }
  };

  const handleSignal = async (peerId, signal) => {
    const socket = socketRef.current;
    const peer = await createPeerConnection(peerId);

    if (signal.type === 'offer') {
      try {
        if (peer.signalingState !== 'stable') {
          await peer.setLocalDescription({ type: 'rollback' });
        }
      } catch (error) {
        console.error('Rollback signaling state failed:', error);
      }

      await peer.setRemoteDescription(
        new RTCSessionDescription({ type: 'offer', sdp: signal.sdp })
      );
      const queuedCandidates = pendingCandidatesRef.current[peerId] || [];
      for (const candidate of queuedCandidates) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Queued ICE candidate error:', error);
        }
      }
      delete pendingCandidatesRef.current[peerId];
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('signal', {
        targetId: peerId,
        signal: { type: 'answer', sdp: answer.sdp }
      });
      return;
    }

    if (signal.type === 'answer') {
      if (peer.signalingState === 'stable') {
        return;
      }
      await peer.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
      );
      const queuedCandidates = pendingCandidatesRef.current[peerId] || [];
      for (const candidate of queuedCandidates) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Queued ICE candidate error:', error);
        }
      }
      delete pendingCandidatesRef.current[peerId];
      return;
    }

    if (signal.type === 'candidate' && signal.candidate) {
      if (!peer.remoteDescription || !peer.remoteDescription.type) {
        if (!pendingCandidatesRef.current[peerId]) {
          pendingCandidatesRef.current[peerId] = [];
        }
        pendingCandidatesRef.current[peerId].push(signal.candidate);
        return;
      }
      try {
        await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (error) {
        console.error('ICE candidate error:', error);
      }
    }
  };

  const joinRoom = async (roomIdValue) => {
    const roomId = String(roomIdValue || '').trim();
    if (!roomId) {
      setStatus('请先输入房间号');
      return;
    }

    try {
      await loadRtcConfig();
      await getLocalStream();
      const socket = getOrCreateSocket();
      setTranscriptLines([]);
      setLiveInterimText('');
      setMeetingSummary(null);
      setSummaryError('');
      setTaskSyncMessage('');
      setGeneratedTasks([]);
      setShowGeneratedTasks(false);
      setActiveRoomId(roomId);
      setStatus(`正在加入房间 ${roomId}...`);
      socket.emit('join-room', { roomId });
      startSpeechRecognition();
    } catch (error) {
      console.error(error);
      setStatus('无法开启摄像头/麦克风，请检查浏览器权限');
    }
  };

  const removePeer = (peerId) => {
    const peer = peerConnectionsRef.current[peerId];
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.close();
      delete peerConnectionsRef.current[peerId];
    }

    setRemoteStreams((prev) => {
      const updated = { ...prev };
      delete updated[peerId];
      return updated;
    });
    if (remoteStreamsRef.current[peerId]) {
      delete remoteStreamsRef.current[peerId];
    }

    if (pendingCandidatesRef.current[peerId]) {
      delete pendingCandidatesRef.current[peerId];
    }
    if (makingOfferRef.current[peerId]) {
      delete makingOfferRef.current[peerId];
    }
  };

  const leaveRoom = () => {
    stopSpeechRecognition();
    stopScreenSharing();

    if (socketRef.current && activeRoomId) {
      socketRef.current.emit('leave-room', { roomId: activeRoomId });
    }

    Object.keys(peerConnectionsRef.current).forEach((peerId) => {
      removePeer(peerId);
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setRemoteStreams({});
    remoteStreamsRef.current = {};
    setMeetingMembers([]);
    setRoomHostSocketId('');
    setActiveRoomId('');
    setStatus('已离开房间');
    setIsCameraOn(true);
    setIsMicOn(true);
    setIsScreenSharing(false);
  };

  useEffect(() => {
    const autoRoomId = String(location.state?.autoJoinRoomId || '').trim();
    if (!autoRoomId || autoJoinOnceRef.current || activeRoomId) {
      return;
    }

    autoJoinOnceRef.current = true;
    setRoomInput(autoRoomId);
    joinRoom(autoRoomId);

    if (location.state?.controlRole === 'controller') {
      setStatus(`远程操控请求已发出，正在房间 ${autoRoomId} 等待对方同意`);
    }
    if (location.state?.controlRole === 'target') {
      setStatus(`你已同意远程操控请求，正在进入房间 ${autoRoomId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, activeRoomId]);

  const generateMeetingSummary = async () => {
    if (transcriptLines.length === 0 && !liveInterimText.trim()) {
      setSummaryError('暂无可总结的会议内容，请先开始会议对话。');
      return;
    }

    setSummaryLoading(true);
    setSummaryError('');

    try {
      const transcriptText = [...transcriptLines, liveInterimText.trim()].filter(Boolean).join('\n');
      const response = await axios.post('/assistant/meeting-summary', {
        room_id: activeRoomId,
        transcript: transcriptText
      });
      const summaryData = {
        ...(response.data || {}),
        action_items: normalizeActionItems(response?.data?.action_items, response?.data?.summary),
        key_points: Array.isArray(response?.data?.key_points)
          ? response.data.key_points
          : (response?.data?.key_points ? [String(response.data.key_points)] : []),
      };
      setMeetingSummary(summaryData);

      if (shouldGenerateTeamTasks && (summaryData?.action_items || []).length > 0) {
        await syncActionItemsToTasks(summaryData.action_items);
      }

      return summaryData;
    } catch (error) {
      console.error('Generate summary failed:', error);
      setSummaryError(error?.response?.data?.error || '会议摘要生成失败，请稍后重试。');
      return null;
    } finally {
      setSummaryLoading(false);
    }
  };

  const endMeetingAndSummarize = async () => {
    stopSpeechRecognition();
    await generateMeetingSummary();
  };

  const syncActionItemsToTasks = async (overrideItems = null) => {
    const items = normalizeActionItems(
      overrideItems || meetingSummary?.action_items || [],
      meetingSummary?.summary || ''
    );
    if (items.length === 0) {
      setTaskSyncMessage('暂无可同步的行动项。');
      return;
    }

    setTaskSyncLoading(true);
    setTaskSyncMessage('');

    try {
      const memberIds = meetingMembers
        .map((m) => Number(m.userId))
        .filter((id) => Number.isInteger(id) && id > 0);

      try {
        const response = await axios.post('/assistant/meeting-tasks', {
          room_id: activeRoomId,
          action_items: items,
          member_user_ids: memberIds,
        });

        const createdTasks = response?.data?.tasks || [];
        setGeneratedTasks(createdTasks);
        setShowGeneratedTasks(true);
        setTaskSyncMessage(`已同步 ${createdTasks.length} 条行动项到任务中心。`);
      } catch (apiError) {
        // 兜底：若聚合接口失败，回退到逐条创建，保证用户操作可达成
        const fallbackRequests = items.map((item, idx) => {
          const title = String(item?.task || '').trim() || `会议行动项 ${idx + 1}`;
          const owner = String(item?.owner || '').trim() || '待确认';
          const deadline = String(item?.deadline || '').trim();
          const parsedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '';
          const assigneeId = memberIds.length > 0 ? memberIds[idx % memberIds.length] : '';

          return axios.post('/tasks', {
            title,
            description: `来源：会议摘要${activeRoomId ? `（房间 ${activeRoomId}）` : ''}\n建议负责人：${owner}\n原始截止：${deadline || '待定'}`,
            priority: 'medium',
            due_date: parsedDueDate,
            assignee_id: assigneeId || null,
          });
        });

        const results = await Promise.allSettled(fallbackRequests);
        const successTasks = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => r.value?.data)
          .filter(Boolean);

        const failCount = results.length - successTasks.length;
        if (successTasks.length > 0) {
          setGeneratedTasks(successTasks);
          setShowGeneratedTasks(true);
        }

        const backendMessage = apiError?.response?.data?.error || apiError?.message || '未知错误';
        setTaskSyncMessage(
          failCount === 0
            ? `已同步 ${successTasks.length} 条行动项到任务中心（已自动走兼容模式）。`
            : `部分同步成功：成功 ${successTasks.length} 条，失败 ${failCount} 条。后端信息：${backendMessage}`
        );
      }
    } catch (error) {
      console.error('Sync tasks failed:', error);
      setTaskSyncMessage(error?.response?.data?.error || '同步任务失败，请稍后重试。');
    } finally {
      setTaskSyncLoading(false);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const startScreenSharing = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always'
        },
        audio: false
      });
      
      screenStreamRef.current = screenStream;
      isScreenSharingRef.current = true;
      setScreenStream(screenStream);
      setIsScreenSharing(true);
      
      if (localStreamRef.current) {
        const videoTrack = screenStream.getVideoTracks()[0];
        await replaceOutgoingVideoTrack(videoTrack);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        // 确保所有连接都重新协商
        await renegotiateAllPeers();
      }
      
      // 监听屏幕共享结束
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };
    } catch (error) {
      console.error('Error starting screen sharing:', error);
      setStatus('屏幕共享失败，请检查浏览器权限');
    }
  };

  const stopScreenSharing = async () => {
    const activeScreenStream = screenStreamRef.current || screenStream;
    if (activeScreenStream) {
      activeScreenStream.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      isScreenSharingRef.current = false;
      setScreenStream(null);
      setIsScreenSharing(false);
      
      if (localStreamRef.current) {
        const localVideoTrack = localStreamRef.current.getVideoTracks()[0];
        await replaceOutgoingVideoTrack(localVideoTrack || null);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }

        await renegotiateAllPeers();
      }
    }
  };

  return (
    <div className="meeting-container">
      <header className="meeting-header">
        <h2>会议室</h2>
        <div className="meeting-user">当前用户：{user?.name || user?.username}</div>
      </header>

      <div className="meeting-actions">
        <button className="meeting-btn" onClick={createRoomId}>创建房间号</button>
        <input
          className="meeting-input"
          type="text"
          placeholder="输入房间号"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
        />
        <button className="meeting-btn" onClick={() => joinRoom(roomInput)}>加入房间</button>
        <button className="meeting-btn secondary" onClick={leaveRoom}>离开房间</button>
        <button className="meeting-btn secondary" onClick={() => navigate('/')}>返回首页</button>
      </div>

      <div className="media-controls">
        <button
          className={`media-btn ${isCameraOn ? 'active' : 'inactive'}`}
          onClick={toggleCamera}
          title={isCameraOn ? '关闭摄像头' : '打开摄像头'}
        >
          {isCameraOn ? '📹' : '🚫📹'}
          <span>{isCameraOn ? '摄像头开启' : '摄像头关闭'}</span>
        </button>
        <button
          className={`media-btn ${isMicOn ? 'active' : 'inactive'}`}
          onClick={toggleMic}
          title={isMicOn ? '关闭麦克风' : '打开麦克风'}
        >
          {isMicOn ? '🎤' : '🚫🎤'}
          <span>{isMicOn ? '麦克风开启' : '麦克风关闭'}</span>
        </button>

        <button
          className={`media-btn ${isScreenSharing ? 'active' : 'inactive'}`}
          onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
          title={isScreenSharing ? '停止屏幕共享' : '开始屏幕共享'}
        >
          {isScreenSharing ? '🖥️' : '📱'}
          <span>{isScreenSharing ? '屏幕共享中' : '开始屏幕共享'}</span>
        </button>

        <button
          className={`media-btn ${isRecognizing ? 'active' : 'inactive'}`}
          onClick={isRecognizing ? stopSpeechRecognition : startSpeechRecognition}
          title={isRecognizing ? '暂停语音识别' : '开始语音识别'}
          disabled={!recognitionSupported}
        >
          {isRecognizing ? '📝' : '▶️📝'}
          <span>
            {!recognitionSupported
              ? '浏览器不支持语音识别'
              : isRecognizing
                ? '语音识别中'
                : '开始语音识别'}
          </span>
        </button>

        <button
          className="media-btn active"
          onClick={endMeetingAndSummarize}
          disabled={summaryLoading}
          title="结束会议并生成摘要"
        >
          {summaryLoading ? '⏳' : '✅'}
          <span>{summaryLoading ? '生成摘要中...' : '结束会议并生成摘要'}</span>
        </button>

        <label className="summary-task-toggle">
          <input
            type="checkbox"
            checked={shouldGenerateTeamTasks}
            onChange={(e) => setShouldGenerateTeamTasks(e.target.checked)}
          />
          <span>生成摘要时自动创建团队任务</span>
        </label>
      </div>

      <div className="meeting-status">
        状态：{status}
        {activeRoomId ? ` | 当前房间：${activeRoomId}` : ''}
        {controlRole === 'controller' ? ` | 你正在向${controlPeerName}发起远程协助，请引导对方开启屏幕共享。` : ''}
        {controlRole === 'target' ? ` | 你已授权${controlPeerName}远程协助，请按需开启屏幕共享。` : ''}
      </div>

      <div className="video-grid">
        <div className="video-card">
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="video-label">我（本地）{roomHostSocketId && socketRef.current?.id === roomHostSocketId ? '｜房主' : '｜成员'}</div>
        </div>

        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <RemoteVideo
            key={peerId}
            stream={stream}
            label={`${meetingMembers.find((m) => m.socketId === peerId)?.role === 'host' ? '房主' : '成员'} ${peerId.slice(0, 6)}`}
          />
        ))}
      </div>

      <section className="meeting-ai-panel">
        <h3>实时会议记录</h3>
        <p className="meeting-members-tip">
          会议成员：{meetingMembers.length > 0
            ? meetingMembers.map((m) => `${m.role === 'host' ? '房主' : '成员'} ${m.name}`).join('、')
            : currentUserName}
        </p>
        <div className="transcript-box">
          {transcriptLines.length === 0 && !liveInterimText ? (
            <p className="placeholder">识别结果会实时显示在这里...</p>
          ) : (
            <>
              {transcriptLines.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
              {liveInterimText ? <p className="interim-line">{currentUserName}: {liveInterimText}</p> : null}
            </>
          )}
        </div>

        <h3>会议摘要</h3>
        {summaryError ? <p className="summary-error">{summaryError}</p> : null}

        {meetingSummary ? (
          <div className="summary-box">
            <p><strong>摘要：</strong>{meetingSummary.summary}</p>
            <p><strong>摘要来源：</strong>{meetingSummary.provider === 'llm' ? 'AI 模型' : '本地智能规则'}</p>

            <p><strong>关键要点：</strong></p>
            <ul>
              {(meetingSummary.key_points || []).map((point, idx) => (
                <li key={`${point}-${idx}`}>{point}</li>
              ))}
            </ul>

            <p><strong>行动项：</strong></p>
            <ul>
              {(meetingSummary.action_items || []).map((item, idx) => (
                <li key={`${item.task || ''}-${idx}`}>
                  {(item.owner || '待确认')} - {(item.task || '待补充')}（截止：{item.deadline || '待定'}）
                </li>
              ))}
            </ul>

            <div className="summary-actions">
              <button
                className="meeting-btn"
                onClick={syncActionItemsToTasks}
                disabled={taskSyncLoading}
              >
                {taskSyncLoading ? '同步中...' : '将行动项同步到任务中心'}
              </button>
              <button
                className="meeting-btn secondary"
                onClick={() => setShowGeneratedTasks((prev) => !prev)}
                disabled={generatedTasks.length === 0}
              >
                {showGeneratedTasks ? '隐藏摘要任务' : '任务按钮：查看摘要任务'}
              </button>
              {taskSyncMessage ? <p className="summary-sync-msg">{taskSyncMessage}</p> : null}

              {showGeneratedTasks && generatedTasks.length > 0 ? (
                <div className="generated-task-list">
                  {generatedTasks.map((task) => (
                    <article key={task.id} className="generated-task-item">
                      <p><strong>{task.title}</strong></p>
                      <p>负责人：{task.assignee?.name || task.assignee?.username || '未分配'}</p>
                      <p>截止：{task.due_date || '未设置'}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="placeholder">点击“结束会议并生成摘要”后会展示结果。</p>
        )}
      </section>
    </div>
  );
};

export default MeetingRoom;
