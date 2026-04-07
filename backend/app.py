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
]

def _build_allowed_origins():
    configured = (os.environ.get('CORS_ORIGINS') or '').strip()
    if configured:
        return _split_env_csv('CORS_ORIGINS', DEFAULT_ORIGINS)

    origins = set(DEFAULT_ORIGINS)
    railway_domain = (os.environ.get('RAILWAY_PUBLIC_DOMAIN') or '').strip()
    railway_static_url = (os.environ.get('RAILWAY_STATIC_URL') or '').strip()
    frontend_url = (os.environ.get('FRONTEND_URL') or '').strip()

    if railway_domain:
        origins.add(f'https://{railway_domain}')
        origins.add(f'http://{railway_domain}')
    if railway_static_url:
        origins.add(railway_static_url.rstrip('/'))
    if frontend_url:
        origins.add(frontend_url.rstrip('/'))

    # 生产环境避免使用 '*'，否则与凭据场景冲突。
    return list(origins)


ALLOWED_ORIGINS = _build_allowed_origins()
CORS_ORIGINS_FOR_FLASK = ALLOWED_ORIGINS
SOCKET_CORS_ORIGINS = ALLOWED_ORIGINS

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

# 配置会话
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_COOKIE_SAMESITE'] = 'None' if IS_PRODUCTION else 'Lax'
app.config['SESSION_COOKIE_SECURE'] = IS_PRODUCTION
Session(app)

# 配置数据库
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
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

    turn_urls = [item.strip() for item in (os.environ.get('TURN_URLS') or '').split(',') if item.strip()]
    for item in turn_urls:
        turn_servers.append({
            'urls': item,
            'username': turn_username,
            'credential': turn_credential,
        })

    fallback_turn_servers = [
        {
            'urls': 'turn:relay.metered.ca:80',
            'username': 'openrelayproject',
            'credential': 'openrelayproject',
        },
        {
            'urls': 'turn:relay.metered.ca:443',
            'username': 'openrelayproject',
            'credential': 'openrelayproject',
        },
    ]

    merged_turn_servers = turn_servers if turn_servers else fallback_turn_servers

    # 按 urls 去重，保持配置稳定。
    dedup_turn_servers = []
    seen_urls = set()
    for server in merged_turn_servers:
        urls = server.get('urls')
        if not urls or urls in seen_urls:
            continue
        seen_urls.add(urls)
        dedup_turn_servers.append(server)

    return stun_defaults + dedup_turn_servers


@app.get('/api/webrtc-config')
def webrtc_config():
    return jsonify({
        'iceServers': _build_webrtc_ice_servers(),
        'iceTransportPolicy': 'all',
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
        or f'成员 {sid[:6]}'
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
        emit('room-error', {'message': '房间号不能为空'})
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
        emit('room-error', {'message': '信令参数不完整'})
        return

    sender_room = socket_room_map.get(request.sid)
    target_room = socket_room_map.get(target_id)
    if not sender_room or sender_room != target_room:
        emit('room-error', {'message': '目标成员不在同一房间'})
        return

    socketio.emit('signal', {'from': request.sid, 'signal': signal}, room=target_id)


@socketio.on('disconnect')
def handle_disconnect():
    _remove_socket_from_room(request.sid, notify=True)





def _split_meeting_sentences(text):
    parts = re.split(r'[\n。！？!?]+', text or '')
    return [p.strip() for p in parts if p and p.strip()]


def _fallback_meeting_summary(transcript_text):
    sentences = _split_meeting_sentences(transcript_text)
    sentence_count = len(sentences)

    if sentence_count == 0:
        return {
            'summary': '本次会议暂无有效语音内容。',
            'key_points': [],
            'action_items': [],
            'provider': 'fallback'
        }

    # 提取常见关键词（简易统计，避免外部依赖）
    clean_text = re.sub(r'[^\w\u4e00-\u9fff\s]', ' ', transcript_text)
    words = [w.strip().lower() for w in clean_text.split() if len(w.strip()) >= 2]
    stop_words = {
        '我们', '这个', '那个', '然后', '就是', '已经', '进行', '可以', '需要', '今天',
        '会议', '一下', '一个', '没有', '你们', '他们', '如果', '因为', '所以', 'and', 'the'
    }
    freq = Counter(w for w in words if w not in stop_words)
    top_keywords = [k for k, _ in freq.most_common(5)]

    key_points = sentences[:3]
    if top_keywords:
        key_points.append('高频关注词：' + '、'.join(top_keywords))

    action_lines = []
    for s in sentences:
        if re.search(r'(负责|跟进|完成|确认|提交|安排|同步|deadline|截止|下周|明天)', s, re.IGNORECASE):
            action_lines.append(s)

    action_items = []
    for line in action_lines[:6]:
        owner_match = re.search(r'([\u4e00-\u9fffA-Za-z0-9_]{2,10})\s*(负责|跟进)', line)
        deadline_match = re.search(r'(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|本周|下周|明天|后天|月底)', line)
        action_items.append({
            'owner': owner_match.group(1) if owner_match else '待确认',
            'task': line,
            'deadline': deadline_match.group(1) if deadline_match else '待定'
        })

    summary = f'本次会议共记录 {sentence_count} 条语句，讨论了任务推进与后续安排。'

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
        '你是会议纪要助手。请根据会议转写内容输出严格 JSON，结构为: '
        '{"summary": string, "key_points": string[], "action_items": '
        '[{"owner": string, "task": string, "deadline": string}]}。'
        '不要输出 markdown，不要输出多余文字。'
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
        items = [{'task': items.strip(), 'owner': '待确认', 'deadline': '待定'}]
    else:
        items = []

    normalized = []
    for idx, item in enumerate(items):
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({'task': text, 'owner': '待确认', 'deadline': '待定'})
            continue
        if not isinstance(item, dict):
            continue

        task = str(item.get('task') or item.get('title') or '').strip() or f'会议行动项 {idx + 1}'
        owner = str(item.get('owner') or item.get('assignee') or '').strip() or '待确认'
        deadline = str(item.get('deadline') or item.get('due_date') or '').strip() or '待定'
        normalized.append({'task': task, 'owner': owner, 'deadline': deadline})

    if not normalized and fallback_summary:
        normalized.append({
            'task': f'根据会议摘要跟进：{str(fallback_summary)[:60]}',
            'owner': '待确认',
            'deadline': '待定'
        })

    return normalized


def ensure_legacy_schema():
    """补齐旧版 SQLite 数据库缺失字段，避免升级后登录/注册报错。"""
    db_path = os.path.join(basedir, 'database.db')
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

# 创建数据库表（如果文件损坏则删除重建）
with app.app_context():
    try:
        db.create_all()
        ensure_legacy_schema()
        print("数据库表创建成功！")
    except Exception as e:
        print("数据库初始化出错：", e)
        # sqlite 常见的损坏问题，尝试删除文件并重新创建
        if 'disk image is malformed' in str(e):
            db_path = os.path.join(basedir, 'database.db')
            try:
                os.remove(db_path)
                print("损坏的数据库已删除，重新创建中…")
                db.create_all()
                print("数据库已重新创建。")
            except Exception as exc:
                print("重新创建数据库失败：", exc)
        else:
            raise


# 测试路由
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


# 用户数据现在保存在数据库中，默认账户可以通过初始化脚本创建
# （如有需要，后续可添加迁移或预填充逻辑）


# 登录路由
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'}), 400

    user = User.query.filter_by(username=username).first()
    if user and user.password == password:
        session['user'] = {'id': user.id, 'username': user.username, 'name': user.name}
        token = _make_auth_token(user)
        return jsonify({'success': True, 'user': user.to_dict(), 'token': token, 'message': '登录成功'})
    else:
        return jsonify({'success': False, 'message': '用户名或密码错误'}), 401


@app.route('/api/auth/check', methods=['GET'])
def check_auth():
    if 'user' in session:
        uid = session['user']['id']
        user = User.query.get(uid)
        if not user:
            session.pop('user', None)
            return jsonify({'error': '用户不存在'}), 401
        token = _make_auth_token(user)
        return jsonify({'user': user.to_dict(), 'token': token})

    token = _get_bearer_token_from_request()
    if token:
        user = _get_user_from_auth_token(token)
        if user:
            session['user'] = {'id': user.id, 'username': user.username, 'name': user.name}
            return jsonify({'user': user.to_dict(), 'token': token})

    return jsonify({'error': '未登录'}), 401

@app.route('/api/profile', methods=['GET'])
def get_profile():
    if 'user' not in session:
        return jsonify({'error': '未登录'}), 401
    uid = session['user']['id']
    user = User.query.get(uid)
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    return jsonify({'success': True, 'user': user.to_dict()})

@app.route('/api/profile', methods=['PUT'])
def update_profile():
    if 'user' not in session:
        return jsonify({'success': False, 'message': '未登录'}), 401
    uid = session['user']['id']
    user = User.query.get(uid)
    if not user:
        return jsonify({'success': False, 'message': '用户不存在'}), 404
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({'success': False, 'message': '无效的JSON'}), 400

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
        return jsonify({'success': False, 'message': f'服务器错误: {str(exc)}'}), 500

# 注册路由
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'success': False, 'message': '用户名和密码不能为空'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'message': '用户名已存在'}), 400

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
        return jsonify({'success': True, 'user': new_user.to_dict(), 'token': token, 'message': '注册成功'})
    except Exception as exc:
        db.session.rollback()
        # log exception
        print('register error', exc)
        return jsonify({'success': False, 'message': '注册失败，请稍后再试'}), 500


@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({'success': True, 'message': '已退出登录'})


@app.route('/api/events', methods=['GET'])
def get_events():
    """获取当前登录用户的事件，支持按年月过滤"""
    if 'user' not in session:
        return jsonify({"error": "请先登录"}), 401
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
        print(f"错误: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/events/<int:event_id>', methods=['GET'])
def get_event(event_id):
    """获取单个事件（仅限自己的事件）"""
    if 'user' not in session:
        return jsonify({"error": "请先登录"}), 401
    uid = session['user']['id']
    event = Event.query.get_or_404(event_id)
    if event.user_id != uid:
        return jsonify({"error": "无权访问此事件"}), 403
    return jsonify(event.to_dict(include_user=True))


@app.route('/api/events', methods=['POST'])
def create_event():
    """创建新事件并关联当前用户"""
    if 'user' not in session:
        return jsonify({"error": "请先登录"}), 401
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
        print(f"创建事件错误: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    """更新事件，仅限所属用户"""
    if 'user' not in session:
        return jsonify({"error": "请先登录"}), 401
    uid = session['user']['id']
    try:
        event = Event.query.get_or_404(event_id)
        if event.user_id != uid:
            return jsonify({"error": "无权修改此事件"}), 403
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
    """删除事件，仅限所属用户"""
    if 'user' not in session:
        return jsonify({"error": "请先登录"}), 401
    uid = session['user']['id']
    try:
        event = Event.query.get_or_404(event_id)
        if event.user_id != uid:
            return jsonify({"error": "无权删除此事件"}), 403
        db.session.delete(event)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


# 返回当前用户的个人信息以及所有事件
@app.route('/api/user-data', methods=['GET'])
def user_data():
    if 'user' not in session:
        return jsonify({"error": "请先登录"}), 401
    uid = session['user']['id']
    user = User.query.get(uid)
    if not user:
        return jsonify({"error": "用户不存在"}), 404
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
        return jsonify({'error': '请先登录'}), 401

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
        return jsonify({'error': '请先登录'}), 401

    user = User.query.get(uid)
    if not user:
        return jsonify({'error': '用户不存在'}), 404

    data = request.json or {}
    user.status = str(data.get('status', ''))[:200]
    db.session.commit()
    return jsonify({'success': True, 'user': user.to_dict()})


@app.route('/api/teams', methods=['GET'])
def get_teams():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    memberships = TeamMember.query.filter_by(user_id=uid).all()
    teams = [m.team.to_dict() for m in memberships if m.team]
    return jsonify(teams)


@app.route('/api/teams', methods=['POST'])
def create_team():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': '团队名称不能为空'}), 400

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
        return jsonify({'error': '请先登录'}), 401
    if not is_team_member(team_id, uid):
        return jsonify({'error': '无权访问该团队'}), 403

    members = TeamMember.query.filter_by(team_id=team_id).all()
    return jsonify([m.to_dict() for m in members])


@app.route('/api/teams/<int:team_id>/members', methods=['POST'])
def add_team_member(team_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    membership = TeamMember.query.filter_by(team_id=team_id, user_id=uid).first()
    if not membership or membership.role not in ['owner', 'manager']:
        return jsonify({'error': '仅团队管理员可添加成员'}), 403

    data = request.json or {}
    username = (data.get('username') or '').strip()
    role = (data.get('role') or 'member').strip()
    target = User.query.filter_by(username=username).first()
    if not target:
        return jsonify({'error': '用户不存在'}), 404

    if TeamMember.query.filter_by(team_id=team_id, user_id=target.id).first():
        return jsonify({'error': '该用户已在团队中'}), 400

    m = TeamMember(team_id=team_id, user_id=target.id, role=role)
    db.session.add(m)
    db.session.commit()
    return jsonify(m.to_dict()), 201


@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

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
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': '任务标题不能为空'}), 400

    team_id = data.get('team_id')
    assignee_id = data.get('assignee_id') or uid

    if team_id and not is_team_member(team_id, uid):
        return jsonify({'error': '无权在该团队创建任务'}), 403

    if assignee_id and not User.query.get(assignee_id):
        return jsonify({'error': '被分配用户不存在'}), 404

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
        return jsonify({'error': '请先登录'}), 401

    task = Task.query.get_or_404(task_id)
    if uid not in [task.creator_id, task.assignee_id]:
        return jsonify({'error': '无权修改该任务'}), 403

    data = request.json or {}
    for field in ['title', 'description', 'status', 'priority', 'due_date']:
        if field in data:
            setattr(task, field, data[field])

    if 'assignee_id' in data:
        if data['assignee_id'] and not User.query.get(data['assignee_id']):
            return jsonify({'error': '被分配用户不存在'}), 404
        task.assignee_id = data['assignee_id']

    db.session.commit()
    return jsonify(task.to_dict())


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    task = Task.query.get_or_404(task_id)
    if uid != task.creator_id:
        return jsonify({'error': '仅创建者可以删除任务'}), 403

    db.session.delete(task)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/contacts/search', methods=['GET'])
def search_users_for_contact():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    keyword = (request.args.get('q') or '').strip()
    if not keyword:
        return jsonify([])

    users = User.query.filter(User.username.contains(keyword), User.id != uid).limit(10).all()
    return jsonify([u.to_dict() for u in users])


@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    contacts = Contact.query.filter_by(user_id=uid).order_by(Contact.created_at.desc()).all()
    return jsonify([c.to_dict() for c in contacts])


@app.route('/api/contacts', methods=['POST'])
def create_contact():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    contact_user_id = data.get('contact_user_id')
    if not contact_user_id:
        return jsonify({'error': '请选择联系人'}), 400
    if contact_user_id == uid:
        return jsonify({'error': '不能添加自己'}), 400

    target = User.query.get(contact_user_id)
    if not target:
        return jsonify({'error': '联系人不存在'}), 404

    if Contact.query.filter_by(user_id=uid, contact_user_id=contact_user_id).first():
        return jsonify({'error': '联系人已存在'}), 400

    pending_request = FriendRequest.query.filter_by(
        requester_id=uid,
        receiver_id=contact_user_id,
        status='pending'
    ).first()
    if pending_request:
        return jsonify({'error': '好友申请已发送，请等待对方处理'}), 400

    friend_request = FriendRequest(
        requester_id=uid,
        receiver_id=contact_user_id,
        request_tag=data.get('tag', ''),
        request_note=data.get('note', ''),
        status='pending',
    )
    db.session.add(friend_request)
    db.session.commit()
    return jsonify({'message': '好友申请已发送', 'request': friend_request.to_dict()}), 201


@app.route('/api/contact-requests/incoming', methods=['GET'])
def get_incoming_contact_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    requests = FriendRequest.query.filter_by(receiver_id=uid, status='pending') \
        .order_by(FriendRequest.created_at.desc()).all()
    return jsonify([r.to_dict() for r in requests])


@app.route('/api/contact-requests/outgoing', methods=['GET'])
def get_outgoing_contact_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    requests = FriendRequest.query.filter_by(requester_id=uid, status='pending') \
        .order_by(FriendRequest.created_at.desc()).all()
    return jsonify([r.to_dict() for r in requests])


@app.route('/api/contact-requests/<int:request_id>/respond', methods=['POST'])
def respond_contact_request(request_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    friend_request = FriendRequest.query.get_or_404(request_id)
    if friend_request.receiver_id != uid:
        return jsonify({'error': '无权处理该申请'}), 403
    if friend_request.status != 'pending':
        return jsonify({'error': '该申请已处理'}), 400

    data = request.json or {}
    action = (data.get('action') or '').strip().lower()
    if action not in ['accepted', 'rejected']:
        return jsonify({'error': '无效操作'}), 400

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
    return jsonify({'message': '好友申请已处理', 'request': friend_request.to_dict()})


@app.route('/api/contacts/<int:contact_id>', methods=['PUT'])
def update_contact(contact_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    contact = Contact.query.get_or_404(contact_id)
    if contact.user_id != uid:
        return jsonify({'error': '无权修改该联系人'}), 403

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
        return jsonify({'error': '请先登录'}), 401

    contact = Contact.query.get_or_404(contact_id)
    if contact.user_id != uid:
        return jsonify({'error': '无权删除该联系人'}), 403

    db.session.delete(contact)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/remote-control-requests', methods=['POST'])
def create_remote_control_request():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    target_user_id = data.get('target_user_id')
    try:
        target_user_id = int(target_user_id)
    except (TypeError, ValueError):
        target_user_id = None
    if not target_user_id:
        return jsonify({'error': '请选择联系人'}), 400
    if target_user_id == uid:
        return jsonify({'error': '不能向自己发起远程操控'}), 400

    target_user = User.query.get(target_user_id)
    if not target_user:
        return jsonify({'error': '目标用户不存在'}), 404

    # 仅允许联系人之间发起远程操控请求，降低误发风险
    relation = Contact.query.filter_by(user_id=uid, contact_user_id=target_user_id).first() or Contact.query.filter_by(
        user_id=target_user_id,
        contact_user_id=uid,
    ).first()
    if not relation:
        return jsonify({'error': '仅可向通讯录联系人发起远程操控请求'}), 403

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
        return jsonify({'error': '已有待处理远程操控请求'}), 400

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
    return jsonify({'message': '远程操控请求已发送', 'request': control_request.to_dict()}), 201


@app.route('/api/remote-control-requests/incoming', methods=['GET'])
def get_incoming_remote_control_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    requests = RemoteControlRequest.query.filter_by(target_user_id=uid, status='pending') \
        .order_by(RemoteControlRequest.created_at.desc()).all()
    return jsonify([item.to_dict() for item in requests])


@app.route('/api/remote-control-requests/outgoing', methods=['GET'])
def get_outgoing_remote_control_requests():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    requests = RemoteControlRequest.query.filter_by(requester_id=uid, status='pending') \
        .order_by(RemoteControlRequest.created_at.desc()).all()
    return jsonify([item.to_dict() for item in requests])


@app.route('/api/remote-control-requests/<int:request_id>/respond', methods=['POST'])
def respond_remote_control_request(request_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    control_request = RemoteControlRequest.query.get_or_404(request_id)
    if control_request.target_user_id != uid:
        return jsonify({'error': '无权处理该请求'}), 403
    if control_request.status != 'pending':
        return jsonify({'error': '该请求已处理'}), 400

    data = request.json or {}
    action = (data.get('action') or '').strip().lower()
    if action not in ['accepted', 'rejected']:
        return jsonify({'error': '无效操作'}), 400

    control_request.status = action
    control_request.responded_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'message': '远程操控请求已处理', 'request': control_request.to_dict()})


@app.route('/api/posts', methods=['GET'])
def get_posts():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

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
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': '动态内容不能为空'}), 400

    post = Post(
        user_id=uid,
        category=data.get('category') or '工作动态',
        content=content,
    )
    db.session.add(post)
    db.session.commit()
    return jsonify(post.to_dict()), 201


@app.route('/api/posts/<int:post_id>/like', methods=['POST'])
def like_post(post_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    post = Post.query.get_or_404(post_id)
    post.likes = max(0, (post.likes or 0) + 1)
    db.session.commit()
    return jsonify(post.to_dict())


@app.route('/api/posts/<int:post_id>/comments', methods=['POST'])
def create_post_comment(post_id):
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    post = Post.query.get_or_404(post_id)
    data = request.json or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': '评论不能为空'}), 400

    comment = PostComment(post_id=post.id, user_id=uid, content=content)
    db.session.add(comment)
    db.session.commit()
    return jsonify(comment.to_dict()), 201


@app.route('/api/assistant/suggest-schedule', methods=['POST'])
def assistant_suggest_schedule():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    preferred_days = data.get('preferred_days') or ['周一', '周二', '周三', '周四', '周五']
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
    day_names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

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
                'reason': '根据你最近日程空档自动推荐',
            })
            if len(suggestions) >= 5:
                return jsonify({'suggestions': suggestions})

    return jsonify({'suggestions': suggestions})


@app.route('/api/assistant/task-plan', methods=['POST'])
def assistant_task_plan():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': '请输入任务描述'}), 400

    checkpoints = []
    for idx, seg in enumerate([s.strip() for s in text.replace('，', ',').split(',') if s.strip()], start=1):
        checkpoints.append({'step': idx, 'title': seg, 'eta': f'{idx} 天内'})

    if not checkpoints:
        checkpoints = [
            {'step': 1, 'title': '明确目标与验收标准', 'eta': '1 天内'},
            {'step': 2, 'title': '拆分任务并分配负责人', 'eta': '2 天内'},
            {'step': 3, 'title': '执行与每日同步进度', 'eta': '3-5 天'},
        ]

    return jsonify({
        'summary': '已根据输入生成执行计划，建议同步到任务列表并设置截止日期。',
        'checkpoints': checkpoints,
    })


@app.route('/api/assistant/meeting-summary', methods=['POST'])
def assistant_meeting_summary():
    uid = current_user_id()
    if not uid:
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    transcript = data.get('transcript', '')
    if isinstance(transcript, list):
        transcript_text = '\n'.join([str(item).strip() for item in transcript if str(item).strip()])
    else:
        transcript_text = str(transcript).strip()

    if len(transcript_text) < 10:
        return jsonify({'error': '会议内容过少，无法生成摘要'}), 400

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
        return jsonify({'error': '请先登录'}), 401

    data = request.json or {}
    action_items = _normalize_action_items(data.get('action_items') or [], data.get('summary') or '')
    if len(action_items) == 0:
        return jsonify({'error': '缺少行动项，无法生成任务'}), 400

    member_user_ids = []
    raw_member_ids = data.get('member_user_ids') or []
    if isinstance(raw_member_ids, list):
        for item in raw_member_ids:
            try:
                member_user_ids.append(int(item))
            except (TypeError, ValueError):
                continue

    # 创建者默认纳入任务分配池，确保至少有可分配成员
    if uid not in member_user_ids:
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
                title = f'会议行动项 {idx + 1}'

            deadline = str(item.get('deadline') or '').strip()
            owner = str(item.get('owner') or '').strip() or '待确认'
            assignee_id = valid_members[idx % len(valid_members)]

            task = Task(
                title=title[:150],
                description=(
                    f'来源：会议摘要{f"（房间 {room_id}）" if room_id else ""}\n'
                    f'建议负责人：{owner}\n'
                    f'原始截止：{deadline or "待定"}'
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
        return jsonify({'error': f'生成团队任务失败: {str(exc)}'}), 500

    return jsonify({
        'success': True,
        'created_count': len(created),
        'tasks': [t.to_dict() for t in created]
    })





if __name__ == '__main__':
    print("启动日历API服务器...")
    print("访问 http://localhost:5000 测试API")
    print("访问 http://localhost:5000/api/events 获取事件")
    socketio.run(
        app,
        debug=True,
        port=5000,
        host='0.0.0.0',
        allow_unsafe_werkzeug=True,
    )