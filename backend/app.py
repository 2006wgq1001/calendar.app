from flask import Flask, request, jsonify, session, send_from_directory, redirect
from flask_cors import CORS
from flask_session import Session
from flask_socketio import SocketIO, emit, join_room as socket_join_room, leave_room as socket_leave_room
from models import db, Event, User, Team, TeamMember, Task, Contact, FriendRequest, RemoteControlRequest, Post, PostComment
from datetime import datetime
import sqlite3
import os 
import re
import json
from collections import Counter
from threading import Lock
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy import and_, or_

basedir = os.path.abspath(os.path.dirname(__file__))


def _split_env_csv(name, default_values):
    raw = (os.environ.get(name) or '').strip()
    if not raw:
        return default_values
    return [item.strip() for item in raw.split(',') if item.strip()]


IS_PRODUCTION = (
    (os.environ.get('APP_ENV') or '').lower() == 'production'
    or (os.environ.get('FLASK_ENV') or '').lower() == 'production'
    or (os.environ.get('RENDER') or '').lower() == 'true'
    or (os.environ.get('RAILWAY_ENVIRONMENT') or '').lower() == 'production'
    or bool(os.environ.get('RAILWAY_PROJECT_ID'))
)

DEFAULT_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://2006wgq1001.github.io',
    'https://calendar-app-tr8r.vercel.app',
    'https://calendar-app.vercel.app',
]

def _build_allowed_origins():
    configured = (os.environ.get('CORS_ORIGINS') or '').strip()
    if configured:
        return _split_env_csv('CORS_ORIGINS', DEFAULT_ORIGINS)

    origins = set(DEFAULT_ORIGINS)
    railway_domain = (os.environ.get('RAILWAY_PUBLIC_DOMAIN') or '').strip()
    railway_static_url = (os.environ.get('RAILWAY_STATIC_URL') or '').strip()
    frontend_url = (os.environ.get('FRONTEND_URL') or '').strip()
    vercel_url = (os.environ.get('VERCEL_URL') or '').strip()

    if railway_domain:
        origins.add(f'https://{railway_domain}')
        origins.add(f'http://{railway_domain}')
    if railway_static_url:
        origins.add(railway_static_url.rstrip('/'))
    if frontend_url:
        origins.add(frontend_url.rstrip('/'))
    if vercel_url:
        if vercel_url.startswith('http://') or vercel_url.startswith('https://'):
            origins.add(vercel_url.rstrip('/'))
        else:
            origins.add(f"https://{vercel_url.rstrip('/')}")

    # 鐢熶骇鐜閬垮厤浣跨敤 '*'锛屽惁鍒欎笌鍑嵁鍦烘櫙鍐茬獊銆?    return list(origins)


def _build_socket_cors_origins():
    configured = (os.environ.get('SOCKET_CORS_ORIGINS') or '').strip()
    if configured:
        return _split_env_csv('SOCKET_CORS_ORIGINS', ALLOWED_ORIGINS)

    # WebRTC 淇′护涓嶄緷璧?Cookie锛岄粯璁ゆ斁瀹藉埌 '*' 鍙伩鍏嶉瑙堝煙鍚嶆垨澶氬煙閮ㄧ讲瀵艰嚧鎻℃墜澶辫触銆?    return '*'


ALLOWED_ORIGINS = _build_allowed_origins()
CORS_ORIGINS_FOR_FLASK = ALLOWED_ORIGINS
SOCKET_CORS_ORIGINS = _build_socket_cors_origins()


def _resolve_sqlite_db_path():
    configured = (os.environ.get('SQLITE_PATH') or '').strip()
    if configured:
        return configured
    return os.path.join(basedir, 'database.db')


def _resolve_database_uri():
    configured_url = (
        (os.environ.get('DATABASE_URL') or '').strip()
        or (os.environ.get('POSTGRES_URL') or '').strip()
        or (os.environ.get('RAILWAY_DATABASE_URL') or '').strip()
    )

    if configured_url:
        if configured_url.startswith('postgres://'):
            configured_url = 'postgresql://' + configured_url[len('postgres://'):]
        return configured_url

    sqlite_path = _resolve_sqlite_db_path()
    sqlite_dir = os.path.dirname(sqlite_path)
    if sqlite_dir:
        os.makedirs(sqlite_dir, exist_ok=True)
    return 'sqlite:///' + sqlite_path

app = Flask(__name__, static_folder=None)
CORS(app, 
    origins=CORS_ORIGINS_FOR_FLASK,
     supports_credentials=True, 
     allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

socketio = SocketIO(
    app,
    cors_allowed_origins=SOCKET_CORS_ORIGINS,
    manage_session=False,
)

room_members = {}
socket_room_map = {}
room_host_map = {}
room_state_lock = Lock()

# 閰嶇疆浼氳瘽
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_COOKIE_SAMESITE'] = 'None' if IS_PRODUCTION else 'Lax'
app.config['SESSION_COOKIE_SECURE'] = IS_PRODUCTION
Session(app)

# 閰嶇疆鏁版嵁搴?app.config['SQLALCHEMY_DATABASE_URI'] = _resolve_database_uri()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
FRONTEND_BUILD_DIR_CANDIDATES = [
    os.path.abspath(os.path.join(basedir, '..', 'frontend', 'build')),
    os.path.abspath(os.path.join(basedir, '..', 'frontend_bundle')),
]


def _resolve_frontend_build_dir():
    for candidate in FRONTEND_BUILD_DIR_CANDIDATES:
        index_file = os.path.join(candidate, 'index.html')
        if os.path.exists(index_file):
            return candidate
    return FRONTEND_BUILD_DIR_CANDIDATES[0]


FRONTEND_BUILD_DIR = _resolve_frontend_build_dir()


def _build_webrtc_ice_servers():
    stun_defaults = [
        {'urls': 'stun:stun.cloudflare.com:3478'},
        {'urls': 'stun:stun.l.google.com:19302'},
    ]

    turn_servers = []

    turn_url = (os.environ.get('TURN_URL') or os.environ.get('REACT_APP_TURN_URL') or '').strip()
    turn_username = (os.environ.get('TURN_USERNAME') or os.environ.get('REACT_APP_TURN_USERNAME') or '').strip()
    turn_credential = (os.environ.get('TURN_CREDENTIAL') or os.environ.get('REACT_APP_TURN_CREDENTIAL') or '').strip()
    if turn_url:
        turn_servers.append({
            'urls': turn_url,
            'username': turn_username,
            'credential': turn_credential,
        })

    # TURN_URLS 环境变量已禁用，直接用内置稳定 TURN 列表
    # turn_urls = [item.strip() for item in (os.environ.get('TURN_URLS') or '').split(',') if item.strip()]
    # for item in turn_urls:
    #     turn_servers.append(...)

    fallback_turn_servers = [
        {
            'urls': 'turn:stun.stunprotocol.org:3478',
            'username': '',
            'credential': '',
        },
        {
            'urls': 'turn:stun1.stunprotocol.org:3478',
            'username': '',
            'credential': '',
        },
        {
            'urls': 'turn:numb.viagenie.ca:3478?transport=udp',
            'username': 'webrtc@mozilla.org',
            'credential': 'webrtc',
        },
        {
            'urls': 'turn:numb.viagenie.ca:5349?transport=tcp',
            'username': 'webrtc@mozilla.org',
            'credential': 'webrtc',
        },
        {
            'urls': 'turns:numb.viagenie.ca:5349?transport=tcp',
            'username': 'webrtc@mozilla.org',
            'credential': 'webrtc',
        },
    ]

    merged_turn_servers = fallback_turn_servers  # ignore env TURN_URLS

    # 鎸?urls 鍘婚噸锛屼繚鎸侀厤缃ǔ瀹氥€?    dedup_turn_servers = []
    seen_urls = set()
    for server in merged_turn_servers:
        urls = server.get('urls')
        if not urls or urls in seen_urls:
            continue
        seen_urls.add(urls)
        dedup_turn_servers.append(server)

    return stun_defaults + dedup_turn_servers


def _resolve_ice_transport_policy():
    configured = (os.environ.get('ICE_TRANSPORT_POLICY') or os.environ.get('REACT_APP_ICE_TRANSPORT_POLICY') or '').strip().lower()
    if configured in {'relay', 'all'}:
        return configured
    # 榛樿璧?relay锛屼紭鍏堜繚璇佽法缃戝彲杩為€氾紱濡傞渶鐩磋繛鍙樉寮忚缃?ICE_TRANSPORT_POLICY=all銆?    return 'relay'


@app.get('/api/webrtc-config')
def webrtc_config():
    return jsonify({
        'iceServers': _build_webrtc_ice_servers(),
        'iceTransportPolicy': _resolve_ice_transport_policy(),
    })

db.init_app(app)

auth_serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
AUTH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30


def _make_auth_token(user):
    return auth_serializer.dumps({'uid': user.id}, salt='calendar-auth')


def _get_user_from_auth_token(token):
    try:
        payload = auth_serializer.loads(
            token,
            salt='calendar-auth',
            max_age=AUTH_TOKEN_MAX_AGE_SECONDS,
        )
    except (BadSignature, SignatureExpired):
        return None

    uid = payload.get('uid') if isinstance(payload, dict) else None
    if not uid:
        return None
    return User.query.get(uid)


def _get_bearer_token_from_request():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.lower().startswith('bearer '):
        return ''
    return auth_header.split(' ', 1)[1].strip()


@app.before_request
def hydrate_session_from_bearer_token():
    if request.path.startswith('/api/'):
        if session.get('user'):
            return

        token = _get_bearer_token_from_request()
        if not token:
            return

        user = _get_user_from_auth_token(token)
        if not user:
            return

        session['user'] = {'id': user.id, 'username': user.username, 'name': user.name}


def current_user_id():
    user = session.get('user')
    if user:
        return user.get('id')

    token = _get_bearer_token_from_request()
    if not token:
        return None

    auth_user = _get_user_from_auth_token(token)
    return auth_user.id if auth_user else None


def is_team_member(team_id, user_id):
    return TeamMember.query.filter_by(team_id=team_id, user_id=user_id).first() is not None


def _socket_member_payload(sid, role='member'):
    user_info = session.get('user') or {}
    uid = user_info.get('id')
    name = (
        user_info.get('name')
        or user_info.get('username')
        or f'鎴愬憳 {sid[:6]}'
    )
    return {
        'socketId': sid,
        'userId': uid,
        'name': name,
        'role': role,
    }


def _room_host_sid(room_id):
    host_sid = room_host_map.get(room_id)
    if host_sid and host_sid in (room_members.get(room_id) or {}):
        return host_sid

    members = room_members.get(room_id) or {}
    first_sid = next(iter(members.keys()), None)
    if first_sid:
        room_host_map[room_id] = first_sid
    return first_sid


def _room_member_payloads(room_id):
    members = room_members.get(room_id) or {}
    host_sid = _room_host_sid(room_id)
    return [
        _socket_member_payload(sid, role='host' if sid == host_sid else 'member')
        for sid in members.keys()
    ]


def _remove_socket_from_room(sid, room_id=None, notify=True):
    target_room = room_id or socket_room_map.get(sid)
    if not target_room:
        return

    removed = False
    promote_payload = None
    with room_state_lock:
        members = room_members.get(target_room, {})
        removed = sid in members
        if removed:
            members.pop(sid, None)
            if not members:
                room_members.pop(target_room, None)
                room_host_map.pop(target_room, None)
            else:
                host_sid = room_host_map.get(target_room)
                if host_sid == sid or host_sid not in members:
                    new_host_sid = next(iter(members.keys()), None)
                    if new_host_sid:
                        room_host_map[target_room] = new_host_sid
                        promote_payload = _socket_member_payload(new_host_sid, role='host')
        socket_room_map.pop(sid, None)

    socket_leave_room(target_room, sid=sid)

    if notify and removed:
        socketio.emit('user-left', {'socketId': sid}, room=target_room)
        if promote_payload:
            socketio.emit('room-role-updated', {
                'roomId': target_room,
                'hostSocketId': promote_payload['socketId'],
                'hostUserId': promote_payload['userId'],
                'hostName': promote_payload['name'],
            }, room=target_room)


@socketio.on('join-room')
def handle_join_room(payload):
    room_id = str((payload or {}).get('roomId') or '').strip()
    if not room_id:
        emit('room-error', {'message': '鎴块棿鍙蜂笉鑳戒负绌?})
        return

    previous_room = socket_room_map.get(request.sid)
    if previous_room and previous_room != room_id:
        _remove_socket_from_room(request.sid, previous_room, notify=True)

    socket_join_room(room_id)
    me = _socket_member_payload(request.sid)

    with room_state_lock:
        members = room_members.setdefault(room_id, {})
        socket_room_map[request.sid] = room_id
        host_sid = room_host_map.get(room_id)
        if not host_sid or host_sid not in members:
            room_host_map[room_id] = request.sid
            host_sid = request.sid
        me = _socket_member_payload(request.sid, role='host' if request.sid == host_sid else 'member')
        members[request.sid] = me
        others = [
            _socket_member_payload(sid, role='host' if sid == host_sid else 'member')
            for sid in members.keys()
            if sid != request.sid
        ]

    emit('room-users', {
        'roomId': room_id,
        'users': others,
        'hostSocketId': room_host_map.get(room_id),
    })
    socketio.emit('user-joined', me, room=room_id, skip_sid=request.sid)
    socketio.emit('room-role-updated', {
        'roomId': room_id,
        'hostSocketId': room_host_map.get(room_id),
        'hostUserId': me['userId'] if me['role'] == 'host' else None,
        'hostName': me['name'] if me['role'] == 'host' else None,
    }, room=room_id)


@socketio.on('leave-room')
def handle_leave_room(payload):
    room_id = str((payload or {}).get('roomId') or '').strip() or None
    _remove_socket_from_room(request.sid, room_id, notify=True)


@socketio.on('signal')
def handle_signal(payload):
    target_id = (payload or {}).get('targetId')
    signal = (payload or {}).get('signal')

    if not target_id or signal is None:
        emit('room-error', {'message': '淇′护鍙傛暟涓嶅畬鏁?})
        return

    sender_room = socket_room_map.get(request.sid)
    target_room = socket_room_map.get(target_id)
    if not sender_room or sender_room != target_room:
        emit('room-error', {'message': '鐩爣鎴愬憳涓嶅湪鍚屼竴鎴块棿'})
        return

    socketio.emit('signal', {'from': request.sid, 'signal': signal}, room=target_id)


@socketio.on('disconnect')
def handle_disconnect():
    _remove_socket_from_room(request.sid, notify=True)





def _split_meeting_sentences(text):
    parts = re.split(r'[\n銆傦紒锛??]+', text or '')
    return [p.strip() for p in parts if p and p.strip()]


def _fallback_meeting_summary(transcript_text):
    sentences = _split_meeting_sentences(transcript_text)
    sentence_count = len(sentences)

    if sentence_count == 0:
        return {
            'summary': '鏈浼氳鏆傛棤鏈夋晥璇煶鍐呭銆?,
            'key_points': [],
            'action_items': [],
            'provider': 'fallback'
        }

    # 鎻愬彇甯歌鍏抽敭璇嶏紙绠€鏄撶粺璁★紝閬垮厤澶栭儴渚濊禆锛?    clean_text = re.sub(r'[^\w\u4e00-\u9fff\s]', ' ', transcript_text)
    words = [w.strip().lower() for w in clean_text.split() if len(w.strip()) >= 2]
    stop_words = {
        '鎴戜滑', '杩欎釜', '閭ｄ釜', '鐒跺悗', '灏辨槸', '宸茬粡', '杩涜', '鍙互', '闇€瑕?, '浠婂ぉ',
        '浼氳', '涓€涓?, '涓€涓?, '娌℃湁', '浣犱滑', '浠栦滑', '濡傛灉', '鍥犱负', '鎵€浠?, 'and', 'the'
    }
    freq = Counter(w for w in words if w not in stop_words)
    top_keywords = [k for k, _ in freq.most_common(5)]

    key_points = sentences[:3]
    if top_keywords:
        key_points.append('楂橀鍏虫敞璇嶏細' + '銆?.join(top_keywords))

    action_lines = []
    for s in sentences:
        if re.search(r'(璐熻矗|璺熻繘|瀹屾垚|纭|鎻愪氦|瀹夋帓|鍚屾|deadline|鎴|涓嬪懆|鏄庡ぉ)', s, re.IGNORECASE):
            action_lines.append(s)

    action_items = []
    for line in action_lines[:6]:
        owner_match = re.search(r'([\u4e00-\u9fffA-Za-z0-9_]{2,10})\s*(璐熻矗|璺熻繘)', line)
        deadline_match = re.search(r'(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|鏈懆|涓嬪懆|鏄庡ぉ|鍚庡ぉ|鏈堝簳)', line)
        action_items.append({
            'owner': owner_match.group(1) if owner_match else '寰呯‘璁?,
            'task': line,
            'deadline': deadline_match.group(1) if deadline_match else '寰呭畾'
        })

    summary = f'鏈浼氳鍏辫褰?{sentence_count} 鏉¤鍙ワ紝璁ㄨ浜嗕换鍔℃帹杩涗笌鍚庣画瀹夋帓銆?

    return {
        'summary': summary,
        'key_points': key_points,
        'action_items': action_items,
        'provider': 'fallback'
    }


def _call_llm_meeting_summary(transcript_text):
    api_key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not api_key:
        return None

    base_url = os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
    model = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')

    prompt = (
        '浣犳槸浼氳绾鍔╂墜銆傝鏍规嵁浼氳杞啓鍐呭杈撳嚭涓ユ牸 JSON锛岀粨鏋勪负: '
        '{"summary": string, "key_points": string[], "action_items": '
        '[{"owner": string, "task": string, "deadline": string}]}銆?
        '涓嶈杈撳嚭 markdown锛屼笉瑕佽緭鍑哄浣欐枃瀛椼€?
    )

    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': prompt},
            {'role': 'user', 'content': transcript_text[:12000]}
        ],
        'temperature': 0.2,
        'response_format': {'type': 'json_object'}
    }

    req = urlrequest.Request(
        url=f'{base_url}/chat/completions',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        },
        method='POST'
    )

    try:
        with urlrequest.urlopen(req, timeout=25) as resp:
            body = json.loads(resp.read().decode('utf-8'))
        content = body['choices'][0]['message']['content']
        parsed = json.loads(content)

        return {
            'summary': parsed.get('summary', ''),
            'key_points': parsed.get('key_points', []),
            'action_items': parsed.get('action_items', []),
            'provider': 'llm'
        }
    except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
        print('llm summary failed:', exc)
        return None


def _normalize_action_items(raw_items, fallback_summary=''):
    items = raw_items
    if isinstance(items, list):
        pass
    elif isinstance(items, dict):
        items = [items]
    elif isinstance(items, str) and items.strip():
        items = [{'task': items.strip(), 'owner': '寰呯‘璁?, 'deadline': '寰呭畾'}]
    else:
        items = []

    normalized = []
    for idx, item in enumerate(items):
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({'task': text, 'owner': '寰呯‘璁?, 'deadline': '寰呭畾'})
            continue
        if not isinstance(item, dict):
            continue

        task = str(item.get('task') or item.get('title') or '').strip() or f'浼氳琛屽姩椤?{idx + 1}'
        owner = str(item.get('owner') or item.get('assignee') or '').strip() or '寰呯‘璁?
        deadline = str(item.get('deadline') or item.get('due_date') or '').strip() or '寰呭畾'
        normalized.append({'task': task, 'owner': owner, 'deadline': deadline})

    if not normalized and fallback_summary:
        normalized.append({
            'task': f'鏍规嵁浼氳鎽樿璺熻繘锛歿str(fallback_summary)[:60]}',
            'owner': '寰呯‘璁?,
            'deadline': '寰呭畾'
        })

    return normalized


def ensure_legacy_schema():
    """琛ラ綈鏃х増 SQLite 鏁版嵁搴撶己澶卞瓧娈碉紝閬垮厤鍗囩骇鍚庣櫥褰?娉ㄥ唽鎶ラ敊銆?""
    db_uri = app.config.get('SQLALCHEMY_DATABASE_URI', '')
    if not db_uri.startswith('sqlite:///'):
        return

    db_path = db_uri.replace('sqlite:///', '', 1)
    if not os.path.exists(db_path):
        return

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()

        user_cols = [row[1] for row in cur.execute("PRAGMA table_info(user)").fetchall()]
        if user_cols and 'status' not in user_cols:
            cur.execute("ALTER TABLE user ADD COLUMN status VARCHAR(200) DEFAULT ''")

        event_cols = [row[1] for row in cur.execute("PRAGMA table_info(event)").fetchall()]
        if event_cols and 'user_id' not in event_cols:
            cur.execute("ALTER TABLE event ADD COLUMN user_id INTEGER")
            first_user = cur.execute("SELECT id FROM user ORDER BY id LIMIT 1").fetchone()
            if first_user:
                cur.execute("UPDATE event SET user_id = ? WHERE user_id IS NULL", (first_user[0],))

        conn.commit()
    finally:
        conn.close()

# 鍒涘缓鏁版嵁搴撹〃锛堝鏋滄枃浠舵崯鍧忓垯鍒犻櫎閲嶅缓锛?with app.app_context():
    try:
        db.create_all()
        ensure_legacy_schema()
        print("鏁版嵁搴撹〃鍒涘缓鎴愬姛锛?)
    except Exception as e:
        print("鏁版嵁搴撳垵濮嬪寲鍑洪敊锛?, e)
        # sqlite 甯歌鐨勬崯鍧忛棶棰橈紝灏濊瘯鍒犻櫎鏂囦欢骞堕噸鏂板垱寤?        if 'disk image is malformed' in str(e):
            db_uri = app.config.get('SQLALCHEMY_DATABASE_URI', '')
            db_path = db_uri.replace('sqlite:///', '', 1) if db_uri.startswith('sqlite:///') else ''
            try:
                if db_path:
                    os.remove(db_path)
                print("鎹熷潖鐨勬暟鎹簱宸插垹闄わ紝閲嶆柊鍒涘缓涓€?)
                db.create_all()
                print("鏁版嵁搴撳凡閲嶆柊鍒涘缓銆?)
            except Exception as exc:
                print("閲嶆柊鍒涘缓鏁版嵁搴撳け璐ワ細", exc)
        else:
            raise


# 娴嬭瘯璺敱
@app.route('/', methods=['GET'])
def home():
    index_file = os.path.join(FRONTEND_BUILD_DIR, 'index.html')
    if os.path.exists(index_file):
        return send_from_directory(FRONTEND_BUILD_DIR, 'index.html')
    return jsonify({"message": "Calendar API is running", "status": "ok"})


@app.route('/static/<path:filename>', methods=['GET'])
def frontend_static_files(filename):
    static_dir = os.path.join(FRONTEND_BUILD_DIR, 'static')
    return send_from_directory(static_dir, filename)


@app.route('/<path:path>', methods=['GET'])
def frontend_spa_fallback(path):
    if path.startswith('api/'):
        return jsonify({'error': 'Not Found'}), 404

    asset_path = os.path.join(FRONTEND_BUILD_DIR, path)
    if os.path.exists(asset_path) and os.path.isfile(asset_path):
        return send_from_directory(FRONTEND_BUILD_DIR, path)

    index_file = os.path.join(FRONTEND_BUILD_DIR, 'index.html')
    if os.path.exists(index_file):
        return send_from_directory(FRONTEND_BUILD_DIR, 'index.html')

    return jsonify({'error': 'Not Found'}), 404


@app.route('/api/test', methods=['GET'])
def test():
    return jsonify({"message": "API is working"})


# 鐢ㄦ埛鏁版嵁鐜板湪淇濆瓨鍦ㄦ暟鎹簱涓紝榛樿璐︽埛鍙互閫氳繃鍒濆鍖栬剼鏈垱寤?# 锛堝鏈夐渶瑕侊紝鍚庣画鍙坊鍔犺縼绉绘垨棰勫～鍏呴€昏緫锛?

# 鐧诲綍璺敱
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'success': False, 'message': '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖'}), 400

    user = User.query.filter_by(username=username).first()
    if user and user.password == password:
        session['user'] = {'id': user.id, 'username': user.username, 'name': user.name}
        token = _make_auth_token(user)
        return jsonify({'success': True, 'user': user.to_dict(), 'token': token, 'message': '鐧诲綍鎴愬姛'})
    else:
        return jsonify({'success': False, 'message': '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒'}), 401


@app.route('/api/auth/check', methods=['GET'])
def check_auth():
    if 'user' in session:
        uid = session['user']['id']
        user = User.query.get(uid)
        if not user:
            session.pop('user', None)
            return jsonify({'error': '鐢ㄦ埛涓嶅瓨鍦?}), 401
        token = _make_auth_token(user)
        return jsonify({'user': user.to_dict(), 'token': token})

    token = _get_bearer_token_from_request()
    if token:
        user = _get_user_from_auth_token(token)
        if user:
            session['user'] = {'id': user.id, 'username': user.username, 'name': user.name}
            return jsonify({'user': user.to_dict(), 'token': token})

    return jsonify({'error': '鏈櫥褰?}), 401

@app.route('/api/profile', methods=['GET'])
def get_profile():
    if 'user' not in session:
        return jsonify({'error': '鏈櫥褰?}), 401
    uid = session['user']['id']
    user = User.query.get(uid)
    if not user:
        return jsonify({'error': '鐢ㄦ埛涓嶅瓨鍦?}), 404
    return jsonify({'success': True, 'user': user.to_dict()})

@app.route('/api/profile', methods=['PUT'])
def update_profile():
    if 'user' not in session:
        return jsonify({'success': False, 'message': '鏈櫥褰?}), 401
    uid = session['user']['id']
    user = User.query.get(uid)
    if not user:
        return jsonify({'success': False, 'message': '鐢ㄦ埛涓嶅瓨鍦?}), 404
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'success': False, 'message': '鏃犳晥鐨凧SON'}), 400

    try:
        for field in ['email', 'bio', 'name', 'gender', 'birthdate', 'avatar']:
            if field in data:
                setattr(user, field, data[field])
                session['user'][field] = data[field]
        db.session.commit()
        return jsonify({'success': True, 'user': user.to_dict()})
    except Exception as exc:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'鏈嶅姟鍣ㄩ敊璇? {str(exc)}'}), 500

# 娉ㄥ唽璺敱
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'success': False, 'message': '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'message': '鐢ㄦ埛鍚嶅凡瀛樺湪'}), 400

    try:
        new_user = User(
            username=username,
            password=password,
            name=username,
            email=data.get('email', ''),
            bio=data.get('bio', ''),
            gender=data.get('gender', ''),
            birthdate=data.get('birthdate', ''),
            avatar=data.get('avatar', ''),
        )
        db.session.add(new_user)
        db.session.commit()

        session['user'] = {'id': new_user.id, 'username': new_user.username, 'name': new_user.name}
        token = _make_auth_token(new_user)
        return jsonify({'success': True, 'user': new_user.to_dict(), 'token': token, 'message': '娉ㄥ唽鎴愬姛'})
    except Exception as exc:
        db.session.rollback()
        # log exception
        print('register error', exc)
        return jsonify({'success': False, 'message': '娉ㄥ唽澶辫触锛岃绋嶅悗鍐嶈瘯'}), 500


@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({'success': True, 'message': '宸查€€鍑虹櫥褰?})


@app.route('/api/events', methods=['GET'])
def get_events():
    """鑾峰彇褰撳墠鐧诲綍鐢ㄦ埛鐨勪簨浠讹紝鏀寔鎸夊勾鏈堣繃婊?""
    if 'user' not in session:
        return jsonify({"error": "璇峰厛鐧诲綍"}), 401
    uid = session['user']['id']
    try:
        year = request.args.get('year')
        month = request.args.get('month')

        query = Event.query.filter_by(user_id=uid)

        if year and month:
            start_date = datetime(int(year), int(month), 1).date()
            if int(month) == 12:
                end_date = datetime(int(year) + 1, 1, 1).date()
            else:
                end_date = datetime(int(year), int(month) + 1, 1).date()
            query = query.filter(
                Event.start_date >= start_date,
                Event.start_date < end_date
            )

        events = query.all()
        return jsonify([event.to_dict(include_user=True) for event in events])
    except Exception as e:
        print(f"閿欒: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/events/<int:event_id>', methods=['GET'])
def get_event(event_id):
    """鑾峰彇鍗曚釜浜嬩欢锛堜粎闄愯嚜宸辩殑浜嬩欢锛?""
    if 'user' not in session:
        return jsonify({"error": "璇峰厛鐧诲綍"}), 401
    uid = session['user']['id']
    event = Event.query.get_or_404(event_id)
    if event.user_id != uid:
        return jsonify({"error": "鏃犳潈璁块棶姝や簨浠?}), 403
    return jsonify(event.to_dict(include_user=True))


@app.route('/api/events', methods=['POST'])
def create_event():
    """鍒涘缓鏂颁簨浠跺苟鍏宠仈褰撳墠鐢ㄦ埛"""
    if 'user' not in session:
        return jsonify({"error": "璇峰厛鐧诲綍"}), 401
    uid = session['user']['id']
    try:
        data = request.json or {}
        start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date()
        end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()

        event = Event(
            user_id=uid,
            title=data['title'],
            description=data.get('description', ''),
            start_date=start_date,
            end_date=end_date,
            start_time=data.get('start_time'),
            end_time=data.get('end_time'),
            color=data.get('color', '#3788d8')
        )

        db.session.add(event)
        db.session.commit()
        return jsonify(event.to_dict()), 201
    except Exception as e:
        print(f"鍒涘缓浜嬩欢閿欒: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    """鏇存柊浜嬩欢锛屼粎闄愭墍灞炵敤鎴?""
    if 'user' not in session:
        return jsonify({"error": "璇峰厛鐧诲綍"}), 401
    uid = session['user']['id']
    try:
        event = Event.query.get_or_404(event_id)
        if event.user_id != uid:
            return jsonify({"error": "鏃犳潈淇敼姝や簨浠?}), 403
        data = request.json or {}

        event.title = data.get('title', event.title)
        event.description = data.get('description', event.description)

        if data.get('start_date'):
            event.start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date()
        if data.get('end_date'):
            event.end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()
        if data.get('start_time') is not None:
            event.start_time = data['start_time']
        if data.get('end_time') is not None:
            event.end_time = data['end_time']
        if data.get('color'):
            event.color = data['color']

        db.session.commit()
        return jsonify(event.to_dict())
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route('/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    """鍒犻櫎浜嬩欢锛屼粎闄愭墍灞炵敤鎴?""
    if 'user' not in session:
        return jsonify({"error": "璇峰厛鐧诲綍"}), 401
    uid = session['user']['id']
    try:
        event = Event.query.get_or_404(event_id)
        if event.user_id != uid:
            return jsonify({"error": "鏃犳潈鍒犻櫎姝や簨浠?}), 403
        db.session.delete(event)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


# 杩斿洖褰撳墠鐢ㄦ埛鐨勪釜浜轰俊鎭互鍙婃墍鏈変簨浠?@app.route('/api/user-data', methods=['GET'])
def user_data():
    if 'user' not in session:
        return jsonify({"error": "璇峰厛鐧诲綍"}), 401
    uid = session['user']['id']
    user = User.query.get(uid)
    if not user:
        return jsonify({"error": "鐢ㄦ埛涓嶅瓨鍦?}), 404
    events = Event.query.filter_by(user_id=uid).all()
    return jsonify({
        'user': user.to_dict(),
        'events': [e.to_dict() for e in events],
        'tasks': [t.to_dict() for t in Task.query.filter(
            (Task.creator_id == uid) | (Task.assignee_id == uid)
        ).all()],
    })


@app.route('/api/dashboard/summary', methods=['GET'])
def dashboard_summary():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    events_count = Event.query.filter_by(user_id=uid).count()
    task_query = Task.query.filter((Task.creator_id == uid) | (Task.assignee_id == uid))
    tasks_total = task_query.filter(Task.status.in_(['todo', 'doing'])).count()
    tasks_done = task_query.filter_by(status='done').count()
    posts_count = Post.query.filter_by(user_id=uid).count()
    contacts_count = Contact.query.filter_by(user_id=uid).count()
    teams_count = TeamMember.query.filter_by(user_id=uid).count()

    return jsonify({
        'events_count': events_count,
        'tasks_total': tasks_total,
        'tasks_done': tasks_done,
        'posts_count': posts_count,
        'contacts_count': contacts_count,
        'teams_count': teams_count,
    })


@app.route('/api/status', methods=['PUT'])
def update_status():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    user = User.query.get(uid)
    if not user:
        return jsonify({'error': '鐢ㄦ埛涓嶅瓨鍦?}), 404

    data = request.json or {}
    user.status = str(data.get('status', ''))[:200]
    db.session.commit()
    return jsonify({'success': True, 'user': user.to_dict()})


@app.route('/api/teams', methods=['GET'])
def get_teams():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    memberships = TeamMember.query.filter_by(user_id=uid).all()
    teams = [m.team.to_dict() for m in memberships if m.team]
    return jsonify(teams)


@app.route('/api/teams', methods=['POST'])
def create_team():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '鍥㈤槦鍚嶇О涓嶈兘涓虹┖'}), 400

    team = Team(name=name, owner_id=uid)
    db.session.add(team)
    db.session.flush()

    owner_member = TeamMember(team_id=team.id, user_id=uid, role='owner')
    db.session.add(owner_member)
    db.session.commit()

    return jsonify(team.to_dict()), 201


@app.route('/api/teams/<int:team_id>/members', methods=['GET'])
def get_team_members(team_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401
    if not is_team_member(team_id, uid):
        return jsonify({'error': '鏃犳潈璁块棶璇ュ洟闃?}), 403

    members = TeamMember.query.filter_by(team_id=team_id).all()
    return jsonify([m.to_dict() for m in members])


@app.route('/api/teams/<int:team_id>/members', methods=['POST'])
def add_team_member(team_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    membership = TeamMember.query.filter_by(team_id=team_id, user_id=uid).first()
    if not membership or membership.role not in ['owner', 'manager']:
        return jsonify({'error': '浠呭洟闃熺鐞嗗憳鍙坊鍔犳垚鍛?}), 403

    data = request.json or {}
    username = (data.get('username') or '').strip()
    role = (data.get('role') or 'member').strip()
    target = User.query.filter_by(username=username).first()
    if not target:
        return jsonify({'error': '鐢ㄦ埛涓嶅瓨鍦?}), 404

    if TeamMember.query.filter_by(team_id=team_id, user_id=target.id).first():
        return jsonify({'error': '璇ョ敤鎴峰凡鍦ㄥ洟闃熶腑'}), 400

    m = TeamMember(team_id=team_id, user_id=target.id, role=role)
    db.session.add(m)
    db.session.commit()
    return jsonify(m.to_dict()), 201


@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    team_id = request.args.get('team_id', type=int)
    status = request.args.get('status')

    query = Task.query.filter((Task.creator_id == uid) | (Task.assignee_id == uid))
    if team_id:
        query = query.filter_by(team_id=team_id)
    if status:
        query = query.filter_by(status=status)

    tasks = query.order_by(Task.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tasks])


@app.route('/api/tasks', methods=['POST'])
def create_task():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': '浠诲姟鏍囬涓嶈兘涓虹┖'}), 400

    team_id = data.get('team_id')
    assignee_id = data.get('assignee_id') or uid

    if team_id and not is_team_member(team_id, uid):
        return jsonify({'error': '鏃犳潈鍦ㄨ鍥㈤槦鍒涘缓浠诲姟'}), 403

    if assignee_id and not User.query.get(assignee_id):
        return jsonify({'error': '琚垎閰嶇敤鎴蜂笉瀛樺湪'}), 404

    task = Task(
        title=title,
        description=data.get('description', ''),
        status=data.get('status', 'todo'),
        priority=data.get('priority', 'medium'),
        due_date=data.get('due_date'),
        team_id=team_id,
        assignee_id=assignee_id,
        creator_id=uid,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    task = Task.query.get_or_404(task_id)
    if uid not in [task.creator_id, task.assignee_id]:
        return jsonify({'error': '鏃犳潈淇敼璇ヤ换鍔?}), 403

    data = request.json or {}
    for field in ['title', 'description', 'status', 'priority', 'due_date']:
        if field in data:
            setattr(task, field, data[field])

    if 'assignee_id' in data:
        if data['assignee_id'] and not User.query.get(data['assignee_id']):
            return jsonify({'error': '琚垎閰嶇敤鎴蜂笉瀛樺湪'}), 404
        task.assignee_id = data['assignee_id']

    db.session.commit()
    return jsonify(task.to_dict())


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    task = Task.query.get_or_404(task_id)
    if uid != task.creator_id:
        return jsonify({'error': '浠呭垱寤鸿€呭彲浠ュ垹闄や换鍔?}), 403

    db.session.delete(task)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/contacts/search', methods=['GET'])
def search_users_for_contact():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    keyword = (request.args.get('q') or '').strip()
    if not keyword:
        return jsonify([])

    users = User.query.filter(User.username.contains(keyword), User.id != uid).limit(10).all()
    return jsonify([u.to_dict() for u in users])


@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    contacts = Contact.query.filter_by(user_id=uid).order_by(Contact.created_at.desc()).all()
    return jsonify([c.to_dict() for c in contacts])


@app.route('/api/contacts', methods=['POST'])
def create_contact():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    contact_user_id = data.get('contact_user_id')
    if not contact_user_id:
        return jsonify({'error': '璇烽€夋嫨鑱旂郴浜?}), 400
    if contact_user_id == uid:
        return jsonify({'error': '涓嶈兘娣诲姞鑷繁'}), 400

    target = User.query.get(contact_user_id)
    if not target:
        return jsonify({'error': '鑱旂郴浜轰笉瀛樺湪'}), 404

    if Contact.query.filter_by(user_id=uid, contact_user_id=contact_user_id).first():
        return jsonify({'error': '鑱旂郴浜哄凡瀛樺湪'}), 400

    pending_request = FriendRequest.query.filter_by(
        requester_id=uid,
        receiver_id=contact_user_id,
        status='pending'
    ).first()
    if pending_request:
        return jsonify({'error': '濂藉弸鐢宠宸插彂閫侊紝璇风瓑寰呭鏂瑰鐞?}), 400

    friend_request = FriendRequest(
        requester_id=uid,
        receiver_id=contact_user_id,
        request_tag=data.get('tag', ''),
        request_note=data.get('note', ''),
        status='pending',
    )
    db.session.add(friend_request)
    db.session.commit()
    return jsonify({'message': '濂藉弸鐢宠宸插彂閫?, 'request': friend_request.to_dict()}), 201


@app.route('/api/contact-requests/incoming', methods=['GET'])
def get_incoming_contact_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    requests = FriendRequest.query.filter_by(receiver_id=uid, status='pending') \
        .order_by(FriendRequest.created_at.desc()).all()
    return jsonify([r.to_dict() for r in requests])


@app.route('/api/contact-requests/outgoing', methods=['GET'])
def get_outgoing_contact_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    requests = FriendRequest.query.filter_by(requester_id=uid, status='pending') \
        .order_by(FriendRequest.created_at.desc()).all()
    return jsonify([r.to_dict() for r in requests])


@app.route('/api/contact-requests/<int:request_id>/respond', methods=['POST'])
def respond_contact_request(request_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    friend_request = FriendRequest.query.get_or_404(request_id)
    if friend_request.receiver_id != uid:
        return jsonify({'error': '鏃犳潈澶勭悊璇ョ敵璇?}), 403
    if friend_request.status != 'pending':
        return jsonify({'error': '璇ョ敵璇峰凡澶勭悊'}), 400

    data = request.json or {}
    action = (data.get('action') or '').strip().lower()
    if action not in ['accepted', 'rejected']:
        return jsonify({'error': '鏃犳晥鎿嶄綔'}), 400

    if action == 'accepted':
        requester_to_receiver = Contact.query.filter_by(
            user_id=friend_request.requester_id,
            contact_user_id=friend_request.receiver_id,
        ).first()
        if not requester_to_receiver:
            db.session.add(Contact(
                user_id=friend_request.requester_id,
                contact_user_id=friend_request.receiver_id,
                tag=friend_request.request_tag or '',
                note=friend_request.request_note or '',
                is_favorite=False,
            ))

        receiver_to_requester = Contact.query.filter_by(
            user_id=friend_request.receiver_id,
            contact_user_id=friend_request.requester_id,
        ).first()
        if not receiver_to_requester:
            db.session.add(Contact(
                user_id=friend_request.receiver_id,
                contact_user_id=friend_request.requester_id,
                tag='',
                note='',
                is_favorite=False,
            ))

    friend_request.status = action
    friend_request.responded_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'message': '濂藉弸鐢宠宸插鐞?, 'request': friend_request.to_dict()})


@app.route('/api/contacts/<int:contact_id>', methods=['PUT'])
def update_contact(contact_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    contact = Contact.query.get_or_404(contact_id)
    if contact.user_id != uid:
        return jsonify({'error': '鏃犳潈淇敼璇ヨ仈绯讳汉'}), 403

    data = request.json or {}
    for field in ['tag', 'note', 'is_favorite']:
        if field in data:
            setattr(contact, field, data[field])

    db.session.commit()
    return jsonify(contact.to_dict())


@app.route('/api/contacts/<int:contact_id>', methods=['DELETE'])
def delete_contact(contact_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    contact = Contact.query.get_or_404(contact_id)
    if contact.user_id != uid:
        return jsonify({'error': '鏃犳潈鍒犻櫎璇ヨ仈绯讳汉'}), 403

    db.session.delete(contact)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/remote-control-requests', methods=['POST'])
def create_remote_control_request():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    target_user_id = data.get('target_user_id')
    try:
        target_user_id = int(target_user_id)
    except (TypeError, ValueError):
        target_user_id = None
    if not target_user_id:
        return jsonify({'error': '璇烽€夋嫨鑱旂郴浜?}), 400
    if target_user_id == uid:
        return jsonify({'error': '涓嶈兘鍚戣嚜宸卞彂璧疯繙绋嬫搷鎺?}), 400

    target_user = User.query.get(target_user_id)
    if not target_user:
        return jsonify({'error': '鐩爣鐢ㄦ埛涓嶅瓨鍦?}), 404

    # 浠呭厑璁歌仈绯讳汉涔嬮棿鍙戣捣杩滅▼鎿嶆帶璇锋眰锛岄檷浣庤鍙戦闄?    relation = Contact.query.filter_by(user_id=uid, contact_user_id=target_user_id).first() or Contact.query.filter_by(
        user_id=target_user_id,
        contact_user_id=uid,
    ).first()
    if not relation:
        return jsonify({'error': '浠呭彲鍚戦€氳褰曡仈绯讳汉鍙戣捣杩滅▼鎿嶆帶璇锋眰'}), 403

    pending = RemoteControlRequest.query.filter(
        RemoteControlRequest.status == 'pending',
        or_(
            and_(
                RemoteControlRequest.requester_id == uid,
                RemoteControlRequest.target_user_id == target_user_id,
            ),
            and_(
                RemoteControlRequest.requester_id == target_user_id,
                RemoteControlRequest.target_user_id == uid,
            )
        )
    ).first()
    if pending:
        return jsonify({'error': '宸叉湁寰呭鐞嗚繙绋嬫搷鎺ц姹?}), 400

    room_id = str(data.get('room_id') or '').strip()
    if not room_id:
        room_id = f'rc-{min(uid, target_user_id)}-{max(uid, target_user_id)}-{int(datetime.utcnow().timestamp())}'

    control_request = RemoteControlRequest(
        requester_id=uid,
        target_user_id=target_user_id,
        room_id=room_id,
        control_note=(data.get('control_note') or '').strip(),
        status='pending',
    )
    db.session.add(control_request)
    db.session.commit()
    return jsonify({'message': '杩滅▼鎿嶆帶璇锋眰宸插彂閫?, 'request': control_request.to_dict()}), 201


@app.route('/api/remote-control-requests/incoming', methods=['GET'])
def get_incoming_remote_control_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    requests = RemoteControlRequest.query.filter_by(target_user_id=uid, status='pending') \
        .order_by(RemoteControlRequest.created_at.desc()).all()
    return jsonify([item.to_dict() for item in requests])


@app.route('/api/remote-control-requests/outgoing', methods=['GET'])
def get_outgoing_remote_control_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    requests = RemoteControlRequest.query.filter_by(requester_id=uid, status='pending') \
        .order_by(RemoteControlRequest.created_at.desc()).all()
    return jsonify([item.to_dict() for item in requests])


@app.route('/api/remote-control-requests/<int:request_id>/respond', methods=['POST'])
def respond_remote_control_request(request_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    control_request = RemoteControlRequest.query.get_or_404(request_id)
    if control_request.target_user_id != uid:
        return jsonify({'error': '鏃犳潈澶勭悊璇ヨ姹?}), 403
    if control_request.status != 'pending':
        return jsonify({'error': '璇ヨ姹傚凡澶勭悊'}), 400

    data = request.json or {}
    action = (data.get('action') or '').strip().lower()
    if action not in ['accepted', 'rejected']:
        return jsonify({'error': '鏃犳晥鎿嶄綔'}), 400

    control_request.status = action
    control_request.responded_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'message': '杩滅▼鎿嶆帶璇锋眰宸插鐞?, 'request': control_request.to_dict()})


@app.route('/api/posts', methods=['GET'])
def get_posts():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    scope = request.args.get('scope')
    category = request.args.get('category')

    query = Post.query
    if scope == 'mine':
        query = query.filter_by(user_id=uid)
    if category:
        query = query.filter_by(category=category)

    posts = query.order_by(Post.created_at.desc()).limit(100).all()
    return jsonify([p.to_dict(include_comments=True) for p in posts])


@app.route('/api/posts', methods=['POST'])
def create_post():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': '鍔ㄦ€佸唴瀹逛笉鑳戒负绌?}), 400

    post = Post(
        user_id=uid,
        category=data.get('category') or '宸ヤ綔鍔ㄦ€?,
        content=content,
    )
    db.session.add(post)
    db.session.commit()
    return jsonify(post.to_dict()), 201


@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
def like_post(post_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    post = Post.query.get_or_404(post_id)
    post.likes = max(0, (post.likes or 0) + 1)
    db.session.commit()
    return jsonify(post.to_dict())


@app.route('/api/posts/<int:post_id>/comments', methods=['POST'])
def create_post_comment(post_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    post = Post.query.get_or_404(post_id)
    data = request.json or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': '璇勮涓嶈兘涓虹┖'}), 400

    comment = PostComment(post_id=post.id, user_id=uid, content=content)
    db.session.add(comment)
    db.session.commit()
    return jsonify(comment.to_dict()), 201


@app.route('/api/assistant/suggest-schedule', methods=['POST'])
def assistant_suggest_schedule():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    preferred_days = data.get('preferred_days') or ['鍛ㄤ竴', '鍛ㄤ簩', '鍛ㄤ笁', '鍛ㄥ洓', '鍛ㄤ簲']
    duration = int(data.get('duration', 60))
    hour_start = int(data.get('hour_start', 9))
    hour_end = int(data.get('hour_end', 18))

    existing = Event.query.filter_by(user_id=uid).all()
    busy_time_keys = set()
    for e in existing:
        date_key = e.start_date.strftime('%Y-%m-%d')
        if e.start_time:
            busy_time_keys.add(f'{date_key}-{e.start_time}')

    suggestions = []
    now = datetime.now()
    day_names = ['鍛ㄤ竴', '鍛ㄤ簩', '鍛ㄤ笁', '鍛ㄥ洓', '鍛ㄤ簲', '鍛ㄥ叚', '鍛ㄦ棩']

    for offset in range(1, 15):
        dt = now.date().fromordinal(now.date().toordinal() + offset)
        day_name = day_names[dt.weekday()]
        if day_name not in preferred_days:
            continue

        for h in range(hour_start, hour_end):
            slot = f'{h:02d}:00'
            key = f'{dt.strftime("%Y-%m-%d")}-{slot}'
            if key in busy_time_keys:
                continue
            suggestions.append({
                'date': dt.strftime('%Y-%m-%d'),
                'start_time': slot,
                'duration_minutes': duration,
                'reason': '鏍规嵁浣犳渶杩戞棩绋嬬┖妗ｈ嚜鍔ㄦ帹鑽?,
            })
            if len(suggestions) >= 5:
                return jsonify({'suggestions': suggestions})

    return jsonify({'suggestions': suggestions})


@app.route('/api/assistant/task-plan', methods=['POST'])
def assistant_task_plan():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': '璇疯緭鍏ヤ换鍔℃弿杩?}), 400

    checkpoints = []
    for idx, seg in enumerate([s.strip() for s in text.replace('锛?, ',').split(',') if s.strip()], start=1):
        checkpoints.append({'step': idx, 'title': seg, 'eta': f'{idx} 澶╁唴'})

    if not checkpoints:
        checkpoints = [
            {'step': 1, 'title': '鏄庣‘鐩爣涓庨獙鏀舵爣鍑?, 'eta': '1 澶╁唴'},
            {'step': 2, 'title': '鎷嗗垎浠诲姟骞跺垎閰嶈礋璐ｄ汉', 'eta': '2 澶╁唴'},
            {'step': 3, 'title': '鎵ц涓庢瘡鏃ュ悓姝ヨ繘搴?, 'eta': '3-5 澶?},
        ]

    return jsonify({
        'summary': '宸叉牴鎹緭鍏ョ敓鎴愭墽琛岃鍒掞紝寤鸿鍚屾鍒颁换鍔″垪琛ㄥ苟璁剧疆鎴鏃ユ湡銆?,
        'checkpoints': checkpoints,
    })


@app.route('/api/assistant/meeting-summary', methods=['POST'])
def assistant_meeting_summary():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    transcript = data.get('transcript', '')
    if isinstance(transcript, list):
        transcript_text = '\n'.join([str(item).strip() for item in transcript if str(item).strip()])
    else:
        transcript_text = str(transcript).strip()

    if len(transcript_text) < 10:
        return jsonify({'error': '浼氳鍐呭杩囧皯锛屾棤娉曠敓鎴愭憳瑕?}), 400

    llm_result = _call_llm_meeting_summary(transcript_text)
    result = llm_result if llm_result else _fallback_meeting_summary(transcript_text)

    key_points = result.get('key_points', [])
    if not isinstance(key_points, list):
        key_points = [str(key_points)] if key_points else []

    action_items = _normalize_action_items(result.get('action_items', []), result.get('summary', ''))

    return jsonify({
        'summary': result.get('summary', ''),
        'key_points': key_points,
        'action_items': action_items,
        'provider': result.get('provider', 'fallback')
    })


@app.route('/api/assistant/meeting-tasks', methods=['POST'])
def assistant_meeting_tasks():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '璇峰厛鐧诲綍'}), 401

    data = request.json or {}
    action_items = _normalize_action_items(data.get('action_items') or [], data.get('summary') or '')
    if len(action_items) == 0:
        return jsonify({'error': '缂哄皯琛屽姩椤癸紝鏃犳硶鐢熸垚浠诲姟'}), 400

    member_user_ids = []
    raw_member_ids = data.get('member_user_ids') or []
    if isinstance(raw_member_ids, list):
        for item in raw_member_ids:
            try:
                member_user_ids.append(int(item))
            except (TypeError, ValueError):
                continue

    # 鍒涘缓鑰呴粯璁ょ撼鍏ヤ换鍔″垎閰嶆睜锛岀‘淇濊嚦灏戞湁鍙垎閰嶆垚鍛?    if uid not in member_user_ids:
        member_user_ids.append(uid)

    valid_members = [u.id for u in User.query.filter(User.id.in_(member_user_ids)).all()]
    if not valid_members:
        valid_members = [uid]

    room_id = str(data.get('room_id') or '').strip()
    team_id = data.get('team_id')
    try:
        team_id = int(team_id) if team_id is not None else None
    except (TypeError, ValueError):
        team_id = None

    created = []
    try:
        for idx, item in enumerate(action_items):
            if not isinstance(item, dict):
                continue

            title = str(item.get('task') or '').strip()
            if not title:
                title = f'浼氳琛屽姩椤?{idx + 1}'

            deadline = str(item.get('deadline') or '').strip()
            owner = str(item.get('owner') or '').strip() or '寰呯‘璁?
            assignee_id = valid_members[idx % len(valid_members)]

            task = Task(
                title=title[:150],
                description=(
                    f'鏉ユ簮锛氫細璁憳瑕亄f"锛堟埧闂?{room_id}锛? if room_id else ""}\n'
                    f'寤鸿璐熻矗浜猴細{owner}\n'
                    f'鍘熷鎴锛歿deadline or "寰呭畾"}'
                ),
                status='todo',
                priority='medium',
                due_date=deadline[:10] if re.match(r'^\d{4}-\d{2}-\d{2}$', deadline) else None,
                team_id=team_id,
                assignee_id=assignee_id,
                creator_id=uid,
            )
            db.session.add(task)
            created.append(task)

        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        print('assistant_meeting_tasks error:', exc)
        return jsonify({'error': f'鐢熸垚鍥㈤槦浠诲姟澶辫触: {str(exc)}'}), 500

    return jsonify({
        'success': True,
        'created_count': len(created),
        'tasks': [t.to_dict() for t in created]
    })





if __name__ == '__main__':
    print("鍚姩鏃ュ巻API鏈嶅姟鍣?..")
    print("璁块棶 http://localhost:5000 娴嬭瘯API")
    print("璁块棶 http://localhost:5000/api/events 鑾峰彇浜嬩欢")
    socketio.run(
        app,
        debug=True,
        port=5000,
        host='0.0.0.0',
        allow_unsafe_werkzeug=True,
    )

