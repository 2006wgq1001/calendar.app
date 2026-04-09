import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from './axiosConfig';
import './MeetingRoom.css';

const stripApiSuffix = (value) => value.replace(/\/api\/?$/i, '');

const resolveSignalUrl = () => {
  const explicitSignalUrl = (process.env.REACT_APP_SIGNAL_URL || '').trim();
  if (explicitSignalUrl) {
    // 鏀寔浼犲叆鐩稿璺緞锛屽 "/" 鎴?"/signal"銆?    if (explicitSignalUrl.startsWith('/')) {
      return `${window.location.origin}${explicitSignalUrl}`;
    }
    return explicitSignalUrl;
  }

  // 鍓嶅悗绔垎绂婚儴缃叉椂锛屼紭鍏堜粠 API 鍦板潃鎺ㄥ淇′护鍦板潃锛岄伩鍏嶉粯璁よ繛鍒板墠绔潤鎬佸煙鍚嶃€?  const envApiBase = (process.env.REACT_APP_API_BASE_URL || '').trim();
  if (envApiBase) {
    if (envApiBase.startsWith('http://') || envApiBase.startsWith('https://')) {
      try {
        const apiUrl = new URL(envApiBase);
        const pathname = stripApiSuffix(apiUrl.pathname || '/');
        const cleanedPath = pathname === '/' ? '' : pathname.replace(/\/$/, '');
        return `${apiUrl.origin}${cleanedPath}`;
      } catch (error) {
        // Ignore invalid URL and continue fallback.
      }
    }

    if (envApiBase.startsWith('/')) {
      const normalized = stripApiSuffix(envApiBase).replace(/\/$/, '');
      return `${window.location.origin}${normalized || ''}`;
    }
  }

  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return (stripApiSuffix(process.env.REACT_APP_API_BASE_URL || '') || 'http://localhost:5000');
  }

  // 鍏綉 HTTPS 榛樿璧板悓婧愪俊浠わ紝閬垮厤璺ㄥ煙鍜岃瘉涔﹂棶棰樸€?  return window.location.origin;
};

const defaultPublicSignalUrl = (process.env.REACT_APP_DEFAULT_PUBLIC_SIGNAL_URL || 'https://calendarapp-production-d085.up.railway.app').trim();

const resolveSignalUrlWithFallback = () => {
  const resolved = resolveSignalUrl();
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const isRailwayHost = window.location.hostname.endsWith('railway.app');

  if (isLocal || isRailwayHost) {
    return resolved;
  }

  // 鍦ㄧ函闈欐€佺珯鐐癸紙濡?vercel锛変笖鏈樉寮忛厤缃俊浠ゅ湴鍧€鏃讹紝鍥為€€鍒板彲鍏綉璁块棶鐨勫悗绔煙鍚嶃€?  const explicitSignalUrl = (process.env.REACT_APP_SIGNAL_URL || '').trim();
  if (!explicitSignalUrl && defaultPublicSignalUrl) {
    return defaultPublicSignalUrl;
  }

  return resolved;
};

const SIGNAL_URL = resolveSignalUrlWithFallback();
const SOCKET_IO_PATH = (process.env.REACT_APP_SOCKET_PATH || '/socket.io').trim() || '/socket.io';
const DEFAULT_ICE_TRANSPORT_POLICY = ((process.env.REACT_APP_ICE_TRANSPORT_POLICY || 'relay').trim().toLowerCase() === 'all')
  ? 'all'
  : 'relay';

const DEFAULT_RTC_ICE_SERVERS = (() => {
  const stunDefaults = [
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const turnUrl = (process.env.REACT_APP_TURN_URL || '').trim();
  const turnUsername = (process.env.REACT_APP_TURN_USERNAME || '').trim();
  const turnCredential = (process.env.REACT_APP_TURN_CREDENTIAL || '').trim();

  const fallbackTurnServers = [
    {
      urls: 'turn:stun.stunprotocol.org:3478',
      username: '',
      credential: '',
    },
    {
      urls: 'turn:stun1.stunprotocol.org:3478',
      username: '',
      credential: '',
    },
    {
      urls: 'turn:numb.viagenie.ca:3478?transport=udp',
      username: 'webrtc@mozilla.org',
      credential: 'webrtc',
    },
    {
      urls: 'turn:numb.viagenie.ca:5349?transport=tcp',
      username: 'webrtc@mozilla.org',
      credential: 'webrtc',
    },
    {
      urls: 'turns:numb.viagenie.ca:5349?transport=tcp',
      username: 'webrtc@mozilla.org',
      credential: 'webrtc',
    },
  ];

  const customTurnServers = [];
  if (turnUrl) {
    customTurnServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

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
          // 鏌愪簺娴忚鍣ㄤ細鎷︽埅鑷姩鎾斁锛岀瓑寰呯敤鎴蜂氦浜掑悗浼氭仮澶嶃€?        });
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
  const [status, setStatus] = useState('鏈姞鍏ユ埧闂?);
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
  const rtcIceTransportPolicyRef = useRef(DEFAULT_ICE_TRANSPORT_POLICY);
  const remoteStreamsRef = useRef({});
  const disconnectTimerRef = useRef({});
  const hostSocketIdRef = useRef('');
  const activeRoomIdRef = useRef('');
  const joinedRoomIdRef = useRef('');
  const controlRole = location.state?.controlRole || '';
  const controlPeerName = location.state?.controlPeerName || '瀵规柟';

  const currentUserName = user?.name || user?.username || '鎴?;

  const normalizeMember = (member) => ({
    socketId: member?.socketId || '',
    userId: member?.userId || null,
    name: member?.name || `鎴愬憳 ${(member?.socketId || '').slice(0, 6)}`,
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
    const hostId = hostSocketIdRef.current || roomHostSocketId;
    return Boolean(selfId && peerId && hostId && selfId === hostId);
  };

  const resetPeerState = () => {
    Object.keys(peerConnectionsRef.current).forEach((peerId) => {
      const peer = peerConnectionsRef.current[peerId];
      if (peer) {
        peer.onicecandidate = null;
        peer.ontrack = null;
        peer.close();
      }
    });

    peerConnectionsRef.current = {};
    makingOfferRef.current = {};
    pendingCandidatesRef.current = {};
    remoteStreamsRef.current = {};
    Object.keys(disconnectTimerRef.current).forEach((peerId) => {
      clearTimeout(disconnectTimerRef.current[peerId]);
    });
    disconnectTimerRef.current = {};
    setRemoteStreams({});
  };

  const normalizeActionItems = (rawItems, fallbackSummary = '') => {
    let items = rawItems;
    if (Array.isArray(items)) {
      // use as-is
    } else if (items && typeof items === 'object') {
      items = [items];
    } else if (typeof items === 'string' && items.trim()) {
      items = [{ task: items.trim(), owner: '寰呯‘璁?, deadline: '寰呭畾' }];
    } else {
      items = [];
    }

    const normalized = items
      .map((item, idx) => {
        if (typeof item === 'string') {
          return { task: item.trim(), owner: '寰呯‘璁?, deadline: '寰呭畾' };
        }
        if (!item || typeof item !== 'object') {
          return null;
        }

        const task = String(item.task || item.title || '').trim() || `浼氳琛屽姩椤?${idx + 1}`;
        const owner = String(item.owner || item.assignee || '').trim() || '寰呯‘璁?;
        const deadline = String(item.deadline || item.due_date || '').trim() || '寰呭畾';
        return { task, owner, deadline };
      })
      .filter(Boolean)
      .filter((item) => item.task);

    if (normalized.length === 0 && fallbackSummary) {
      normalized.push({
        task: `鏍规嵁浼氳鎽樿璺熻繘锛?{String(fallbackSummary).slice(0, 60)}`,
        owner: '寰呯‘璁?,
        deadline: '寰呭畾',
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
        setStatus('璇煶璇嗗埆鏉冮檺琚嫆缁濓紝璇峰湪娴忚鍣ㄤ腑鍏佽楹﹀厠椋庢潈闄?);
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
      setStatus('褰撳墠娴忚鍣ㄤ笉鏀寔璇煶璇嗗埆锛岃浣跨敤鏈€鏂扮増 Chrome/Edge');
      return;
    }

    if (isRecognizing) {
      return;
    }

    shouldKeepRecognizingRef.current = true;
    try {
      recognitionRef.current.start();
      setIsRecognizing(true);
      setStatus('璇煶璇嗗埆杩涜涓?);
    } catch (error) {
      console.error('Start speech recognition failed:', error);
      setStatus('璇煶璇嗗埆鍚姩澶辫触锛岃绋嶅悗閲嶈瘯');
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
        // 淇′护閫氶亾涓嶄緷璧?Cookie锛屽叧闂嚟鎹彲鍑忓皯璺ㄥ煙涓?SameSite 闄愬埗闂銆?        withCredentials: false,
        // 鍏堣蛋 polling锛岀‘淇濆湪绂佺敤 websocket 鐨勭綉缁滈噷涔熻兘寤虹珛淇′护銆?        transports: ['polling', 'websocket'],
        path: SOCKET_IO_PATH,
        upgrade: true,
        tryAllTransports: true,
        rememberUpgrade: true,
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 800,
        timeout: 15000,
      });

      socketRef.current.on('connect', () => {
        setStatus('宸茶繛鎺ヤ細璁湇鍔★紝绛夊緟鍔犲叆鎴块棿');

        const roomIdToRestore = activeRoomIdRef.current;
        if (roomIdToRestore && joinedRoomIdRef.current !== roomIdToRestore) {
          resetPeerState();
          joinedRoomIdRef.current = roomIdToRestore;
          socketRef.current.emit('join-room', { roomId: roomIdToRestore });
        }
      });

      socketRef.current.on('connect_error', () => {
        setStatus('杩炴帴浼氳鏈嶅姟澶辫触锛岃纭鍚庣宸插惎鍔?);
      });

      socketRef.current.on('disconnect', () => {
        setStatus('浼氳鏈嶅姟杩炴帴宸叉柇寮€锛屾鍦ㄥ皾璇曢噸杩?);
        joinedRoomIdRef.current = '';
      });

      socketRef.current.on('room-error', (payload) => {
        setStatus(payload?.message || '鍔犲叆鎴块棿澶辫触');
      });

      socketRef.current.on('room-users', async ({ roomId, users, hostSocketId }) => {
        setStatus(`宸插姞鍏ユ埧闂?${roomId}`);
        hostSocketIdRef.current = hostSocketId || '';
        setRoomHostSocketId(hostSocketId || '');
        joinedRoomIdRef.current = roomId;
        const selfMember = {
          socketId: socketRef.current?.id || '',
          userId: user?.id || null,
          name: currentUserName,
          role: hostSocketId && hostSocketId === socketRef.current?.id ? 'host' : 'member',
        };
        const roomUsers = Array.isArray(users) ? users : [];
        setMeetingMembers((prev) => mergeMembers(prev, [...roomUsers, selfMember]));
        for (const item of roomUsers) {
          if (shouldInitiatePeer(item.socketId)) {
            await createOfferToPeer(item.socketId);
          }
        }
      });

      socketRef.current.on('user-joined', async ({ socketId, userId, name }) => {
        setStatus('鏈夋柊鎴愬憳鍔犲叆鎴块棿');
        setMeetingMembers((prev) => mergeMembers(prev, [{ socketId, userId, name, role: 'member' }]));
        if (shouldInitiatePeer(socketId)) {
          await createOfferToPeer(socketId);
        }
      });

      socketRef.current.on('room-role-updated', ({ hostSocketId }) => {
        hostSocketIdRef.current = hostSocketId || '';
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
        setStatus('鏈夋垚鍛樼寮€鎴块棿');
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
          const nextIceTransportPolicy = String(response?.data?.iceTransportPolicy || '').trim().toLowerCase() === 'relay'
            ? 'relay'
            : DEFAULT_ICE_TRANSPORT_POLICY;
          rtcIceServersRef.current = nextIceServers;
          rtcIceTransportPolicyRef.current = nextIceTransportPolicy;
          rtcConfigLoadedRef.current = true;
          return nextIceServers;
        })
        .catch((error) => {
          console.error('Load WebRTC config failed:', error);
          rtcConfigLoadedRef.current = true;
          rtcIceServersRef.current = DEFAULT_RTC_ICE_SERVERS;
          rtcIceTransportPolicyRef.current = DEFAULT_ICE_TRANSPORT_POLICY;
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
      iceTransportPolicy: rtcIceTransportPolicyRef.current,
    });

    // 娣诲姞鎵€鏈夎建閬?    localStream.getTracks().forEach((track) => {
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
      if (peer.connectionState === 'connected') {
        if (disconnectTimerRef.current[peerId]) {
          clearTimeout(disconnectTimerRef.current[peerId]);
          delete disconnectTimerRef.current[peerId];
        }
        return;
      }

      if (peer.connectionState === 'disconnected') {
        // disconnected 鍦ㄥ叕缃戠幆澧冧笅鍙兘鏄煭鏆傛姈鍔紝寤惰繜纭鍚庡啀娓呯悊銆?        if (!disconnectTimerRef.current[peerId]) {
          disconnectTimerRef.current[peerId] = setTimeout(() => {
            const currentPeer = peerConnectionsRef.current[peerId];
            if (!currentPeer) return;
            if (currentPeer.connectionState === 'disconnected') {
              setStatus('鎴愬憳缃戠粶娉㈠姩锛屾鍦ㄥ皾璇曟仮澶嶈繛鎺?);
            }
            delete disconnectTimerRef.current[peerId];
          }, 8000);
        }
        return;
      }

      if (['failed', 'closed'].includes(peer.connectionState)) {
        if (disconnectTimerRef.current[peerId]) {
          clearTimeout(disconnectTimerRef.current[peerId]);
          delete disconnectTimerRef.current[peerId];
        }
        if (peer.connectionState === 'failed') {
          setStatus('闊宠棰戣繛鎺ュけ璐ワ紝鍙兘鏄綉缁滀腑缁т笉鍙敤锛岃妫€鏌?TURN 閰嶇疆');
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
          // 纭繚杩炴帴鐘舵€佺ǔ瀹?          if (peer.signalingState !== 'stable') {
            // 绛夊緟鐘舵€佺ǔ瀹?            await new Promise(resolve => {
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
      setStatus('璇峰厛杈撳叆鎴块棿鍙?);
      return;
    }

    try {
      await loadRtcConfig();
      await getLocalStream();
      activeRoomIdRef.current = roomId;
      joinedRoomIdRef.current = roomId;
      const socket = getOrCreateSocket();
      setTranscriptLines([]);
      setLiveInterimText('');
      setMeetingSummary(null);
      setSummaryError('');
      setTaskSyncMessage('');
      setGeneratedTasks([]);
      setShowGeneratedTasks(false);
      setActiveRoomId(roomId);
      setStatus(`姝ｅ湪鍔犲叆鎴块棿 ${roomId}...`);
      socket.emit('join-room', { roomId });
      startSpeechRecognition();
    } catch (error) {
      console.error(error);
      setStatus('鏃犳硶寮€鍚憚鍍忓ご/楹﹀厠椋庯紝璇锋鏌ユ祻瑙堝櫒鏉冮檺');
    }
  };

  const removePeer = (peerId) => {
    if (disconnectTimerRef.current[peerId]) {
      clearTimeout(disconnectTimerRef.current[peerId]);
      delete disconnectTimerRef.current[peerId];
    }

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
    activeRoomIdRef.current = '';
    joinedRoomIdRef.current = '';

    if (socketRef.current && activeRoomId) {
      socketRef.current.emit('leave-room', { roomId: activeRoomId });
    }

    resetPeerState();

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
    Object.keys(disconnectTimerRef.current).forEach((peerId) => {
      clearTimeout(disconnectTimerRef.current[peerId]);
    });
    disconnectTimerRef.current = {};
    setMeetingMembers([]);
    hostSocketIdRef.current = '';
    setRoomHostSocketId('');
    setActiveRoomId('');
    setStatus('宸茬寮€鎴块棿');
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
      setStatus(`杩滅▼鎿嶆帶璇锋眰宸插彂鍑猴紝姝ｅ湪鎴块棿 ${autoRoomId} 绛夊緟瀵规柟鍚屾剰`);
    }
    if (location.state?.controlRole === 'target') {
      setStatus(`浣犲凡鍚屾剰杩滅▼鎿嶆帶璇锋眰锛屾鍦ㄨ繘鍏ユ埧闂?${autoRoomId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, activeRoomId]);

  const generateMeetingSummary = async () => {
    if (transcriptLines.length === 0 && !liveInterimText.trim()) {
      setSummaryError('鏆傛棤鍙€荤粨鐨勪細璁唴瀹癸紝璇峰厛寮€濮嬩細璁璇濄€?);
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
      setSummaryError(error?.response?.data?.error || '浼氳鎽樿鐢熸垚澶辫触锛岃绋嶅悗閲嶈瘯銆?);
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
      setTaskSyncMessage('鏆傛棤鍙悓姝ョ殑琛屽姩椤广€?);
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
        setTaskSyncMessage(`宸插悓姝?${createdTasks.length} 鏉¤鍔ㄩ」鍒颁换鍔′腑蹇冦€俙);
      } catch (apiError) {
        // 鍏滃簳锛氳嫢鑱氬悎鎺ュ彛澶辫触锛屽洖閫€鍒伴€愭潯鍒涘缓锛屼繚璇佺敤鎴锋搷浣滃彲杈炬垚
        const fallbackRequests = items.map((item, idx) => {
          const title = String(item?.task || '').trim() || `浼氳琛屽姩椤?${idx + 1}`;
          const owner = String(item?.owner || '').trim() || '寰呯‘璁?;
          const deadline = String(item?.deadline || '').trim();
          const parsedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '';
          const assigneeId = memberIds.length > 0 ? memberIds[idx % memberIds.length] : '';

          return axios.post('/tasks', {
            title,
            description: `鏉ユ簮锛氫細璁憳瑕?{activeRoomId ? `锛堟埧闂?${activeRoomId}锛塦 : ''}\n寤鸿璐熻矗浜猴細${owner}\n鍘熷鎴锛?{deadline || '寰呭畾'}`,
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

        const backendMessage = apiError?.response?.data?.error || apiError?.message || '鏈煡閿欒';
        setTaskSyncMessage(
          failCount === 0
            ? `宸插悓姝?${successTasks.length} 鏉¤鍔ㄩ」鍒颁换鍔′腑蹇冿紙宸茶嚜鍔ㄨ蛋鍏煎妯″紡锛夈€俙
            : `閮ㄥ垎鍚屾鎴愬姛锛氭垚鍔?${successTasks.length} 鏉★紝澶辫触 ${failCount} 鏉°€傚悗绔俊鎭細${backendMessage}`
        );
      }
    } catch (error) {
      console.error('Sync tasks failed:', error);
      setTaskSyncMessage(error?.response?.data?.error || '鍚屾浠诲姟澶辫触锛岃绋嶅悗閲嶈瘯銆?);
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

        // 纭繚鎵€鏈夎繛鎺ラ兘閲嶆柊鍗忓晢
        await renegotiateAllPeers();
      }
      
      // 鐩戝惉灞忓箷鍏变韩缁撴潫
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };
    } catch (error) {
      console.error('Error starting screen sharing:', error);
      setStatus('灞忓箷鍏变韩澶辫触锛岃妫€鏌ユ祻瑙堝櫒鏉冮檺');
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
        <h2>浼氳瀹?/h2>
        <div className="meeting-user">褰撳墠鐢ㄦ埛锛歿user?.name || user?.username}</div>
      </header>

      <div className="meeting-actions">
        <button className="meeting-btn" onClick={createRoomId}>鍒涘缓鎴块棿鍙?/button>
        <input
          className="meeting-input"
          type="text"
          placeholder="杈撳叆鎴块棿鍙?
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
        />
        <button className="meeting-btn" onClick={() => joinRoom(roomInput)}>鍔犲叆鎴块棿</button>
        <button className="meeting-btn secondary" onClick={leaveRoom}>绂诲紑鎴块棿</button>
        <button className="meeting-btn secondary" onClick={() => navigate('/')}>杩斿洖棣栭〉</button>
      </div>

      <div className="media-controls">
        <button
          className={`media-btn ${isCameraOn ? 'active' : 'inactive'}`}
          onClick={toggleCamera}
          title={isCameraOn ? '鍏抽棴鎽勫儚澶? : '鎵撳紑鎽勫儚澶?}
        >
          {isCameraOn ? '馃摴' : '馃毇馃摴'}
          <span>{isCameraOn ? '鎽勫儚澶村紑鍚? : '鎽勫儚澶村叧闂?}</span>
        </button>
        <button
          className={`media-btn ${isMicOn ? 'active' : 'inactive'}`}
          onClick={toggleMic}
          title={isMicOn ? '鍏抽棴楹﹀厠椋? : '鎵撳紑楹﹀厠椋?}
        >
          {isMicOn ? '馃帳' : '馃毇馃帳'}
          <span>{isMicOn ? '楹﹀厠椋庡紑鍚? : '楹﹀厠椋庡叧闂?}</span>
        </button>

        <button
          className={`media-btn ${isScreenSharing ? 'active' : 'inactive'}`}
          onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
          title={isScreenSharing ? '鍋滄灞忓箷鍏变韩' : '寮€濮嬪睆骞曞叡浜?}
        >
          {isScreenSharing ? '馃枼锔? : '馃摫'}
          <span>{isScreenSharing ? '灞忓箷鍏变韩涓? : '寮€濮嬪睆骞曞叡浜?}</span>
        </button>

        <button
          className={`media-btn ${isRecognizing ? 'active' : 'inactive'}`}
          onClick={isRecognizing ? stopSpeechRecognition : startSpeechRecognition}
          title={isRecognizing ? '鏆傚仠璇煶璇嗗埆' : '寮€濮嬭闊宠瘑鍒?}
          disabled={!recognitionSupported}
        >
          {isRecognizing ? '馃摑' : '鈻讹笍馃摑'}
          <span>
            {!recognitionSupported
              ? '娴忚鍣ㄤ笉鏀寔璇煶璇嗗埆'
              : isRecognizing
                ? '璇煶璇嗗埆涓?
                : '寮€濮嬭闊宠瘑鍒?}
          </span>
        </button>

        <button
          className="media-btn active"
          onClick={endMeetingAndSummarize}
          disabled={summaryLoading}
          title="缁撴潫浼氳骞剁敓鎴愭憳瑕?
        >
          {summaryLoading ? '鈴? : '鉁?}
          <span>{summaryLoading ? '鐢熸垚鎽樿涓?..' : '缁撴潫浼氳骞剁敓鎴愭憳瑕?}</span>
        </button>

        <label className="summary-task-toggle">
          <input
            type="checkbox"
            checked={shouldGenerateTeamTasks}
            onChange={(e) => setShouldGenerateTeamTasks(e.target.checked)}
          />
          <span>鐢熸垚鎽樿鏃惰嚜鍔ㄥ垱寤哄洟闃熶换鍔?/span>
        </label>
      </div>

      <div className="meeting-status">
        鐘舵€侊細{status}
        {activeRoomId ? ` | 褰撳墠鎴块棿锛?{activeRoomId}` : ''}
        {controlRole === 'controller' ? ` | 浣犳鍦ㄥ悜${controlPeerName}鍙戣捣杩滅▼鍗忓姪锛岃寮曞瀵规柟寮€鍚睆骞曞叡浜€俙 : ''}
        {controlRole === 'target' ? ` | 浣犲凡鎺堟潈${controlPeerName}杩滅▼鍗忓姪锛岃鎸夐渶寮€鍚睆骞曞叡浜€俙 : ''}
      </div>

      <div className="video-grid">
        <div className="video-card">
          <video ref={localVideoRef} autoPlay muted playsInline />
          <div className="video-label">鎴戯紙鏈湴锛墈roomHostSocketId && socketRef.current?.id === roomHostSocketId ? '锝滄埧涓? : '锝滄垚鍛?}</div>
        </div>

        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <RemoteVideo
            key={peerId}
            stream={stream}
            label={`${meetingMembers.find((m) => m.socketId === peerId)?.role === 'host' ? '鎴夸富' : '鎴愬憳'} ${peerId.slice(0, 6)}`}
          />
        ))}
      </div>

      <section className="meeting-ai-panel">
        <h3>瀹炴椂浼氳璁板綍</h3>
        <p className="meeting-members-tip">
          浼氳鎴愬憳锛歿meetingMembers.length > 0
            ? meetingMembers.map((m) => `${m.role === 'host' ? '鎴夸富' : '鎴愬憳'} ${m.name}`).join('銆?)
            : currentUserName}
        </p>
        <div className="transcript-box">
          {transcriptLines.length === 0 && !liveInterimText ? (
            <p className="placeholder">璇嗗埆缁撴灉浼氬疄鏃舵樉绀哄湪杩欓噷...</p>
          ) : (
            <>
              {transcriptLines.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
              {liveInterimText ? <p className="interim-line">{currentUserName}: {liveInterimText}</p> : null}
            </>
          )}
        </div>

        <h3>浼氳鎽樿</h3>
        {summaryError ? <p className="summary-error">{summaryError}</p> : null}

        {meetingSummary ? (
          <div className="summary-box">
            <p><strong>鎽樿锛?/strong>{meetingSummary.summary}</p>
            <p><strong>鎽樿鏉ユ簮锛?/strong>{meetingSummary.provider === 'llm' ? 'AI 妯″瀷' : '鏈湴鏅鸿兘瑙勫垯'}</p>

            <p><strong>鍏抽敭瑕佺偣锛?/strong></p>
            <ul>
              {(meetingSummary.key_points || []).map((point, idx) => (
                <li key={`${point}-${idx}`}>{point}</li>
              ))}
            </ul>

            <p><strong>琛屽姩椤癸細</strong></p>
            <ul>
              {(meetingSummary.action_items || []).map((item, idx) => (
                <li key={`${item.task || ''}-${idx}`}>
                  {(item.owner || '寰呯‘璁?)} - {(item.task || '寰呰ˉ鍏?)}锛堟埅姝細{item.deadline || '寰呭畾'}锛?                </li>
              ))}
            </ul>

            <div className="summary-actions">
              <button
                className="meeting-btn"
                onClick={syncActionItemsToTasks}
                disabled={taskSyncLoading}
              >
                {taskSyncLoading ? '鍚屾涓?..' : '灏嗚鍔ㄩ」鍚屾鍒颁换鍔′腑蹇?}
              </button>
              <button
                className="meeting-btn secondary"
                onClick={() => setShowGeneratedTasks((prev) => !prev)}
                disabled={generatedTasks.length === 0}
              >
                {showGeneratedTasks ? '闅愯棌鎽樿浠诲姟' : '浠诲姟鎸夐挳锛氭煡鐪嬫憳瑕佷换鍔?}
              </button>
              {taskSyncMessage ? <p className="summary-sync-msg">{taskSyncMessage}</p> : null}

              {showGeneratedTasks && generatedTasks.length > 0 ? (
                <div className="generated-task-list">
                  {generatedTasks.map((task) => (
                    <article key={task.id} className="generated-task-item">
                      <p><strong>{task.title}</strong></p>
                      <p>璐熻矗浜猴細{task.assignee?.name || task.assignee?.username || '鏈垎閰?}</p>
                      <p>鎴锛歿task.due_date || '鏈缃?}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="placeholder">鐐瑰嚮鈥滅粨鏉熶細璁苟鐢熸垚鎽樿鈥濆悗浼氬睍绀虹粨鏋溿€?/p>
        )}
      </section>
    </div>
  );
};

export default MeetingRoom;

