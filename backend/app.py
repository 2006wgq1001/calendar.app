from flask import Flask, request, jsonify
from flask_cors import CORS
from models import db, Event
from datetime import datetime
import os

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000"])  # 明确指定前端地址

# 配置数据库
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# 创建数据库表
with app.app_context():
    db.create_all()
    print("数据库表创建成功！")


# 测试路由
@app.route('/', methods=['GET'])
def home():
    return jsonify({"message": "Calendar API is running", "status": "ok"})


@app.route('/api/test', methods=['GET'])
def test():
    return jsonify({"message": "API is working"})


@app.route('/api/events', methods=['GET'])
def get_events():
    """获取所有事件"""
    try:
        year = request.args.get('year')
        month = request.args.get('month')

        print(f"收到请求: year={year}, month={month}")  # 调试信息

        if year and month:
            # 获取指定月份的事件
            start_date = datetime(int(year), int(month), 1).date()
            if int(month) == 12:
                end_date = datetime(int(year) + 1, 1, 1).date()
            else:
                end_date = datetime(int(year), int(month) + 1, 1).date()

            print(f"查询日期范围: {start_date} 到 {end_date}")  # 调试信息

            events = Event.query.filter(
                Event.start_date >= start_date,
                Event.start_date < end_date
            ).all()
        else:
            events = Event.query.all()

        print(f"找到 {len(events)} 个事件")  # 调试信息
        return jsonify([event.to_dict() for event in events])
    except Exception as e:
        print(f"错误: {str(e)}")  # 调试信息
        return jsonify({"error": str(e)}), 500


@app.route('/api/events/<int:event_id>', methods=['GET'])
def get_event(event_id):
    """获取单个事件"""
    try:
        event = Event.query.get_or_404(event_id)
        return jsonify(event.to_dict())
    except Exception as e:
        return jsonify({"error": str(e)}), 404


@app.route('/api/events', methods=['POST'])
def create_event():
    """创建新事件"""
    try:
        data = request.json
        print(f"创建事件数据: {data}")  # 调试信息

        # 解析日期
        start_date = datetime.strptime(data['start_date'], '%Y-%m-%d').date()
        end_date = datetime.strptime(data['end_date'], '%Y-%m-%d').date()

        event = Event(
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

        print(f"事件创建成功: ID={event.id}")  # 调试信息
        return jsonify(event.to_dict()), 201
    except Exception as e:
        print(f"创建事件错误: {str(e)}")  # 调试信息
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


@app.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    """更新事件"""
    try:
        event = Event.query.get_or_404(event_id)
        data = request.json

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
    """删除事件"""
    try:
        event = Event.query.get_or_404(event_id)
        db.session.delete(event)
        db.session.commit()
        return jsonify({'message': 'Event deleted successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400


if __name__ == '__main__':
    print("启动日历API服务器...")
    print("访问 http://localhost:5000 测试API")
    print("访问 http://localhost:5000/api/events 获取事件")
    app.run(debug=True, port=5000, host='0.0.0.0')