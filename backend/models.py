from flask_sqlalchemy import SQLAlchemy
from datetime import datetime


db = SQLAlchemy()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120))
    bio = db.Column(db.Text)
    gender = db.Column(db.String(10))
    birthdate = db.Column(db.String(10))  # yyyy-mm-dd
    avatar = db.Column(db.Text)
    status = db.Column(db.String(200), default='')

    events = db.relationship('Event', backref='user', lazy=True)
    tasks_assigned = db.relationship('Task', foreign_keys='Task.assignee_id', backref='assignee', lazy=True)
    tasks_created = db.relationship('Task', foreign_keys='Task.creator_id', backref='creator', lazy=True)
    contacts = db.relationship('Contact', foreign_keys='Contact.user_id', backref='owner', lazy=True)
    posts = db.relationship('Post', backref='author', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'name': self.name,
            'email': self.email,
            'bio': self.bio,
            'gender': self.gender,
            'birthdate': self.birthdate,
            'avatar': self.avatar,
            'status': self.status,
        }


class Event(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.String(5))  # 存储格式：HH:MM
    end_time = db.Column(db.String(5))  # 存储格式：HH:MM
    color = db.Column(db.String(20), default='#3788d8')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, include_user=False):
        data = {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'description': self.description,
            'start_date': self.start_date.strftime('%Y-%m-%d') if self.start_date else None,
            'end_date': self.end_date.strftime('%Y-%m-%d') if self.end_date else None,
            'start_time': self.start_time,
            'end_time': self.end_time,
            'color': self.color
        }
        if include_user and self.user:
            # avoid circular import; assume user has to_dict
            data['user'] = self.user.to_dict()
        return data


class Team(db.Model):
    __tablename__ = 'team'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    owner = db.relationship('User', foreign_keys=[owner_id], backref='owned_teams')
    members = db.relationship('TeamMember', backref='team', lazy=True, cascade='all, delete-orphan')
    tasks = db.relationship('Task', backref='team', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'owner_id': self.owner_id,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'member_count': len(self.members),
        }


class TeamMember(db.Model):
    __tablename__ = 'team_member'

    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey('team.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    role = db.Column(db.String(30), default='member')
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='team_memberships')

    __table_args__ = (
        db.UniqueConstraint('team_id', 'user_id', name='uq_team_user'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'user_id': self.user_id,
            'role': self.role,
            'user': self.user.to_dict() if self.user else None,
        }


class Task(db.Model):
    __tablename__ = 'task'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(30), default='todo')
    priority = db.Column(db.String(20), default='medium')
    due_date = db.Column(db.String(10))
    team_id = db.Column(db.Integer, db.ForeignKey('team.id'))
    assignee_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'status': self.status,
            'priority': self.priority,
            'due_date': self.due_date,
            'team_id': self.team_id,
            'assignee_id': self.assignee_id,
            'creator_id': self.creator_id,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S') if self.updated_at else None,
            'assignee': self.assignee.to_dict() if self.assignee else None,
        }


class Contact(db.Model):
    __tablename__ = 'contact'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    contact_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    tag = db.Column(db.String(80), default='')
    note = db.Column(db.String(200), default='')
    is_favorite = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    contact_user = db.relationship('User', foreign_keys=[contact_user_id])

    __table_args__ = (
        db.UniqueConstraint('user_id', 'contact_user_id', name='uq_contact_pair'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'contact_user_id': self.contact_user_id,
            'tag': self.tag,
            'note': self.note,
            'is_favorite': self.is_favorite,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'contact_user': self.contact_user.to_dict() if self.contact_user else None,
        }


class FriendRequest(db.Model):
    __tablename__ = 'friend_request'

    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    request_tag = db.Column(db.String(80), default='')
    request_note = db.Column(db.String(200), default='')
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    responded_at = db.Column(db.DateTime)

    requester = db.relationship('User', foreign_keys=[requester_id])
    receiver = db.relationship('User', foreign_keys=[receiver_id])

    def to_dict(self):
        return {
            'id': self.id,
            'requester_id': self.requester_id,
            'receiver_id': self.receiver_id,
            'request_tag': self.request_tag,
            'request_note': self.request_note,
            'status': self.status,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'responded_at': self.responded_at.strftime('%Y-%m-%d %H:%M:%S') if self.responded_at else None,
            'requester': self.requester.to_dict() if self.requester else None,
            'receiver': self.receiver.to_dict() if self.receiver else None,
        }


class RemoteControlRequest(db.Model):
    __tablename__ = 'remote_control_request'

    id = db.Column(db.Integer, primary_key=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    target_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    room_id = db.Column(db.String(64), nullable=False)
    control_note = db.Column(db.String(200), default='')
    status = db.Column(db.String(20), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    responded_at = db.Column(db.DateTime)

    requester = db.relationship('User', foreign_keys=[requester_id])
    target_user = db.relationship('User', foreign_keys=[target_user_id])

    def to_dict(self):
        return {
            'id': self.id,
            'requester_id': self.requester_id,
            'target_user_id': self.target_user_id,
            'room_id': self.room_id,
            'control_note': self.control_note,
            'status': self.status,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'responded_at': self.responded_at.strftime('%Y-%m-%d %H:%M:%S') if self.responded_at else None,
            'requester': self.requester.to_dict() if self.requester else None,
            'target_user': self.target_user.to_dict() if self.target_user else None,
        }


class Post(db.Model):
    __tablename__ = 'post'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    category = db.Column(db.String(50), default='工作动态')
    content = db.Column(db.Text, nullable=False)
    likes = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    comments = db.relationship('PostComment', backref='post', lazy=True, cascade='all, delete-orphan')

    def to_dict(self, include_comments=False):
        data = {
            'id': self.id,
            'user_id': self.user_id,
            'category': self.category,
            'content': self.content,
            'likes': self.likes,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'author': self.author.to_dict() if self.author else None,
        }
        if include_comments:
            data['comments'] = [c.to_dict() for c in self.comments]
        return data


class PostComment(db.Model):
    __tablename__ = 'post_comment'

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('post.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='post_comments')

    def to_dict(self):
        return {
            'id': self.id,
            'post_id': self.post_id,
            'user_id': self.user_id,
            'content': self.content,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
            'user': self.user.to_dict() if self.user else None,
        }